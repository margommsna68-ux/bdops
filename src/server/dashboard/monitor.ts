import {z} from 'zod';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import type {PrismaClient} from '@prisma/client';
import {MONITOR_POLICY,MAX_MONITOR_CLOCK_SKEW_MS,monitorFreshness,monitorId} from '@/lib/monitor-policy';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {withProxyTransaction} from '../proxy-management/transaction';
import {lockCashProject} from '../business-management/cash-lock';
import {businessHash} from '../business-management/idempotency';
import {assertOpsToken} from '../ops-api/context';
import {authorizeVM} from '../vm-management/repository';
import {assertScopedTargets,serverWhere} from '../permissions/server-scope';

const time=z.string().datetime({offset:true}),count=z.number().int().min(0).max(100000);
export const MonitorCounts=z.object({managed:count,inventory:count,guest:count,proxy:count,app:count}).strict().refine(c=>[c.inventory,c.guest,c.proxy,c.app].every(n=>n<=c.managed),'Coverage exceeds managed count');
export const HeartbeatBody=z.object({projectId:monitorId,source:z.enum(['CENTRAL','AGENT']),serverUuid:z.string().uuid(),instanceUuid:z.string().uuid(),startedAt:time,seq:z.number().int().min(0).max(2147483647),configVersion:z.number().int().min(1).max(100000),observedAt:time,counts:MonitorCounts}).strict().refine(b=>Date.parse(b.startedAt)<=Date.parse(b.observedAt),'Instance starts after observation');
export type HeartbeatInput=z.infer<typeof HeartbeatBody>;
/** Address identity only; never protocol/authentication/installation proof. No credential column is read or decrypted. */
export function proxyAddressFingerprint(endpoint:{host:string|null;address:string;port:number|null}|null|undefined):string|null {
 if(!endpoint||!Number.isInteger(endpoint.port)||endpoint.port!<1||endpoint.port!>65535)return null;
 let host=endpoint.host?.trim().toLowerCase();
 if(!host){
  // Legacy address may be bare host, host:port, or host:port:user:pass. Capture only address identity.
  const m=/^([a-z0-9.-]+)(?::(\d{1,5})(?::[^\r\n]*)?)?$/i.exec(endpoint.address.trim());
  if(!m||m[2]&&Number(m[2])!==endpoint.port)return null;
  host=m[1].toLowerCase();
 }
 if(!isIP(host)&&!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(host))return null;
 return createHash('sha256').update(`${host}|${endpoint.port}`).digest('hex');
}
const Binding=z.object({projectId:monitorId,serverId:monitorId,source:z.enum(['CENTRAL','AGENT']),serverUuid:z.string().uuid()}).strict();
/** Missing/malformed configuration fails closed. Machine identity is independent of rotating process identity. */
function bindings(){try{return z.array(Binding).max(100).parse(JSON.parse(process.env.FLEET_MONITOR_CANARY??'[]'));}catch{return [];}}
export function isMonitorCanary(projectId:string,serverId:string){return bindings().some(b=>b.projectId===projectId&&b.serverId===serverId);}
export function assertMonitorCanary(projectId:string,serverId:string,source?:HeartbeatInput['source'],serverUuid?:string){
 const matching=bindings().filter(b=>b.projectId===projectId&&b.serverId===serverId&&(!source||b.source===source));
 if(!matching.length||serverUuid&&(!matching.every(b=>b.serverUuid.toLowerCase()===serverUuid.toLowerCase())))throw new ProxyDomainError('FORBIDDEN','Monitor chưa được khai báo cho server / nguồn canary này');
}
const conflict=()=>{throw new ProxyDomainError('STALE_PREVIEW','Heartbeat cũ, khác epoch hoặc xung đột thứ tự','REVISION_CONFLICT');};
export async function recordMonitorHeartbeat(scope:ActorScope,serverId:string,key:string,raw:unknown,db:PrismaClient){
 const b=HeartbeatBody.parse(raw);
 if(b.projectId!==scope.projectId||key.length<8||key.length>100)throw new ProxyDomainError('INVALID_INPUT');
 const hash=businessHash({serverId,actorId:scope.userId,key,body:b});
 return withProxyTransaction(async tx=>{
  await lockCashProject(tx,scope.projectId);
  await assertOpsToken(tx,scope);
  const current=await authorizeVM(scope,'ASSIGN',tx);
  await assertScopedTargets(tx,current,{serverId});
  const server=await tx.server.findFirst({where:{id:serverId,projectId:scope.projectId,managed:true,archivedAt:null,...serverWhere(current)},select:{id:true}});
  if(!server)throw new ProxyDomainError('NOT_FOUND');
  assertMonitorCanary(scope.projectId,serverId,b.source,b.serverUuid);
  const keyed=await tx.monitorHeartbeat.findFirst({where:{projectId:scope.projectId,requestKey:key},select:{serverId:true,source:true,requestHash:true}});
  if(keyed&&(keyed.serverId!==serverId||keyed.source!==b.source||keyed.requestHash!==hash))throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH');
  const prior=await tx.monitorHeartbeat.findUnique({where:{serverId_source:{serverId,source:b.source}}});
  if(prior?.requestKey===key){
   if(prior.requestHash!==hash)throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH');
   return {replay:true,serverId,source:b.source,seq:prior.seq,observedAt:prior.observedAt.toISOString(),receivedAt:prior.receivedAt.toISOString(),configVersion:prior.configVersion};
  }
  const now=new Date(),observedAt=new Date(b.observedAt),startedAt=new Date(b.startedAt);
  if(observedAt.getTime()>now.getTime()+MAX_MONITOR_CLOCK_SKEW_MS)throw new ProxyDomainError('INVALID_INPUT','Heartbeat ở tương lai','VALIDATION');
  if(prior){
   if(prior.projectId!==scope.projectId||prior.serverUuid.toLowerCase()!==b.serverUuid.toLowerCase())conflict();
   if(observedAt<prior.observedAt)conflict();
   if(prior.instanceUuid===b.instanceUuid){if(startedAt.getTime()!==prior.startedAt.getTime()||b.seq<=prior.seq)conflict();}
   else if(startedAt<=prior.startedAt)conflict();
  }
  await tx.monitorHeartbeat.upsert({where:{serverId_source:{serverId,source:b.source}},create:{...b,serverId,startedAt,observedAt,receivedAt:now,requestKey:key,requestHash:hash,actorId:scope.userId},update:{...b,startedAt,observedAt,receivedAt:now,requestKey:key,requestHash:hash,actorId:scope.userId}});
  return {replay:false,serverId,source:b.source,seq:b.seq,observedAt:observedAt.toISOString(),receivedAt:now.toISOString(),configVersion:b.configVersion};
 },db);
}
/** Only workspace-authorized server IDs. Reported coverage is never per-VM proof. */
export async function readMonitorHeartbeats(projectId:string,servers:{id:string;code:string}[],db:PrismaClient,now:Date){
 const rows=servers.length?await db.monitorHeartbeat.findMany({where:{projectId,serverId:{in:servers.map(s=>s.id)}}}):[];
 return servers.map(s=>{
  const source=(role:'CENTRAL'|'AGENT')=>{
   const r=rows.find(r=>r.serverId===s.id&&r.source===role);
   const sourceAheadMs=r?Math.max(0,r.observedAt.getTime()-r.receivedAt.getTime()):0;
   return {freshness:r?.configVersion!==undefined&&r.configVersion!==MONITOR_POLICY.version?'UNSUPPORTED' as const:monitorFreshness(r?.observedAt.toISOString(),now,MONITOR_POLICY.heartbeatStaleSeconds),observedAt:r?.observedAt.toISOString()??null,receivedAt:r?.receivedAt.toISOString()??null,configVersion:r?.configVersion??null,counts:r?MonitorCounts.parse(r.counts):null,...(sourceAheadMs>0?{clockWarning:'SOURCE_AHEAD' as const,sourceAheadMs}:{})};
  };
  return {serverId:s.id,server:s.code,central:source('CENTRAL'),agent:source('AGENT')};
 });
}
export type MonitorHeartbeats=Awaited<ReturnType<typeof readMonitorHeartbeats>>;
