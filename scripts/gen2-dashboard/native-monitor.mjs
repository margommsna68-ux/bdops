import fs from 'node:fs/promises';
import path from 'node:path';
import {sanitizeNativeSource} from '../../integrations/gen2-monitor-canary/engine/native-monitor-wire.mjs';
import {serverOf,codeOf,uuidOf} from './cache.mjs';
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(s);
export function parseMonitorConfig(v,projectId){
 if(!v||Array.isArray(v)||Object.keys(v).some(k=>!['version','centralUuid','bindings'].includes(k))||v.version!==1||!id(projectId)||!uuidOf(v.centralUuid)||!Array.isArray(v.bindings)||v.bindings.length<1||v.bindings.length>8)throw Error('MONITOR_CONFIG_INVALID');
 const ids=new Set(),uuids=new Set(),codes=new Set();
 const bindings=v.bindings.map(b=>{
  if(!b||Array.isArray(b)||Object.keys(b).some(k=>!['projectId','serverId','serverCode','serverUuid'].includes(k))||b.projectId!==projectId||!id(b.serverId)||!uuidOf(b.serverUuid)||!id(b.serverCode))throw Error('MONITOR_CONFIG_INVALID');
  const uuid=uuidOf(b.serverUuid),code=serverOf(b.serverCode);
  if(ids.has(b.serverId)||uuids.has(uuid)||codes.has(code))throw Error('MONITOR_CONFIG_INVALID');
  ids.add(b.serverId);uuids.add(uuid);codes.add(code);
  return {projectId,serverId:b.serverId,serverCode:b.serverCode,serverUuid:uuid};
 });
 return {version:1,centralUuid:uuidOf(v.centralUuid),bindings};
}
export async function readNativeSnapshots(machineRoot,config,now=Date.now()){
 const out=[];
 for(const b of config.bindings){
  const files=[path.join(machineRoot,'data/native-monitor/inbox',b.serverUuid+'.json')];
  if(b.serverUuid===config.centralUuid)files.push(path.join(machineRoot,'data/native-monitor/latest.json'));
  for(const file of files){try{
   const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>1049000)continue;
   const source=JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));delete source.receivedAt;
   const value=sanitizeNativeSource(source);if(!value||value.serverUuid!==b.serverUuid||Date.parse(value.observedAt)>now)continue;
   out.push(value);
  }catch{/* Missing or invalid source remains unverified; never replace source times with file mtime. */}}
 }
 return out;
}
export function mergeNativeObservations(projected,targets,config,now=Date.now()){
 const observations=[...projected.observations],rejected=[...(projected.rejected??[])];
 for(const b of config.bindings){
  const snapshots=(projected.nativeSnapshots??[]).filter(s=>s.serverUuid===b.serverUuid),source=snapshots.length===1?snapshots[0]:null;
  const members=targets.filter(t=>t.serverId===b.serverId);
  for(const t of members){
   const candidates=observations.filter(o=>uuidOf(o.uuid)===uuidOf(t.machineUuid));
   const base=candidates.length===1?candidates[0]:null;
   // A source file alone cannot bypass the established server/code/UUID mapping.
   const peer=candidates.length===0||candidates.length===1&&base.serverId===b.serverUuid&&serverOf(base.serverName)===serverOf(t.serverCode)&&codeOf(base.vmCode)===codeOf(t.code);
   const samples=source?.samples.filter(s=>uuidOf(s.machineUuid)===uuidOf(t.machineUuid)&&codeOf(s.vmCode)===codeOf(t.code))??[];
   const native=peer&&samples.length===1?samples[0]:null;
   for(let i=observations.length-1;i>=0;i--)if(uuidOf(observations[i].uuid)===uuidOf(t.machineUuid))observations.splice(i,1);
   if(!peer||!base&&!native){rejected.push({id:t.id,reason:'NATIVE_IDENTITY_UNVERIFIED'});continue;}
   const previous=base??{serverId:b.serverUuid,serverName:b.serverCode,vmCode:native.vmCode,uuid:native.machineUuid,money:null};
   if(!native||!source||Date.parse(source.observedAt)>now){observations.push({...previous,earning:null,problem:null});continue;}
   const monitor=structuredClone(native.monitor),p=native.proxyEvidence;
   if(p&&t.endpointId&&t.proxyAddressFingerprint&&p.proxyAddressFingerprint===t.proxyAddressFingerprint){
    monitor.proxy={observedAt:p.observedAt,provenance:'HOST',endpointId:t.endpointId,appliedConfigurationId:null,tcp:p.tcp,auth:p.auth,https:p.https};
   }
   // New inventory never re-dates cached earnings or a legacy error. Money keeps its own clock.
   observations.push({...previous,observedAt:source.observedAt,earning:null,problem:null,monitor});
  }
 }
 return {...projected,observations,rejected};
}
