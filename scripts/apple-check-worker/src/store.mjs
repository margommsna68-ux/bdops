import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export async function noLinks(target){
  const full=path.resolve(target),parsed=path.parse(full);let current=parsed.root;
  for(const part of full.slice(parsed.root.length).split(path.sep).filter(Boolean)){
    current=path.join(current,part);
    const stat=await fs.lstat(current).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(stat?.isSymbolicLink())throw new Error('UNSAFE_LINK');
  }
  return full;
}
export async function atomicJson(file,value){
  await noLinks(file);const temp=`${file}.${randomUUID()}.tmp`;
  const h=await fs.open(temp,'wx',0o600);
  try{await h.writeFile(JSON.stringify(value));await h.sync();}finally{await h.close();}
  await noLinks(file);await fs.rename(temp,file);
  // Flush the containing directory where supported; Windows refuses directory handles.
  try{const d=await fs.open(path.dirname(file),'r');try{await d.sync();}finally{await d.close();}}catch(e){if(!['EISDIR','EPERM','EINVAL','EACCES'].includes(e.code))throw e;}
}
const PROFILE=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const phases=new Set(['CLAIMED','SUBMITTING','REPORTING']);
const results=new Set(['LOGIN_SUCCESS','LIVE_2FA','APPLE_LOCKED','CHALLENGE_REQUIRED','INVALID_CREDENTIALS','PROXY_ERROR','NETWORK_ERROR','TIMEOUT','UNKNOWN','CANCELLED']);
const diagnostics=new Set(['EMAIL_FORM_MISSING','PASSWORD_FORM_MISSING','SUBMIT_BUTTON_MISSING','RESPONSE_UNRECOGNIZED','BROWSER_INTERRUPTED','CREDENTIAL_DELIVERY_FAILED','EMAIL_ENTRY_FAILED','PASSWORD_SUBMIT_FAILED','RESPONSE_READ_FAILED']);
function cleanRecord(p){
  if(typeof p.jobId!=='string'||!p.jobId||!PROFILE.test(p.profileId)||!phases.has(p.phase))throw new Error('JOURNAL_INVALID');
  const value={jobId:p.jobId,profileId:p.profileId,phase:p.phase};
  if(p.leaseToken!==undefined){if(typeof p.leaseToken!=='string'||!p.leaseToken)throw new Error('JOURNAL_INVALID');value.leaseToken=p.leaseToken;}
  if(p.claim){const c=p.claim;value.claim={id:c.id,leaseToken:c.leaseToken,accountId:c.accountId,accountRevision:c.accountRevision,expiresAt:c.expiresAt};}
  if(p.report){
    const r=p.report;
    if(!results.has(r.result)||!(r.reasonCode===r.result||r.result==='UNKNOWN'&&diagnostics.has(r.reasonCode))||!['OK','FAILED'].includes(r.cleanup)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(r.observedAt)||!Number.isFinite(Date.parse(r.observedAt)))throw new Error('JOURNAL_INVALID');
    value.report={result:r.result,reasonCode:r.reasonCode,cleanup:r.cleanup,observedAt:r.observedAt};
  }
  return value;
}
async function scan(directory){
  await noLinks(directory);const entries=[];
  for(const name of await fs.readdir(directory)){
    const file=path.join(directory,name);const s=await fs.lstat(file);
    if(s.isSymbolicLink())throw new Error('UNSAFE_LINK');
    if(s.isDirectory())entries.push(...await scan(file),{file,dir:true});
    else if(s.isFile())entries.push({file,dir:false});else throw new Error('UNSAFE_FILE');
  }
  return entries;
}
export class Store {
  static async open(root){
    if(!path.isAbsolute(root)||path.resolve(root)===path.parse(root).root)throw new Error('STATE_ROOT');
    await noLinks(root);await fs.mkdir(root,{recursive:true,mode:0o700});await noLinks(root);
    const store=new Store();store.root=path.resolve(root);
    await fs.mkdir(path.join(root,'profiles'),{recursive:true,mode:0o700});await noLinks(path.join(root,'profiles'));
    return store;
  }
  async read(name){await noLinks(path.join(this.root,name));return JSON.parse(await fs.readFile(path.join(this.root,name),'utf8'));}
  async write(name,data){await atomicJson(path.join(this.root,name),data);}
  async remove(name){await noLinks(path.join(this.root,name));await fs.unlink(path.join(this.root,name)).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  async load(){try{return cleanRecord(await this.read('pending.json'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  async save(p){await this.write('pending.json',cleanRecord(p));}
  profilePath(id){if(!PROFILE.test(id))throw new Error('PROFILE_ID');return path.join(this.root,'profiles',id);}
  async createProfile(){
    const id=randomUUID(),target=this.profilePath(id);await noLinks(target);await fs.mkdir(target,{mode:0o700});
    await fs.writeFile(path.join(target,'.owner'),id,{flag:'wx',mode:0o600});return {id,path:target};
  }
  async cleanup(id){
    const target=this.profilePath(id);await noLinks(target);
    try{await fs.lstat(target);}catch(e){if(e.code==='ENOENT')return;throw e;}
    await noLinks(path.join(target,'.owner'));
    if(await fs.readFile(path.join(target,'.owner'),'utf8')!==id)throw new Error('PROFILE_OWNER');
    const entries=await scan(target),marker=path.join(target,'.owner'); // Validate whole tree before deleting anything.
    for(const e of entries){if(e.file===marker)continue;await noLinks(e.file);if(e.dir)await fs.rmdir(e.file);else await fs.unlink(e.file);}
    await noLinks(target);await fs.unlink(marker);
    try{await fs.rmdir(target);}catch(e){
      // Keep the proof needed for retry if Windows refuses to remove the empty directory.
      await noLinks(target);await fs.writeFile(marker,id,{flag:'wx',mode:0o600});throw e;
    }
  }
  async lock(){
    const file=path.join(this.root,'worker.lock');await noLinks(file);
    let handle;try{handle=await fs.open(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new Error('WORKER_LOCKED');throw e;}
    await handle.writeFile(JSON.stringify({pid:process.pid,nonce:randomUUID()}));await handle.sync();await handle.close();
    return ()=>this.remove('worker.lock');
  }
}
