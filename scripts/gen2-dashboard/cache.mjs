import fs from 'node:fs/promises';
import path from 'node:path';

export const uuidOf = v => typeof v === 'string' && /^[{]?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}[}]?$/i.test(v.trim()) ? v.trim().replace(/[{}]/g,'').toLowerCase() : null;
export const codeOf = v => typeof v === 'string' ? v.trim().toUpperCase() : '';
export function serverOf(v) {
 const s=codeOf(v).replace(/[\s_-]/g,'');const m=/^([A-Z]+)0*(\d+)$/.exec(s);
 return m ? m[1]+String(Number(m[2])) : s;
}
const date = v => typeof v==='string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const time = v => date(v) ? Date.parse(v) : -Infinity;
const amount = micros => {
 if (!Number.isSafeInteger(micros)||micros<0||micros>9999999999999999) return null;
 const n=BigInt(micros);return `${n/1000000n}.${String(n%1000000n).padStart(6,'0')}`.replace(/\.?0+$/,'');
};
const PROBLEMS = new Map([
 ['VM_OFF','VM_OFF'],['POWEROFF','VM_OFF'],['POWERED_OFF','VM_OFF'],['OFF','VM_OFF'],
 ['APP_DOWN','EARNAPP'],['EARNAPP_DOWN','EARNAPP'],['EARNAPP_NOT_RUNNING','EARNAPP'],
 ['BLOCKED','PROXY_BLOCKED'],['PROXY_BLOCKED','PROXY_BLOCKED'],
 ['PROXY_AUTH','PROXY_AUTH'],['PROXY_AUTH_FAILED','PROXY_AUTH'],['PROXY_AUTH_ERROR','PROXY_AUTH'],['AUTH_FAILED','PROXY_AUTH'],
 ['PROXY_EXPIRED','PROXY_EXPIRED'],['EXPIRED','PROXY_EXPIRED'],
 ['PROXY_CONNECTION','PROXY_CONNECTION'],['PROXY_CONNECTION_FAILED','PROXY_CONNECTION'],['PROXY_CONNECTION_ERROR','PROXY_CONNECTION'],['PROXY_CONNECT_FAILED','PROXY_CONNECTION'],['PROXY_UNREACHABLE','PROXY_CONNECTION']
]);
function problemOf(raw, vm, diagnostic) {
 if (['POWEROFF','POWERED_OFF','VM_OFF','OFF'].includes(codeOf(raw?.vm_state||raw?.vm_state_raw))) return 'VM_OFF';
 const signals=[raw?.proxy_block_check,raw?.proxy_observation?.blockCheck,raw?.proxy_observation?.why,raw?.proxy_observation?.status,
  diagnostic?.proxyBlockCheck,diagnostic?.proxyRouteWhy,diagnostic?.proxyStatus,raw?.health,vm.health?.status,vm.health?.unknownCode,diagnostic?.status];
 for (const s of signals) if (PROBLEMS.has(codeOf(s))) return PROBLEMS.get(codeOf(s));
 if (raw?.guest?.earnapp?.running===false || raw?.guest?.earnapp_process_count===0 || diagnostic?.processCount===0) return 'EARNAPP';
 return null;
}
function moneyCandidate(micros,currency,at,readable,source) {
 const observedAt=date(at);if (!observedAt) return null;
 if (readable===false) return {amount:null,observedAt,source};
 if (readable!==true||currency!=='USD'||amount(micros)===null) return null;
 return {amount:amount(micros),observedAt,source};
}
/** GEN2 3.1.18 income.mjs: elapsedMs = time(current) - time(anchor), baselineAt = anchor.timestamp.
 * This recovers the individual sample clock exactly; income.at itself is report completion. */
function incomeTime(income,upperBound) {
 if(!['GROWING','NO_INCREASE','DECREASED','OBSERVING'].includes(income?.state))return null;
 if(date(income.observedAt))return time(income.observedAt)<=time(upperBound)?date(income.observedAt):null;
 if(!date(income.baselineAt)||!Number.isSafeInteger(income.elapsedMs)||income.elapsedMs<0)return null;
 const n=time(income.baselineAt)+income.elapsedMs;if(!Number.isSafeInteger(n)||n>time(upperBound)||n>8640000000000000)return null;
 return new Date(n).toISOString();
}

