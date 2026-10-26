// Fixed product readers: one host inventory call; exact VM's applied ProxyForce metadata.
import crypto from 'node:crypto';
import { parseProxyExtradata } from './proxy-blacklist.mjs';
const uuidRe=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
export async function readNativeInventory(vbox) {
  const r=await vbox(['list','vms','-l'],15000);
  if(r?.code!==0||r.timedOut)throw Error('INVENTORY_UNAVAILABLE');
  const text=String(r.out||'');if(text.length>8*1024*1024)throw Error('INVENTORY_TOO_LARGE');
  const rows=[];let current=null;
  for(const line of text.split(/\r?\n/)){
    const head=line.match(/^Name:\s{2,}(.+?)\s*$/);
    if(head&&!head[1].startsWith("'")){current={name:head[1]};rows.push(current);continue;}
    if(!current)continue;
    const id=line.match(/^UUID:\s{2,}([0-9a-f-]+)\s*$/i);if(id)current.uuid=id[1].toLowerCase();
    const state=line.match(/^State:\s{2,}(.+?)(?:\s+\(since.*)?$/);if(state&&!current.state){
      const raw=state[1].toLowerCase().trim();
      current.state=({'running':'RUNNING','paused':'PAUSED','aborted':'ABORTED','powered off':'POWERED_OFF','poweroff':'POWERED_OFF',
        'starting':'STARTING','stopping':'STOPPING','saving':'STOPPING','restoring':'STARTING'})[raw]||'UNKNOWN';
    }
  }
  if((!rows.length&&text.trim())||rows.length>1000||rows.some(r=>!uuidRe.test(r.uuid||'')||!r.state)
    ||new Set(rows.map(r=>r.uuid)).size!==rows.length)throw Error('INVENTORY_INVALID');
  return rows.map(r=>({...r,running:r.state==='RUNNING'}));
}
export async function readNativeAppliedProxy(vbox,vm,{signal}={}) {
  if(signal?.aborted||!uuidRe.test(vm?.uuid||''))return {verified:false};
  const r=await vbox(['getextradata',vm.uuid,'enumerate'],8000);
  if(signal?.aborted||r?.code!==0||r.timedOut)return {verified:false};
  // Credentials never leave this in-memory return to the transport lane; not a public snapshot.
  const parsed=parseProxyExtradata(r.out);
  const keys=[...String(r.out||'').matchAll(/Config\/(ProxyForce|ProxyHost|ProxyPort|ProxyType|ProxyUser|ProxyPass|ProxyDNS)\s*,\s*Value:/gi)].map(m=>m[1].toLowerCase());
  if(!parsed.valid||new Set(keys).size!==keys.length)return {verified:false};
  const proxy={kind:parsed.route,host:parsed.host,port:parsed.port,username:parsed.username,password:parsed.password};
  const proxyAddressFingerprint=crypto.createHash('sha256').update(`${proxy.host.trim().toLowerCase()}|${proxy.port}`).digest('hex');
  return {verified:true,uuid:vm.uuid,proxyAddressFingerprint,routeRevision:hash([vm.uuid,proxy,parsed.proxyDns]),proxy};
}
