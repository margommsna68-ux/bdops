import type {PrismaClient} from '@prisma/client';
import {businessPulse,type PulseInput,type ScanHealth} from '@/lib/business-pulse';
import type {ActorScope} from '../proxy-management/types';
import type {readVMWorkspace} from '../vm-management/repository';
import type {readVmAccounts} from '../account-store/read';
import {readScanHealth,machineUuid} from './scan';
import {vmView} from '../vm-management/state';
import {MONITOR_POLICY,type MonitorObservationInput} from '@/lib/monitor-policy';
import {readMonitorHeartbeats,isMonitorCanary} from './monitor';

/** Reads only the authorized workspace. Legacy events without binding are not proof of this VM/round. */
export async function readBusinessPulse(scope:ActorScope,workspace:Awaited<ReturnType<typeof readVMWorkspace>>,accounts:Awaited<ReturnType<typeof readVmAccounts>>|null,db:PrismaClient,now:Date){
 const active=new Set(workspace.servers.filter(s=>!s.archivedAt).map(s=>s.id));
 const vms=workspace.vms.filter(v=>!v.archivedAt&&active.has(v.serverId)),ids=vms.map(v=>v.id),moneyRead=workspace.sdkMoney.read;
 const sdkIds=vms.flatMap(v=>v.sdks.filter(s=>s.current).map(s=>s.recordId));
 const canaryServers=new Set([...active].filter(id=>isMonitorCanary(scope.projectId,id)));
 const [events,scans,requests,heartbeats]=await Promise.all([
  moneyRead&&sdkIds.length?db.sdkEvent.findMany({where:{projectId:scope.projectId,sdkId:{in:sdkIds},kind:{in:['AMOUNT','OBSERVE','PLACE','MOVE','REMOVE','RECREATE']},createdAt:{gte:new Date(now.getTime()-48*3600e3)}},orderBy:{createdAt:'asc'},select:{sdkId:true,kind:true,createdAt:true,detail:true}}):[],
  ids.length?db.vmOpsEvent.findMany({where:{projectId:scope.projectId,vmId:{in:ids},kind:'GEN2_SCAN',createdAt:{gte:new Date(now.getTime()-48*3600e3)}},orderBy:{createdAt:'desc'},select:{vmId:true,cycle:true,detail:true}}):[],
  moneyRead&&ids.length?db.earnPayoutRequest.findMany({where:{projectId:scope.projectId,vmId:{in:ids}},select:{vmId:true,cycle:true}}):[],
  readMonitorHeartbeats(scope.projectId,workspace.servers.filter(s=>active.has(s.id)),db,now),
 ]);
 const accountOf=new Map((accounts??[]).map(a=>[a.vmId,a.earnApp]));
 const input:PulseInput[]=vms.map(v=>{
  const cur=v.sdks.find(s=>s.current),acc=accountOf.get(v.id),own=cur?events.filter(e=>e.sdkId===cur.recordId):[];
  const placements=own.filter(e=>['PLACE','MOVE','REMOVE','RECREATE'].includes(e.kind));
  const barrier=placements.length?placements[placements.length-1].createdAt.getTime():0;
  const points:PulseInput['points']=[];
  let continuity=barrier;
  for(const e of own){const d=e.detail&&typeof e.detail==='object'&&!Array.isArray(e.detail)?e.detail:{};
   if(e.kind==='AMOUNT'&&(d.vmId!==v.id||d.cycle!==v.cycle||typeof d.observedAt!=='string'||d.to===null))continuity=Math.max(continuity,e.createdAt.getTime());
  }
  for(const e of own){if(!['AMOUNT','OBSERVE'].includes(e.kind)||e.createdAt.getTime()<continuity)continue;
   const d=e.detail&&typeof e.detail==='object'&&!Array.isArray(e.detail)?e.detail:{};
   if(d.vmId===v.id&&d.cycle===v.cycle&&typeof d.observedAt==='string'&&typeof d.to==='string'&&d.readable!==false)points.push({at:d.observedAt,amount:d.to});
  }
  if(moneyRead&&cur?.amount!=null&&cur.amountObservedAt)points.push({at:cur.amountObservedAt,amount:cur.amount});
  const candidates=scans.filter(s=>s.vmId===v.id&&s.cycle===v.cycle).map(s=>readScanHealth(s.detail,v.desired?.id??null,machineUuid(v.notes),{projectId:scope.projectId,serverId:v.serverId,cycle:v.cycle,revision:v.revision})).filter((s):s is ScanHealth=>!!s).sort((a,b)=>Date.parse(b.observedAt??b.at)-Date.parse(a.observedAt??a.at));
  const latestMonitor=candidates.find(c=>c.monitor)?.monitor;
  let monitor:MonitorObservationInput|undefined=latestMonitor;
  if(latestMonitor?.configVersion===MONITOR_POLICY.version){
   monitor={configVersion:MONITOR_POLICY.version};
   // Inventory and guest lanes have independent clocks. Arrival time never refreshes an old axis.
   for(const axis of ['vmState','guest','network','proxy','app'] as const){
    const newest=candidates.flatMap(c=>c.monitor?.configVersion===MONITOR_POLICY.version&&c.monitor[axis]?[c.monitor]:[]).sort((a,b)=>Date.parse(b[axis]!.observedAt)-Date.parse(a[axis]!.observedAt))[0];
    if(newest)Object.assign(monitor,{[axis]:newest[axis]});
   }
  }
  // Cached proof carried by a newer inventory envelope is still old proof. Null axes are not proof.
  // On equal proof clocks, a negative/problem sample wins over a conflicting positive sample.
  const proof=candidates.filter(c=>(c.earning!==null||c.problem!==null)&&(!c.monitor||c.monitor.configVersion===MONITOR_POLICY.version)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||Number(a.earning===true&&!a.problem)-Number(b.earning===true&&!b.problem))[0];
  const health=candidates[0]?{...candidates[0],at:proof?.at??candidates[0].at,earning:proof?.earning??null,problem:proof?.problem??null,...(monitor?{monitor}:{})}:null;
  const proxyState=vmView(v),recordedIssue=v.applyPending?'Chờ áp dụng proxy mới':proxyState==='BLOCKED'||v.ops==='PROXY_BLOCKED'?'Proxy đã ghi Blocked':v.ops==='SUSPENDED'?'Tài khoản đã ghi SUS':v.ops==='EARN_ERROR'?'Đã ghi lỗi EarnApp / VM':null;
  return {id:v.id,serverId:v.serverId,server:v.server,code:v.code,cycle:v.cycle,status:v.ops,recordedIssue,monitorCanary:canaryServers.has(v.serverId),agentHeartbeatFreshness:heartbeats.find(h=>h.serverId===v.serverId)?.agent.freshness,hasAccount:!!acc,hasPaypal:!!acc?.paypal?.emailId,payout:requests.some(r=>r.vmId===v.id&&r.cycle===v.cycle),health,
   money:moneyRead&&cur?{amount:cur.amount,observedAt:cur.amountObservedAt,failedAt:cur.amountFailedAt}:null,points};
 });
 return {...businessPulse(input,moneyRead,now),heartbeats};
}