/** Projects only whitelisted facts. Never executes/imports GEN2 modules. */
export function projectCache({fleet,localHealth=null,localMoney=null,diagnostics=[]},{now=Date.now()}={}) {
 const observations=[],rejected=[];
 if (fleet?.kind!=='GEN_FLEET_LATEST_V1'||fleet.schemaVersion!==1||!Array.isArray(fleet.servers)||fleet.stale===true) return {observations,rejected:[{reason:'FLEET_UNAVAILABLE'}]};
 const localValid=localHealth?.kind==='GEN_HEALTH_LAST_SCAN'&&localHealth.schemaVersion===1;
 for (const server of fleet.servers) for (const vm of Array.isArray(server.vms)?server.vms:[]) {
  const uuid=uuidOf(vm.vmId),vmCode=codeOf(vm.vmName);
  if (!uuid||!vmCode||typeof server.serverId!=='string'||!serverOf(server.serverName)) {rejected.push({reason:'SOURCE_IDENTITY_MISSING'});continue;}
  const locals=localValid&&localHealth.serverId===server.serverId ? localHealth.rows.filter(r=>uuidOf(r.vmUuid)===uuid&&codeOf(r.vmName)===vmCode):[];
  if (locals.length>1) {rejected.push({reason:'RAW_UUID_AMBIGUOUS',uuid});continue;}
  const raw=locals[0]?.result;
  if (raw&&(uuidOf(raw.uuid)!==uuid||codeOf(raw.vm)!==vmCode)) {rejected.push({reason:'RAW_IDENTITY_MISMATCH',uuid});continue;}
  const bundle=diagnostics.find(d=>d?.server?.serverId===server.serverId&&d.reportId===vm.health?.reportId);
  const machines=bundle?.machines?.filter(r=>uuidOf(r.vmId)===uuid&&codeOf(r.vmName)===vmCode)||[];
  const diagnostic=machines.length===1?machines[0]:null;
  const diagnosticTime=diagnostic?incomeTime({state:diagnostic.incomeState,baselineAt:diagnostic.baselineAt,elapsedMs:diagnostic.incomeElapsedMs},vm.health?.at):null;
  let observedAt=date(raw?.guest?.observed_at)||date(raw?.probed_at)||diagnosticTime||date(vm.health?.at);
  if (!observedAt||time(observedAt)>now+300000) {rejected.push({reason:'OBSERVATION_TIME_INVALID',uuid});continue;}
  let problem=problemOf(raw,{},raw?null:diagnostic);
  const remoteRunning=!raw&&!!diagnosticTime&&diagnostic?.processCount===1&&diagnostic?.processIds?.length===1&&diagnostic.verifiedGreen===true;
  const running=(raw?.guest?.earnapp?.running===true&&raw?.guest?.earnapp_process_count===1)||remoteRunning;
  const growth=raw?.income?.state==='GROWING'&&Number.isSafeInteger(raw.income.deltaMicros)&&raw.income.deltaMicros>0&&date(raw.income.observedAt);
  const explicit=['EARNING','PROVEN'].includes(raw?.earning_state)||['EARNING','PROVEN'].includes(raw?.earning?.state);
  const remoteGrowth=remoteRunning&&diagnostic.incomeState==='GROWING'&&Number.isSafeInteger(diagnostic.deltaMicros)&&diagnostic.deltaMicros>0;
  let earning=problem?false:running&&(growth||explicit||remoteGrowth)?true:null;
  const fleetProblem=problemOf(null,vm,null),fleetAt=date(vm.health?.at);
  // Keep each source clock: old faults do not taint new healthy evidence, and a
  // newer fleet fault must not be stamped with the older raw scan's time.
  if(fleetProblem&&fleetAt&&time(fleetAt)>=time(observedAt)&&time(fleetAt)<=now+300000){problem=fleetProblem;observedAt=fleetAt;earning=false;}
  const candidates=[];
  if (raw?.income?.metricType==='ACCOUNT_BALANCE') candidates.push(moneyCandidate(raw.income.currentMicros,'USD',raw.income.observedAt,Number.isSafeInteger(raw.income.currentMicros),'LOCAL_HEALTH'));
  const localRecord=localValid&&localHealth.serverId===server.serverId?localMoney?.[localHealth.hostId]?.[uuid]:null;
  if (localRecord&&uuidOf(localRecord.vmUuid)===uuid&&codeOf(localRecord.vmName)===vmCode&&localRecord.money?.metricType==='ACCOUNT_BALANCE') candidates.push(moneyCandidate(localRecord.money.micros,localRecord.money.currency,localRecord.timestamp,true,'LOCAL_MONEY'));
  candidates.push(moneyCandidate(vm.money?.currentMicros,vm.money?.currency,vm.money?.at,vm.money?.readable,'FLEET_MONEY'));
  // The verified GEN2 income schema contains ACCOUNT_BALANCE only. Recover its exact sample timestamp.
  const fleetIncomeTime=incomeTime(vm.income,vm.income?.at);
  if(fleetIncomeTime)candidates.push(moneyCandidate(vm.income.currentMicros,'USD',fleetIncomeTime,Number.isSafeInteger(vm.income.currentMicros),'FLEET_INCOME'));
  const sorted=candidates.filter(c=>c&&time(c.observedAt)<=now+300000).sort((a,b)=>time(b.observedAt)-time(a.observedAt));
  let money=sorted[0]||null;
  if (money&&sorted.some(c=>c.observedAt===money.observedAt&&c.amount!==money.amount)) money=null; // disagreement is not a guessed balance
  observations.push({serverId:server.serverId,serverName:server.serverName,vmCode,uuid,observedAt,earning,problem,money});
 }
 return {observations,rejected};
}

