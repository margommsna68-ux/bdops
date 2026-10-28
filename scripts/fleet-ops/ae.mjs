import {execFile} from 'node:child_process';
// Operational AE adapter (28/10/2026). It only shapes argv for the INSTALLED AE client entry (Claude Fleet\ae.ps1 -> VM Control\tools\OPS\ae-ai.ps1,
// protocol 2) and parses its one-line JSON answer. No shell, no UI automation, no command outside this allow-list.
export const COMMANDS=Object.freeze(['doctor','vm-info','vm-list','vm-start-headless','vm-shutdown','vm-power-off','check-ip','proxy-pool','inbox-put',
 'proxy-draft-import','proxy-replace-preview','proxy-replace','vm-recreate-preview','vm-recreate','result','progress']);
const HOST=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,VM=/^(VM_|m_)\d{1,4}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,ID=/^[A-Za-z0-9._-]{8,100}$/;
export class AeError extends Error{constructor(code,message){super(message?code+': '+message:code);this.code=code;}}
const need=(ok,code,message)=>{if(!ok)throw new AeError(code,message);};
/** AE request ids are stable per operation + step so a timed-out effect is re-read, never re-issued. */
export function requestId(operationId,step){const id='mth-'+operationId+'-'+step;need(ID.test(id),'BAD_ID');return id;}
export function aeArgs(script,o){
 need(typeof script==='string'&&script.endsWith('.ps1'),'BAD_SCRIPT');
 need(COMMANDS.includes(o.cmd),'COMMAND_DENIED',o.cmd);
 need(HOST.test(o.host||''),'BAD_HOST');
 const a=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,o.cmd,'-Host',o.host];
 if(o.vm!==undefined){need(VM.test(o.vm),'BAD_VM');a.push('-Vm',o.vm);}
 if(o.vms!==undefined){need(Array.isArray(o.vms)&&o.vms.length>0&&o.vms.every(v=>VM.test(v)),'BAD_VM');a.push('-Vms',o.vms.join(','));}
 if(o.uuid!==undefined){need(UUID.test(o.uuid),'BAD_UUID');a.push('-Uuid',o.uuid.toLowerCase());}
 if(o.set!==undefined){
  need(o.set&&typeof o.set==='object'&&!Array.isArray(o.set),'BAD_SET');
  const parts=Object.entries(o.set).map(([k,v])=>{need(/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k)&&!/pass|secret|token/i.test(k),'BAD_SET',k);const s=String(v);need(!/[|\r\n]/.test(s)&&s.length<=400,'BAD_SET',k);return k+'='+s;});
  a.push('-Set',parts.join('|'));
 }
 if(o.id!==undefined){need(ID.test(o.id),'BAD_ID');a.push('-Id',o.id);}
 if(o.request!==undefined){need(ID.test(o.request),'BAD_ID');a.push('-Request',o.request);}
 if(o.source!==undefined){need(typeof o.source==='string'&&/^[A-Za-z]:[\\/][^|\r\n"]{1,240}$/.test(o.source),'BAD_SOURCE');a.push('-Source',o.source);}
 const t=o.timeoutSec??120;need(Number.isInteger(t)&&t>=5&&t<=3600,'BAD_TIMEOUT');a.push('-TimeoutSec',String(t));
 return a;
}
export function parseAnswer(stdout){
 const lines=String(stdout||'').trim().split(/\r?\n/).filter(l=>l.trim());
 for(let i=lines.length-1;i>=0;i--){const l=lines[i].trim();if(l.startsWith('{')){try{const v=JSON.parse(l);need(typeof v.ok==='boolean'&&typeof v.code==='string','AE_PROTOCOL_ERROR');return v;}catch(e){if(e instanceof AeError)throw e;throw new AeError('AE_PROTOCOL_ERROR');}}}
 throw new AeError('AE_PROTOCOL_ERROR','no JSON answer');
}
export function createAe({script,powershell='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',exec=execFile}){
 return {
  /** One AE call. Resolves to the parsed envelope (ok:false answers are returned, not thrown); process/transport failures throw AE_OUTCOME_UNKNOWN. */
  call(o){
   const args=aeArgs(script,o),timeoutMs=((o.timeoutSec??120)+30)*1000;
   return new Promise((resolve,reject)=>{
    exec(powershell,args,{shell:false,windowsHide:true,timeout:timeoutMs,maxBuffer:4*1024*1024,encoding:'utf8'},(error,stdout)=>{
     if(error&&!stdout)return reject(new AeError('AE_OUTCOME_UNKNOWN',String(error.code||error.message)));
     try{resolve(parseAnswer(stdout));}catch(e){reject(e);}
    });
   });
  }
 };
}
/** VirtualBox state (AE vm-info / vm-list) -> fleet evidence state. */
export function vmStateOf(state){
 const s=String(state||'').toLowerCase();
 return s==='running'?'RUNNING':s==='poweroff'?'POWERED_OFF':s==='paused'?'PAUSED':s==='aborted'?'ABORTED':'UNKNOWN';
}
