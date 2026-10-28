import {vmMoneyState} from './vm-money';
import {MONITOR_POLICY,monitorFreshness,monitorProjection,type MonitorObservationInput,type Freshness} from './monitor-policy';
import type {MonitorHeartbeats} from '@/server/dashboard/monitor';

export type ScanProblem='EARNAPP'|'PROXY_CONNECTION'|'PROXY_AUTH'|'PROXY_EXPIRED'|'PROXY_BLOCKED'|'VM_OFF';
export interface ScanHealth {at:string;earning:boolean|null;problem:ScanProblem|null;observedAt?:string;receivedAt?:string;monitor?:MonitorObservationInput}
export interface PulseInput {
 id:string;serverId:string;server:string;code:string;cycle:number;status:string|null;
 hasAccount:boolean;hasPaypal:boolean;payout:boolean;health:ScanHealth|null;
 recordedIssue?:string|null;
 /** Set by the authorized server projection, never inferred from a scan or Central contact. */
 monitorCanary?:boolean;agentHeartbeatFreshness?:Freshness;
 money:{amount:string|null;observedAt:string|null;failedAt:string|null}|null;
 /** Caller has already checked exact SDK, VM and cycle binding. */
 points:{at:string;amount:string}[];
}
export const HEALTH_LABEL={GOOD:'Đang kiếm tiền',ERROR:'Có lỗi',UNKNOWN:'Chưa xác minh',PAUSED:'Tạm dừng',NEW:'Chưa cài'} as const;
export const PROBLEM_LABEL:Record<ScanProblem,string>={EARNAPP:'EarnApp không hoạt động',PROXY_CONNECTION:'Proxy mất kết nối',PROXY_AUTH:'Proxy sai xác thực',PROXY_EXPIRED:'Proxy hết hạn',PROXY_BLOCKED:'EarnApp chặn proxy',VM_OFF:'VM không chạy'};
const micros=(s:string)=>{if(!/^\d+(\.\d{1,6})?$/.test(s))return null;const [w,d='']=s.split('.');return BigInt(w)*BigInt(1000000)+BigInt(d.padEnd(6,'0'));};
const text=(n:bigint)=>{const unit=BigInt(1000000),d=(n%unit).toString().padStart(6,'0').replace(/0+$/,'');return (n/unit).toString()+(d?'.'+d:'');};
export function vietnamDay(now:Date){return new Date(now.getTime()+7*3600e3).toISOString().slice(0,10);}
/** windowStart: start of the money-trend window (default: today 00:00 Vietnam; the 10:00 Telegram report uses the last 24 h). */
export function businessPulse(input:PulseInput[],moneyRead:boolean,now:Date=new Date(),windowStart?:Date){
 const day=vietnamDay(now),start=windowStart?windowStart.getTime():Date.parse(day+'T00:00:00+07:00');
 const rows=input.map(v=>{
  const scan=v.health,validScan=!!scan&&monitorFreshness(scan.at,now)==='FRESH'&&(!scan.monitor||scan.monitor.configVersion===MONITOR_POLICY.version);
  const monitor=monitorProjection(scan?.monitor,now),nativeState=scan?.monitor?.vmState?.state;
  const contradictsEarning=monitor.vmState==='FRESH'&&nativeState!==undefined&&nativeState!=='RUNNING'&&nativeState!=='UNKNOWN';
  const canConfirmEarning=(!v.monitorCanary||v.agentHeartbeatFreshness==='FRESH')&&!contradictsEarning;
  const earning=validScan&&scan?.earning!==undefined?(scan.earning===true&&!canConfirmEarning?null:scan.earning):null;
  const health: keyof typeof HEALTH_LABEL=v.status==='OFF'?'PAUSED':v.status==='NEW_VM'?'NEW':validScan&&scan?.problem?'ERROR':earning===true&&!v.recordedIssue?'GOOD':'UNKNOWN';
  const state=vmMoneyState(moneyRead&&v.money?{...v.money,code:'current',moneyHidden:false}:null,now);
  const fresh=state.kind==='OK'&&!!state.at&&Date.parse(state.at)<=now.getTime();
  const amount=moneyRead&&'amount' in state?state.amount:null,observedAt=moneyRead&&'at' in state?state.at:null;
  const a=amount===null?null:micros(amount),active=health!=='PAUSED'&&health!=='NEW';
  const threshold=moneyRead?(active&&fresh&&a!==null?(a>=BigInt(10000000)?'ENOUGH':a>=BigInt(8000000)?'SOON':'LOW'):'UNKNOWN'):null;
  const points=v.points.filter(p=>Date.parse(p.at)>=start&&Date.parse(p.at)<=now.getTime()&&micros(p.amount)!==null).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const unique=points.filter((p,i)=>!i||p.at!==points[i-1].at);
  let trend:'INCREASING'|'FLAT'|'DECREASED'|'UNKNOWN'|null=moneyRead?'UNKNOWN':null,delta:string|null=null;
  if(moneyRead&&active&&fresh&&unique.length>=2){
   const decreasing=unique.some((p,i)=>i>0&&micros(p.amount)!<micros(unique[i-1].amount)!);
   if(decreasing)trend='DECREASED';else {const d=micros(unique[unique.length-1].amount)!-micros(unique[0].amount)!;trend=d>BigInt(0)?'INCREASING':'FLAT';delta=text(d);}
  }
  const steps=moneyRead?[...(!v.hasAccount?['Chưa gán EarnApp']:[]),...(!v.hasPaypal?['Chưa có email PayPal']:[]),...(v.payout?['Đã có yêu cầu rút']:[])]:[];
  return {id:v.id,serverId:v.serverId,server:v.server,code:v.code,health,checkedAt:scan?.observedAt??scan?.at??null,earningCheckedAt:scan?.at??null,receivedAt:scan?.receivedAt??null,freshness:monitorFreshness(scan?.observedAt??scan?.at,now),monitor,earning,problem:validScan?scan?.problem??null:null,recordedIssue:v.recordedIssue??null,
   amount,observedAt,moneyState:moneyRead?state.kind:'HIDDEN',threshold,trend,delta,steps,
   decreaseNote:trend==='DECREASED'?(v.payout?'Có yêu cầu rút; đối chiếu lần giảm tiền':'Số dư giảm; cần đối chiếu') :null};
 });
 const count=(key:keyof typeof HEALTH_LABEL)=>rows.filter(r=>r.health===key).length;
 const growth=moneyRead?{amount:rows.some(r=>r.delta!==null)?text(rows.reduce((s,r)=>s+(r.delta===null?BigInt(0):micros(r.delta)!),BigInt(0))):null,
  increasing:rows.filter(r=>r.trend==='INCREASING').length,flat:rows.filter(r=>r.trend==='FLAT').length,decreased:rows.filter(r=>r.trend==='DECREASED').length,
  unknown:rows.filter(r=>r.trend==='UNKNOWN'&&!['PAUSED','NEW'].includes(r.health)).length,covered:rows.filter(r=>r.delta!==null).length}:null;
 return {day,generatedAt:now.toISOString(),moneyRead,health:{total:rows.length,active:rows.length-count('PAUSED')-count('NEW'),good:count('GOOD'),error:count('ERROR'),unknown:count('UNKNOWN'),paused:count('PAUSED'),new:count('NEW')},growth,
  withdrawal:moneyRead?{soon:rows.filter(r=>r.threshold==='SOON').length,enough:rows.filter(r=>r.threshold==='ENOUGH').length,amount:text(rows.filter(r=>r.threshold==='ENOUGH').reduce((s,r)=>s+micros(r.amount!)!,BigInt(0)))}:null,rows};
}
export type BusinessPulse=ReturnType<typeof businessPulse>&{heartbeats?:MonitorHeartbeats};
