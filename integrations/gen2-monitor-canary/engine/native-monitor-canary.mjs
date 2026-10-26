// Opt-in lanes owned by the EXISTING EarnApp monitor. No guest command here.
import { httpsGetThroughProxy } from './proxy-transport.mjs';
export const CANARY_POLICY = Object.freeze({
  version:1, inventorySeconds:60, guestSeconds:600, proxySeconds:600, healthStaleSeconds:1200,
  heartbeatSeconds:60, heartbeatStaleSeconds:180, startupGraceSeconds:120, recheckSeconds:30,
  guestTimeoutSeconds:45, inventoryTimeoutSeconds:15, proxyTimeoutSeconds:8,
  guestConcurrency:1, proxyConcurrency:2, retryLimit:1, retryBackoffSeconds:30,
  telemetryFlushSeconds:30, queueMaxItems:1000, logMaxBytes:10485760, logRetentionDays:7, moneySeconds:86400,
});
const iso=ms=>new Date(ms).toISOString();
const copy=x=>JSON.parse(JSON.stringify(x));
const stateOf=r=>['RUNNING','PAUSED','ABORTED','POWERED_OFF','STARTING','STOPPING'].includes(r.state)?r.state:r.running===true?'RUNNING':'UNKNOWN';
const fresh=(at,now,seconds)=>!at?'UNKNOWN':now<Date.parse(at)?'UNKNOWN':now-Date.parse(at)>=seconds*1000?'STALE':'FRESH';
export function createCanaryLanes({listVms,acceptName,now,setTimer,clearTimer,serverId,
  readAppliedProxy=null,proxyCheck=httpsGetThroughProxy,proxyCheckUrl='https://api64.ipify.org?format=json',
  readHostNetwork=null,onSnapshot=()=>{},canProbe=()=>true,initialGuestQuarantine=false}={}) {
  let active=false,timer=null,inventoryCall=null,inventoryAt=null,inventoryReason=null,seq=0;
  let guestSlot={state:initialGuestQuarantine?'QUARANTINED':'IDLE',observedAt:iso(now()),reason:initialGuestQuarantine?'PREVIOUS_PROBE_UNVERIFIED':null};
  let rows=[];const samples=new Map(),proxyDue=new Map(),proxyCalls=new Set(),runningSince=new Map();
  const controllers=new Set();
  const stamp=()=>iso(now());
  function base(r,at){return {uuid:r.uuid,vmCode:r.name,configVersion:1,vmState:{observedAt:at,state:stateOf(r)},
    guest:{observedAt:at,additions:'UNKNOWN',response:'UNKNOWN'},
    app:{observedAt:at,earnApp:'UNKNOWN',sdk:'UNKNOWN',connection:'UNKNOWN'},
    network:{observedAt:at,provenance:'GUEST',ncsi:'UNKNOWN',https:'UNKNOWN'},
    service:'UNKNOWN',appliedProxy:'UNKNOWN',proxy:null,probeReason:'NOT_OBSERVED'};}
  function snapshot(){const at=now();return copy({configVersion:1,serverId,sequence:seq,sourceAt:stamp(),
    inventoryAt,inventoryReason,inventoryFreshness:fresh(inventoryAt,at,120),
    policy:CANARY_POLICY,proxyInFlight:proxyCalls.size,guestSlot,
    samples:[...samples.values()].map(s=>({...s,vmStateFreshness:fresh(s.vmState.observedAt,at,120),
      healthFreshness:s.probeReason==='NOT_OBSERVED'?'UNKNOWN':fresh(s.app.observedAt,at,1200),
      monitoringGap:s.probeReason!=='OK'||fresh(s.app.observedAt,at,1200)!=='FRESH'}))});}
  function publish(){seq++;try{return onSnapshot(snapshot())!==false;}catch{return false;}}
  function core(target,result,at){const s=samples.get(target.uuid);if(!s)return;
    const g=result?.ok===true?result.guest:null;
    const valid=!!g&&Number.isInteger(g.earnapp_process_count)&&g.earnapp_process_count>=0
      &&Number.isInteger(g.earnapp_conn?.established)&&g.earnapp_conn.established>=0
      &&Number.isInteger(g.updater_conn?.established)&&g.updater_conn.established>=0;
    const time=iso(at);const reason=result?.reason;
    s.probeReason=valid?'OK':reason==='GUEST_AUTH_FAILED'?'GUEST_AUTH_FAILED':/TIMEOUT/.test(reason||'')?'MONITOR_TIMEOUT':'UNREADABLE';
    s.guest={observedAt:time,additions:valid?'PRESENT':'UNKNOWN',response:valid?'RESPONSIVE':reason==='GUEST_AUTH_FAILED'?'AUTH_FAILED':/TIMEOUT/.test(reason||'')?'TIMEOUT':'UNKNOWN'};
    s.app={observedAt:time,earnApp:!valid?'UNKNOWN':g.earnapp_process_count===0?'STOPPED':g.earnapp_process_count===1&&g.earnapp?.running===true?'RUNNING':'UNKNOWN',
      sdk:valid&&g.updater?.running===true?'RUNNING':valid&&g.updater?.running===false?'STOPPED':'UNKNOWN',
      connection:valid?'NOT_OBSERVED':'UNKNOWN'};
    // Native --core-only presently supplies no verified NCSI/HTTPS, service or applied-route binding.
    // A globe flag and generic established TCP count cannot fill those fields.
    s.network={observedAt:time,provenance:'GUEST',ncsi:'UNKNOWN',https:'UNKNOWN'};
    publish();
  }
  async function refresh(){if(inventoryCall)return inventoryCall;
    inventoryCall=(async()=>{const at=stamp();let deadline=null,late=false;
      const call=Promise.resolve().then(listVms);
      deadline=setTimer(()=>{late=true;inventoryReason='INVENTORY_TIMEOUT';publish();},15000);
      try{const list=await call;if(!active||late)return;
        if(!Array.isArray(list)||list.length>1000)throw Error('INVALID_INVENTORY');
        const next=list.filter(r=>r&&r.uuid&&acceptName(String(r.name||''))).map(r=>({...r,uuid:String(r.uuid).toLowerCase(),state:stateOf(r)}));
        if(new Set(next.map(r=>r.uuid)).size!==next.length)throw Error('DUPLICATE_UUID');
        rows=next;const ids=new Set(rows.map(r=>r.uuid));
        for(const id of samples.keys())if(!ids.has(id)){samples.delete(id);proxyDue.delete(id);runningSince.delete(id);}
        for(const r of rows){const old=samples.get(r.uuid);if(r.state!=='RUNNING')runningSince.delete(r.uuid);
          else if(!old||old.vmState.state!=='RUNNING')runningSince.set(r.uuid,Date.parse(at));
          let s=old||base(r,at);s.vmCode=r.name;s.vmState={observedAt:at,state:r.state};samples.set(r.uuid,s);}
        inventoryAt=at;inventoryReason=null;publish();
      }catch{inventoryReason='INVENTORY_UNAVAILABLE';publish();}
      finally{clearTimer(deadline);inventoryCall=null;if(active){timer=setTimer(tick,Math.max(0,60000-(now()-Date.parse(at))));timer?.unref?.();}}
    })();return inventoryCall;
  }
  async function proxyOne(r){const ac=new AbortController();let timedOut=false;
    const at=stamp(),s=samples.get(r.uuid);if(!s)return;
    controllers.add(ac);
    let handle=setTimer(()=>{timedOut=true;ac.abort();s.proxy={observedAt:at,provenance:'HOST',tcp:'UNKNOWN',auth:'UNKNOWN',https:'TIMEOUT',reason:'TIMEOUT'};publish();},8000);
    // One deadline covers applied config read, optional host evidence, transport AND route re-read.
    try{const binding=await readAppliedProxy(r,{signal:ac.signal});if(!active||timedOut)return;
      if(!binding?.verified||binding.uuid!==r.uuid||!binding.routeRevision||!binding.proxy){
        s.proxy={observedAt:at,provenance:'HOST',tcp:'UNKNOWN',auth:'UNKNOWN',https:'UNKNOWN',reason:'APPLIED_PROXY_UNVERIFIED'};return;}
      const host=readHostNetwork?await readHostNetwork({signal:ac.signal}):null;if(!active||timedOut)return;
      const common={observedAt:at,provenance:'HOST',proxyAddressFingerprint:binding.proxyAddressFingerprint||null,tcp:'UNKNOWN',auth:'UNKNOWN',https:'UNKNOWN'};
      if(host?.https==='FAILED'&&host?.provenance==='HOST'){s.proxy={...common,reason:'HOST_NETWORK_UNAVAILABLE'};return;}
      const result=await proxyCheck(binding.proxy,proxyCheckUrl,{timeoutMs:Math.max(1,8000-(now()-Date.parse(at))),maxBytes:4096,signal:ac.signal});
      if(!active||timedOut)return;
      const after=await readAppliedProxy(r,{signal:ac.signal});if(!active||timedOut)return;
      if(!after?.verified||after.uuid!==r.uuid||after.routeRevision!==binding.routeRevision){s.proxy={...common,reason:'APPLIED_PROXY_CHANGED'};return;}
      // Transport exposes aggregate tunnel/TLS results, not independent TCP/auth stage receipts.
      const status=result?.status;
      s.proxy={...common,https:result?.ok===true&&status>=200&&status<300?'OK':status===403?'HTTP_403':status===429?'HTTP_429':result?.code==='TIMEOUT'?'TIMEOUT':'UNKNOWN',
        auth:result?.code==='AUTH_FAILED'?'FAILED':'UNKNOWN',reason:result?.code==='AUTH_FAILED'?'AUTH_FAILED':result?.code==='TIMEOUT'?'TIMEOUT':result?.ok===true&&status>=200&&status<300?'HOST_HTTPS_OK':'ENDPOINT_OR_TRANSPORT_ERROR'};
    }catch{if(active&&!timedOut)s.proxy={observedAt:at,provenance:'HOST',tcp:'UNKNOWN',auth:'UNKNOWN',https:'UNKNOWN',reason:'PROXY_UNREADABLE'};}
    finally{clearTimer(handle);controllers.delete(ac);publish();}
  }
  function pumpProxy(){if(!active||!readAppliedProxy)return;
    for(const r of rows){if(proxyCalls.size>=2)break;if((proxyDue.get(r.uuid)??0)>now()||!canProbe(r))continue;
      proxyDue.set(r.uuid,now()+600000);
      const job={ac:null,promise:null};proxyCalls.add(job);
      job.promise=proxyOne(r).finally(()=>{proxyCalls.delete(job);pumpProxy();});
    }
  }
  function tick(){timer=null;return refresh().then(pumpProxy);}
  return {core,snapshot,getRows:()=>rows,isStartupGrace:uuid=>runningSince.has(uuid)&&now()-runningSince.get(uuid)<120000,
    setGuestSlot(state,reason=null){guestSlot={state,reason,observedAt:stamp()};return publish();},
    async start(){if(active)return;active=true;await refresh();pumpProxy();},
    async stop(){active=false;if(timer)clearTimer(timer);for(const ac of controllers)ac.abort();await inventoryCall;await Promise.all([...proxyCalls].map(j=>j.promise));},
  };
}
