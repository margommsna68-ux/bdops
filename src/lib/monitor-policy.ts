import {z} from 'zod';

// Storage tolerance only. Source/receipt clocks remain intact; future evidence
// still has UNKNOWN freshness and cannot prove a healthy axis.
export const MAX_MONITOR_CLOCK_SKEW_MS=5000;

/** Wire contract shared by the web and collectors. Changes require a new version. Seconds unless named otherwise. */
export const MONITOR_POLICY=Object.freeze({
 version:1, inventorySeconds:60, guestSeconds:600, proxySeconds:600, healthStaleSeconds:1200,
 heartbeatSeconds:60, heartbeatStaleSeconds:180, startupGraceSeconds:120, recheckSeconds:30,
 guestTimeoutSeconds:45, inventoryTimeoutSeconds:15, proxyTimeoutSeconds:8,
 guestConcurrency:1, proxyConcurrency:2, retryLimit:1, retryBackoffSeconds:30,
 telemetryFlushSeconds:30, queueMaxItems:1000, logMaxBytes:10485760, logRetentionDays:7,
 moneySeconds:86400,
} as const);
export type Freshness='FRESH'|'STALE'|'UNKNOWN'|'UNSUPPORTED';
export function monitorFreshness(at:string|null|undefined,now:Date,seconds:number=MONITOR_POLICY.healthStaleSeconds):Freshness {
 if(!at)return 'UNKNOWN';
 const age=now.getTime()-Date.parse(at);
 return !Number.isFinite(age)||age<0?'UNKNOWN':age>=seconds*1000?'STALE':'FRESH';
}
export const monitorId=z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const time=z.string().datetime({offset:true});
const probe=z.enum(['OK','FAILED','TIMEOUT','HTTP_403','HTTP_429','UNKNOWN']);
export const MonitorObservation=z.object({
 configVersion:z.number().int().min(1).max(100000),
 vmState:z.object({observedAt:time,state:z.enum(['RUNNING','PAUSED','ABORTED','POWERED_OFF','STARTING','STOPPING','UNKNOWN'])}).strict().optional(),
 guest:z.object({observedAt:time,additions:z.enum(['PRESENT','ABSENT','UNKNOWN']),response:z.enum(['RESPONSIVE','AUTH_FAILED','TIMEOUT','UNAVAILABLE','UNKNOWN'])}).strict().optional(),
 network:z.object({observedAt:time,provenance:z.enum(['HOST','GUEST']),ncsi:z.enum(['INTERNET','LIMITED','NONE','UNKNOWN']),https:probe}).strict().optional(),
 proxy:z.object({observedAt:time,provenance:z.enum(['HOST','GUEST']),endpointId:monitorId,appliedConfigurationId:monitorId.nullable(),tcp:probe,auth:z.enum(['OK','FAILED','NOT_TESTED','UNKNOWN']),https:probe}).strict().optional(),
 app:z.object({observedAt:time,earnApp:z.enum(['RUNNING','STOPPED','UNKNOWN']),sdk:z.enum(['RUNNING','STOPPED','UNKNOWN']),connection:z.enum(['VERIFIED','NOT_OBSERVED','UNKNOWN'])}).strict().optional(),
}).strict();
export type MonitorObservationInput=z.infer<typeof MonitorObservation>;
export function monitorProjection(m:MonitorObservationInput|undefined,now:Date){
 const unsupported=!!m&&m.configVersion!==MONITOR_POLICY.version;
 const axis=(v:{observedAt:string}|undefined)=>unsupported?'UNSUPPORTED' as const:monitorFreshness(v?.observedAt,now);
 const vmState=unsupported?'UNSUPPORTED' as const:monitorFreshness(m?.vmState?.observedAt,now,MONITOR_POLICY.inventorySeconds*2),guest=axis(m?.guest),network=axis(m?.network),proxy=axis(m?.proxy),app=axis(m?.app);
 return {configVersion:m?.configVersion??null,vmState,guest,network,proxy,app,
  running:vmState==='FRESH'&&m?.vmState?.state==='RUNNING',
  // HOST success, NCSI, authentication failure and an absent TCP sample never prove guest health or earning.
  guestNetworkVerified:network==='FRESH'&&m?.network?.provenance==='GUEST'&&m.network.https==='OK',
  guestProxyVerified:proxy==='FRESH'&&m?.proxy?.provenance==='GUEST'&&!!m.proxy.appliedConfigurationId&&m.proxy.tcp==='OK'&&m.proxy.auth==='OK'&&m.proxy.https==='OK',
  appConnectionVerified:app==='FRESH'&&m?.app?.connection==='VERIFIED',
 };
}