/** Names only narrow candidates; UUID equality remains mandatory. */
export function matchTargets(targets,observations) {
 const matches=[],rejected=[];
 for (const target of targets) {
  const uuid=uuidOf(target.machineUuid);
  if (!uuid) {rejected.push({id:target.id,reason:'TARGET_UUID_MISSING'});continue;}
  if(targets.filter(t=>t.id===target.id).length!==1||new Set(targets.filter(t=>serverOf(t.serverCode)===serverOf(target.serverCode)).map(t=>t.serverId)).size!==1){rejected.push({id:target.id,reason:'TARGET_SERVER_AMBIGUOUS'});continue;}
  if (targets.filter(t=>uuidOf(t.machineUuid)===uuid).length!==1) {rejected.push({id:target.id,reason:'TARGET_UUID_AMBIGUOUS'});continue;}
  const candidates=observations.filter(o=>o.uuid===uuid);
  if(candidates.length!==1) {rejected.push({id:target.id,reason:candidates.length?'SOURCE_UUID_AMBIGUOUS':'SOURCE_MISSING'});continue;}
  const o=candidates[0];
  const serverIds=new Set(observations.filter(v=>serverOf(v.serverName)===serverOf(target.serverCode)).map(v=>v.serverId));
  if(serverIds.size!==1||serverOf(o.serverName)!==serverOf(target.serverCode)||codeOf(o.vmCode)!==codeOf(target.code)) {rejected.push({id:target.id,reason:'SERVER_OR_VM_MISMATCH'});continue;}
  matches.push({target,observation:o});
 }
 return {matches,rejected};
}

async function readJson(file,optional=false) {
 try {const st=await fs.stat(file);if(!st.isFile()||st.size>32*1024*1024)throw new Error('CACHE_TOO_LARGE');return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));}
 catch {if(optional)return null;throw new Error('CACHE_UNAVAILABLE');}
}
export async function readCaches(machineRoot,{now=Date.now()}={}) {
 const fleet=await readJson(path.join(machineRoot,'data/fleet/fleet-latest.json'));
 const [localHealth,localMoney]=await Promise.all([readJson(path.join(machineRoot,'data/health/last-scan.json'),true),readJson(path.join(machineRoot,'data/money/latest.json'),true)]);
 const diagnostics=[];
 // Bounded reads of existing latest pointers, never scan a host or call a GEN2 command.
 for(const s of (fleet.servers||[]).slice(0,64)) {
  if(!uuidOf(s.serverId))continue;
  const dir=path.join(machineRoot,'data/diagnostics/inbox',s.serverId),pointer=await readJson(path.join(dir,'latest.json'),true);
  if(pointer?.serverId!==s.serverId||typeof pointer.fileName!=='string'||!/^[-\w.]+\.json$/.test(pointer.fileName)||pointer.fileName.includes('..'))continue;
  const bundle=await readJson(path.join(dir,pointer.fileName),true);
  if(bundle?.server?.serverId===s.serverId&&bundle.reportId===pointer.reportId&&Array.isArray(bundle.machines))diagnostics.push(bundle);
 }
 return projectCache({fleet,localHealth,localMoney,diagnostics},{now});
}
