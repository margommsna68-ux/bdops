#!/usr/bin/env node
// MoneyToHome ops API client (21/10/2026; no PIN since 23/10/2026). Reads the token from the environment (MTH_TOKEN) or from a local
// secret file (default ~/.mth/ops-secret.json, or MTH_SECRET_FILE; an old file that still holds a `pin` is read and the pin ignored).
// It never prints the token, request headers or the environment.
//
//   node scripts/ops-client.mjs init                     # in YOUR own terminal (not through a chat): asks the token without echo
//   node scripts/ops-client.mjs me | projects
//   node scripts/ops-client.mjs resolve <projectId> <serverCode> <vmCode>
//   node scripts/ops-client.mjs vm <projectId> <vmId>
//   node scripts/ops-client.mjs get '<path?query>'       # any GET under /api/ops/v1/, e.g. 'withdrawals?projectId=…&status=PREPARING'
//   node scripts/ops-client.mjs post <path> <body.json> [--key <Idempotency-Key>]
//   node scripts/ops-client.mjs batch <file.json> [--key K]
//       # {projectId,items:[{method:'POST',path,body,idempotencyKey}]} (1–100 distinct item keys).
//       # <file.json>.run.json remembers the outer key; reruns/retry resend ALL original items with unchanged keys.
//       # DONE items business-replay. Exit 4 waiting; exit 1 PARTIAL (inspect item states), exit 3 unknown.
//   node scripts/ops-client.mjs approve <approvalId> --admin <username> [--totp-stdin]
//       # hidden TTY by default; --totp-stdin reads ONE code from stdin. Never pass a code as an argument.
//       # Sends confirm ONCE, outside the journal, then retries its local command on APPROVED only.
// Stock uses generic get/post (bodies are captured facts; never refresh revisions automatically):
//   get 'earnapp-accounts?projectId=P&state=UNUSED&type=GMAIL&limit=50'
//   get 'proxies?projectId=P&state=FREE&group=TUT' | get 'sdks?projectId=P'
//   post earnapp-accounts/hold body.json  # projectId,vmId,expectedCycle,expectedVmRevision,jobId,loginType
//   post earnapp-accounts/A/login-issue issue.json # observed Locked/Verify/Disabled; auto replacement; read current login revision first
//   post earnapp-accounts/A/credentials body.json # projectId,vmId,jobId; current rights/job; direct; file only
//   post earnapp-accounts/A/used body.json # projectId,vmId,expectedCycle,jobId,expectedRevision,evidence[,sdkId,expectedSdkRevision]
//   post earnapp-accounts/A/release body.json # projectId,vmId,expectedCycle,jobId,expectedRevision,reason
//   post vms/V/proxy-assign body.json # projectId,expectedCycle,expectedVmRevision,jobId,proxyId OR pick:{group,packageCode?}
//   post vms/V/sdk-assign body.json # projectId,expectedCycle,expectedVmRevision,jobId,sdkId,expectedSdkRevision
//   post vms/V/sdk-linked body.json # projectId,expectedCycle,jobId,sdkId,expectedSdkRevision,accountId,evidence
// Credentials (also generic post/retry and nested batch results) go to ACL-private files only.
// MTH_RUNTIME_DIR overrides ~/.mth/runtime; remove credential files after use. Batch SDK reveals are file-only too.
//   node scripts/ops-client.mjs retry <Idempotency-Key>  # send the SAME command again (same path, body and key) after a lost answer
//   node scripts/ops-client.mjs pending                  # commands whose result is not known yet
//   node scripts/ops-client.mjs approvals                # critical commands waiting for an ADMIN's approval on the web (23/10/2026)
//   node scripts/ops-client.mjs sdk-reveal <projectId> <sdkId> [--key K]
//                                   # POST sdks/<sdkId>/reveal (direct with VM_OPS): the full SDK code is printed ONCE to stdout and never
//                                   # written to the command log (reads show codes masked: 4 first + … + 4 last)
//   node scripts/ops-client.mjs sdk-prepare <projectId> <vmId|server/vm>... [--code C]... [--out <capture.json>]
//                                   # BEFORE reading the machines: the web identity of each VM (round, VM revision, revisions of its
//                                   # SDK codes) with capturedAt; the survey fills observedAt / source / evidence / sdks into it
//   node scripts/ops-client.mjs sdk-check <survey.json>  # the filled survey, checked on this machine: capture present and before the
//                                   # read, codes, money, same code on several VMs, two amounts for one code, …; sends nothing
//   node scripts/ops-client.mjs sdk-observe <one-vm.json> [--key K]
//                                   # ONE captured + surveyed VM → POST vms/<vmId>/sdk-observations (22/10/2026); nothing is read
//                                   # from the web at send time (an old survey is never rebound to the VM as it is now)
//   node scripts/ops-client.mjs sdk-survey <survey.json> [--state <file>] [--redo <vmId>]
//                                   # the whole survey, VM by VM, with a result per line; a run file keeps each VM's key and body
//                                   # (default <survey.json>.run.json): a rerun skips VMs already recorded, retries unknown ones with
//                                   # the SAME key and body, and leaves refused ones for a person (--redo <vmId> after checking:
//                                   # the same captured entry again; a changed round / revision needs a new sdk-prepare + survey)
//   node scripts/ops-client.mjs proxy <projectId> <vmId> <jobId> <cycle> [--out <file>]
//                                   # full proxy of the VM in hand → private file for AE Mini Tool (default ~/.mth/proxy/<vmId>.json);
//                                   # never printed, never in the command log. Delete the file once the machine is configured.
//
// Writes (review fix 21/10/2026): the key and the body are written to a local command log (~/.mth/ops-journal, or MTH_JOURNAL_DIR;
// never the token) and the key is printed BEFORE the request is sent. If the answer is lost the result is "Chưa xác định kết
// quả": the command may have been recorded; run `retry <key>` (never a new key). A key is never reused for a different body.
// Secrets go only to MTH_BASE's own origin under /api/ops/v1/ (no "..", no encoded traversal, no redirects); https only, except a
// local test server on localhost.
// Second review fix 21/10/2026: a write is settled (DONE / ANSWERED) only by a well-formed {ok, data, error} answer with a meaning in the
// contract (2xx + ok:true, or 4xx + ok:false with an error code). 5xx (a gateway 502 / 503 / 504 may come after the app recorded it),
// HTML, a broken envelope or an unreadable body stay UNKNOWN in pending. Each command is stored under sha256(exact key), so keys that
// differ only by ":" / "_" or letter case never share a file; a record is used only when its key matches exactly.
// Third review fix 21/10/2026: the command's state is kept apart from the latest attempt (see nextState); a refused retry of a
// command that may already be recorded keeps it UNKNOWN, and a DONE command stays DONE. Exit code = command state (0 / 1 / 3).
// 23/10/2026 (2FA + approvals, owner decision): no X-Ops-Pin any more. A critical command (withdrawals/prepare, withdrawals/{id}/status,
// withdrawals/{id}/receipts) answers HTTP 202 APPROVAL_REQUIRED until an ADMIN approves it
// on the web (Phê duyệt): the command is NOT recorded, its state is WAITING_APPROVAL (exit 4) and `retry <key>` sends the SAME body
// again (200 → DONE; 403 APPROVAL_REJECTED → REJECTED, final; 410 APPROVAL_EXPIRED → EXPIRED, send again with a NEW key). `approvals`
// lists the waiting commands. SDK codes in read answers are masked; only sdk-reveal shows one in full, on stdout, never in the log.
import {readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync,readdirSync,renameSync,unlinkSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const PREFIX='/api/ops/v1/';
const FILE=process.env.MTH_SECRET_FILE||join(homedir(),'.mth','ops-secret.json');
const JOURNAL=process.env.MTH_JOURNAL_DIR||join(homedir(),'.mth','ops-journal');
const die=(m,code=2)=>{console.error(m);process.exit(code);};
function baseUrl(){
  let u;try{u=new URL(process.env.MTH_BASE||'https://moneytohome.up.railway.app');}catch{die('MTH_BASE không phải URL hợp lệ');}
  const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  if(u.protocol!=='https:'&&!(u.protocol==='http:'&&local))die('MTH_BASE phải là https:// (http chỉ cho localhost khi thử)');
  if(u.username||u.password)die('MTH_BASE không được chứa thông tin đăng nhập');
  return u;
}
/** The full URL for a path under /api/ops/v1/, or a refusal: secrets are attached only to this origin and prefix. */
export function opsUrl(path,base=baseUrl()){
  const raw=String(path);let decoded=raw;
  for(let i=0;i<3;i++){try{const d=decodeURIComponent(decoded);if(d===decoded)break;decoded=d;}catch{throw new Error('Đường dẫn mã hoá không hợp lệ');}}
  const [p]=decoded.split(/[?#]/);
  if(/^[a-z][a-z0-9+.-]*:/i.test(raw)||raw.startsWith('/')||raw.includes('\\')||p.includes('\\')||p.split('/').some(s=>s==='..'||s==='.')||/%2e|%2f|%5c/i.test(raw.split(/[?#]/)[0])||raw.includes('@'))
    throw new Error('Đường dẫn ngoài /api/ops/v1/ bị từ chối: '+raw.slice(0,60));
  const url=new URL(PREFIX+raw,base.origin);
  if(url.origin!==base.origin||!url.pathname.startsWith(PREFIX))throw new Error('Đường dẫn ngoài /api/ops/v1/ bị từ chối');
  return url;
}
function secrets(){
  if(process.env.MTH_TOKEN)return {token:process.env.MTH_TOKEN};
  if(existsSync(FILE)){const j=JSON.parse(readFileSync(FILE,'utf8'));if(!j?.token)die('File bí mật '+FILE+' không có token; chạy lại "init".');return {token:j.token};} // an old `pin` field is ignored
  die('Chưa có token: đặt MTH_TOKEN hoặc chạy "init" trong terminal của bạn.');
}
/** Raw input arrives in chunks, including whole pasted lines. Never echo the value. */
export function hiddenInputChunk(value,chunk){
  for(const ch of String(chunk)){
    if(ch==='\r'||ch==='\n')return {value,action:'submit'};
    if(ch==='\x03')return {value:'',action:'cancel'};
    if(ch==='\b'||ch==='\x7f')value=Array.from(value).slice(0,-1).join('');
    else value+=ch;
  }
  return {value,action:'continue'};
}
export async function hidden(prompt,input=process.stdin,output=process.stdout){
  if(!input.isTTY)die('Cần terminal thật để nhập ẩn (approve qua pipe phải dùng --totp-stdin).');
  const wasRaw=!!input.isRaw;
  output.write(prompt);input.setRawMode(true);input.setEncoding('utf8');
  return new Promise((resolve,reject)=>{
    let value='';
    const on=chunk=>{
      const result=hiddenInputChunk(value,chunk);value=result.value;
      if(result.action==='continue')return;
      input.off('data',on);input.pause();input.setRawMode(wasRaw);output.write('\n');
      if(result.action==='cancel'){value='';reject(Object.assign(new Error('Đã huỷ nhập mã.'),{exitCode:130}));}
      else{resolve(value);value='';}
    };
    input.on('data',on);input.resume();
  });
}
// ─── Command log (no secrets) ────────────────────────────────────────────────────────────────────────────────────────────────
const KEY=/^[A-Za-z0-9._:-]{8,100}$/;
const sha=v=>createHash('sha256').update(v).digest('hex');
/** One file per exact key: the full hash is lower-case hex, so ":" vs "_" and letter case (Windows file names) never meet in one file. */
export const entryFile=key=>join(JOURNAL,'k-'+sha(key)+'.json');
/** Name used before the second review fix (lossy: ":" became "_", Windows ignores case). Read only; never written or deleted. */
const legacyFile=key=>join(JOURNAL,key.replace(/[^A-Za-z0-9._-]/g,'_')+'.json');
const digest=(path,body)=>sha(path+'\u0000'+JSON.stringify(body));
class JournalError extends Error{}
function load(file){
  let e;try{e=JSON.parse(readFileSync(file,'utf8'));}catch{throw new JournalError('Bản ghi lệnh '+file+' bị hỏng (không đọc được). Không gửi gì; kiểm tra file này, không xoá hay ghi đè.');}
  if(!e||typeof e!=='object'||typeof e.key!=='string'||typeof e.path!=='string'||typeof e.hash!=='string'||!('body' in e)||digest(e.path,e.body)!==e.hash)
    throw new JournalError('Bản ghi lệnh '+file+' không đúng cấu trúc hoặc nội dung đã bị sửa. Không gửi gì; kiểm tra file này, không xoá hay ghi đè.');
  return e;
}
/** The stored command of exactly this key, or null. A record of another key, a broken record or a lossy old file is a stop, never a guess. */
function readEntry(key){
  const file=entryFile(key);
  if(existsSync(file)){const e=load(file);if(e.key!==key)throw new JournalError('Bản ghi '+file+' giữ key "'+e.key+'", không phải "'+key+'". Không gửi gì; kiểm tra nhật ký lệnh.');return e;}
  const old=legacyFile(key);
  if(existsSync(old)){const e=load(old);
    if(e.key===key)return e; // an old record of this very key: used as is; the next write goes to the new file, the old file stays
    throw new JournalError('Nhật ký cũ '+old+' giữ key "'+e.key+'" (cách đặt tên cũ gộp ":" / "_" và chữ hoa / thường). Lệnh của key "'+key+'" có thể đã bị ghi đè ở bản cũ: kiểm tra yêu cầu trên MoneyToHome trước. Không gửi gì, không sửa file cũ; lệnh mới hãy dùng key khác.');}
  return null;
}
function writeEntry(e){mkdirSync(JOURNAL,{recursive:true});const f=entryFile(e.key),tmp=f+'.tmp-'+process.pid;writeFileSync(tmp,JSON.stringify(e,null,1),{mode:0o600});renameSync(tmp,f);}
/** Every logged command (new files first, then old ones); an unreadable file is listed, never skipped silently. */
function allEntries(){
  if(!existsSync(JOURNAL))return [];
  const files=readdirSync(JOURNAL).filter(f=>f.endsWith('.json')).sort((a,b)=>Number(b.startsWith('k-'))-Number(a.startsWith('k-')));
  const seen=new Set(),out=[];
  for(const f of files){
    try{const e=load(join(JOURNAL,f));if(seen.has(e.key))continue;seen.add(e.key);out.push(e);}
    catch(err){out.push({key:null,file:f,state:'UNREADABLE',error:String(err.message)});}
  }
  return out;
}
const UNKNOWN_MSG=key=>'Chưa xác định kết quả. Gửi lại bằng retry '+key+'.';
const WAITING_MSG=key=>'ADMIN duyệt trên web (Phê duyệt), rồi chạy lại: retry '+key;
const refusal=(status,out)=>status>=400&&status<500&&out.data===null&&!!out.error&&typeof out.error==='object'&&typeof out.error.code==='string'&&/^[A-Z_]+$/.test(out.error.code)&&typeof out.error.message==='string';
/** 202 + { ok:false, error:{ code:'APPROVAL_REQUIRED', details:{approvalId, expiresAt} } }: the command is held, not recorded (23/10/2026). */
const isApprovalHold=(status,out)=>status===202&&!!out&&out.ok===false&&out.data===null&&out.error?.code==='APPROVAL_REQUIRED'&&typeof out.error?.details?.approvalId==='string';
/** A well-formed answer with a meaning in the contract: { ok:true, data, error:null } on 2xx, { ok:false, data:null, error:{code, message} } on 4xx, or the 202 approval hold. */
export function definiteAnswer(status,out){
  if(!out||typeof out!=='object'||Array.isArray(out)||typeof out.ok!=='boolean'||!('data' in out)||!('error' in out))return false;
  if(out.ok)return status>=200&&status<300&&out.error===null&&!!out.data&&typeof out.data==='object';
  return refusal(status,out)||isApprovalHold(status,out);
}
// The command's state (`state`) is not the result of the latest attempt (`lastAttempt`). DONE stays DONE whatever a later retry gets.
// A command that may already have been recorded (SENDING / UNKNOWN) is settled only by a success; a refusal of a retry (token revoked,
// rights removed, rate limit, …) may come before the server looks up the stored result, so it proves nothing about the first attempt.
// Only a command refused clearly with nothing possibly recorded before (first attempt, or every earlier attempt refused) is ANSWERED.
// Approvals (23/10/2026): a 202 APPROVAL_REQUIRED leaves the command un-recorded → WAITING_APPROVAL (exit 4); the ADMIN's decision settles it
// for good: APPROVAL_REJECTED → REJECTED, APPROVAL_EXPIRED → EXPIRED (both exit 1, nothing recorded; an expired one needs a NEW key). Another
// refusal of a waiting command (token / rights / rate limit) proves nothing about the pending approval: it stays WAITING_APPROVAL.
// Exit code = the command's state: 0 DONE, 1 ANSWERED / REJECTED / EXPIRED, 3 UNKNOWN, 4 WAITING_APPROVAL.
export function nextState(before,attempt){
  if(before==='DONE'||attempt==='OK')return 'DONE';
  if(attempt==='UNCLEAR')return 'UNKNOWN';
  if(attempt==='WAITING')return 'WAITING_APPROVAL';
  if(attempt==='REJECTED')return 'REJECTED';
  if(attempt==='EXPIRED')return 'EXPIRED';
  if(before==='WAITING_APPROVAL')return 'WAITING_APPROVAL';
  return before==='SENDING'||before==='UNKNOWN'?'UNKNOWN':'ANSWERED';
}
export const exitFor=state=>state==='DONE'?0:state==='WAITING_APPROVAL'?4:state==='UNKNOWN'?3:1;
// The full proxy of a VM (vms/{id}/proxy-credentials, 21/10/2026) only ever goes to a private file, also on a retry: stdout, the command
// log and the chat never see the user / password.
const PROXY_PATH=/^vms\/[A-Za-z0-9_-]{1,64}\/proxy-credentials$/;
const PROXY_DIR=process.env.MTH_PROXY_DIR||join(homedir(),'.mth','proxy');
const RUNTIME_DIR=process.env.MTH_RUNTIME_DIR||join(homedir(),'.mth','runtime');
const ACCOUNT_PATH=/^earnapp-accounts\/[A-Za-z0-9_-]{1,64}\/credentials$/;
const REVEAL_PATH=/^sdks\/[A-Za-z0-9_-]{1,64}\/reveal$/;
const CONFIRM_PATH=/^approvals\/[^/]+\/confirm$/;
const routePath=path=>opsUrl(path).pathname.slice(PREFIX.length);
/** Set a private ACL BEFORE any secret bytes are written. Fail closed on Windows ACL errors. */
function privateJson(target,value){
  mkdirSync(dirname(target),{recursive:true});
  const tmp=target+'.tmp-'+randomUUID();
  try{
    writeFileSync(tmp,'',{mode:0o600,flag:'wx'});
    if(process.platform==='win32'){
      const who=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});
      const sid=who.status===0?who.stdout.match(/S-1-\d+(?:-\d+)+/)?.[0]:null;
      if(!sid)throw new Error('Không xác định được SID để đặt ACL riêng');
      const acl=spawnSync('icacls',[tmp,'/inheritance:r','/grant:r','*'+sid+':F'],{encoding:'utf8',windowsHide:true});
      if(acl.status!==0)throw new Error('Không đặt được ACL riêng cho file bí mật');
    }else chmodSync(tmp,0o600);
    writeFileSync(tmp,JSON.stringify(value,null,1));renameSync(tmp,target);
  }finally{if(existsSync(tmp))unlinkSync(tmp);}
}
function writeProxyFile(out,vmId,file){
  const target=file||join(PROXY_DIR,vmId+'.json');
  privateJson(target,{vmId,configurationId:out.data.recorded?.configurationId,...out.data.proxy});
  // Only whitelisted metadata leaves a secret endpoint; extra nested server fields may hold secrets too.
  return {ok:true,error:null,data:{proxy:'[đã ghi vào file '+target+'; không in user / pass]'},proxyFile:target};
}
function hideSecretResult(path,out,{batch=false,key='read',index=0}={}){
  const p=routePath(path);
  if(!out?.ok)return out;
  if(PROXY_PATH.test(p)&&!batch){
    const safe=writeProxyFile(out,p.split('/')[1],proxyOut);
    // Preserve all fields in a separate private response file, including unexpected nested credentials.
    const full=join(RUNTIME_DIR,'proxy-response-'+sha(key)+'.json');privateJson(full,out.data);
    return {...safe,secretFile:full};
  }
  if(ACCOUNT_PATH.test(p)||batch&&(PROXY_PATH.test(p)||REVEAL_PATH.test(p))){
    const target=join(RUNTIME_DIR,'secret-'+sha(key+'-'+index)+'-'+p.split('/')[1]+'.json');
    privateJson(target,out.data);
    return {ok:true,error:null,data:{saved:true},secretFile:target};
  }
  return out;
}
function validateBatch(body){
  if(!body||typeof body.projectId!=='string'||!Array.isArray(body.items)||body.items.length<1||body.items.length>100)throw new Error('batch cần projectId và 1–100 items');
  const keys=new Set();
  for(const it of body.items){
    if(it?.method!=='POST'||typeof it.path!=='string'||!it.body||typeof it.body!=='object'||Array.isArray(it.body)||typeof it.idempotencyKey!=='string'||!KEY.test(it.idempotencyKey)||keys.has(it.idempotencyKey))throw new Error('Mỗi mục cần POST, path, body và idempotencyKey riêng (8–100 ký tự)');
    const p=routePath(it.path);if(p==='batch'||CONFIRM_PATH.test(p))throw new Error('Không cho batch lồng hoặc confirm trong lô; dùng approve');
    keys.add(it.idempotencyKey);
  }
}
function batchCommand(file,key){
  const body=JSON.parse(readFileSync(file,'utf8'));validateBatch(body);
  const stateFile=file+'.run.json',hash=digest('batch',body);
  if(existsSync(stateFile)){
    const state=JSON.parse(readFileSync(stateFile,'utf8'));
    if(state.hash!==hash||!KEY.test(state.key)||key&&state.key!==key)throw new Error('File batch đã đổi hoặc key khác; retry key đã lưu, lệnh mới dùng file mới');
    key=state.key;
  }else{key=key||randomUUID();if(!KEY.test(key))throw new Error('Idempotency-Key không hợp lệ');privateJson(stateFile,{key,hash});}
  return call('POST','batch',body,key);
}
/** Confirm is deliberately outside call()/the journal. Neither request nor server echoes can escape. */
async function approve(id,admin,stdin){
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(id))throw new Error('approvalId không hợp lệ');
  const entries=allEntries().filter(e=>e.approvalId===id&&e.state==='WAITING_APPROVAL');
  if(entries.length!==1)throw new Error('Cần đúng một lệnh local đang chờ approvalId này; kiểm tra approvals');
  const e=entries[0],projectId=e.body.projectId;
  let code=stdin?readFileSync(0,'utf8').trim():await hidden('Mã 2FA của ADMIN (ẩn): ');
  if(!/^\d{6}$/.test(code))throw new Error('Mã 2FA phải có 6 chữ số');
  const s=secrets();let res,out;
  try{
    res=await fetch(opsUrl('approvals/'+id+'/confirm'),{method:'POST',redirect:'manual',headers:{authorization:'Bearer '+s.token,'content-type':'application/json',accept:'application/json','idempotency-key':randomUUID()},body:JSON.stringify({projectId,admin,totp:code})});
    code='';out=await res.json();
  }catch{code='';die('Chưa xác định kết quả duyệt; kiểm tra trạng thái approval trước khi gửi mã khác.',3);}
  if(res.status!==200||out?.ok!==true||out.error!==null||out.data?.status!=='APPROVED'){
    const terminal=out?.ok===false&&out.data===null&&((res.status===403&&out.error?.code==='APPROVAL_REJECTED')||(res.status===410&&out.error?.code==='APPROVAL_EXPIRED'));
    if(terminal){
      const state=res.status===410?'EXPIRED':'REJECTED',now=new Date().toISOString();
      writeEntry({...e,state,answeredAt:now,errorCode:out.error.code,lastAttempt:{at:now,result:state,httpStatus:res.status}});
      console.log(JSON.stringify({ok:false,status:res.status,commandState:state,idempotencyKey:e.key,error:{code:out.error.code,message:'Approval kết thúc; sau khi khôi phục quyền truy cập, dùng key MỚI. Kiểm tra các mục đã DONE trước khi tạo lô mới.'}}));
      process.exitCode=1;return;
    }
    console.log(JSON.stringify({ok:false,status:res.status,error:{code:res.status>=300&&res.status<400?'REDIRECT_REFUSED':'APPROVAL_NOT_CONFIRMED',message:'Không xác nhận APPROVED; không tự gửi lại mã hoặc chạy lệnh.'}}));
    process.exitCode=res.status>=500?3:1;return;
  }
  await call('POST',e.path,e.body,e.key);
}
let proxyOut=null;
async function call(method,path,body,key){
  const url=opsUrl(path),s=secrets(),headers={authorization:'Bearer '+s.token,accept:'application/json'};
  const p=routePath(path);
  if(CONFIRM_PATH.test(p))throw new Error('Dùng approve để gửi mã trực tiếp, không qua nhật ký');
  if(method==='POST'&&p==='batch')validateBatch(body);
  let entry=null,before=null,batchBefore=[];
  const settle=(attempt,{status=null,why=null,out=null}={})=>{
    const now=new Date().toISOString(),state=nextState(before,attempt),err=out&&!out.ok?{code:out.error.code,message:String(out.error.message).slice(0,300)}:null;
    const lastAttempt={at:now,result:attempt,httpStatus:status,...(why?{reason:why}:{}),...(err?{errorCode:err.code}:{})};
    const d=out?.error?.details,approval=attempt==='WAITING'?{approvalId:d.approvalId,approvalExpiresAt:typeof d.expiresAt==='string'?d.expiresAt:null,waitingSince:entry.waitingSince||now}:{};
    const batchItems=p==='batch'?{items:entry.body.items.map((it,i)=>({index:i,path:it.path,idempotencyKey:it.idempotencyKey,state:attempt==='UNCLEAR'?nextState(batchBefore[i]?.state,'UNCLEAR'):(batchBefore[i]?.state||'ANSWERED')}))}:{};
    writeEntry({...entry,state,lastAttempt,...batchItems,...approval,...(state==='DONE'&&before!=='DONE'?{doneAt:now}:{}),...(state==='ANSWERED'||state==='REJECTED'||state==='EXPIRED'?{httpStatus:status,errorCode:err?.code??null,answeredAt:now}:{})});
    return {state,err,lastAttempt};
  };
  /** An attempt that did not settle the command: print what the command is now (never "not recorded" when it may be). */
  const unsettled=(attempt,opts)=>{
    const {state,err,lastAttempt}=settle(attempt,opts);
    if(state==='DONE'){console.log(JSON.stringify({ok:true,commandState:'DONE',idempotencyKey:key,data:null,lastAttempt,
      message:'Lệnh đã ghi xong trước đó (DONE lúc '+(entry.doneAt||'?')+'). Lần thử lại '+(err?'bị từ chối: '+err.code+' — '+err.message:'không có phản hồi rõ')+'; điều này không làm lệnh thành chưa ghi.'},null,2));process.exit(0);}
    if(state==='WAITING_APPROVAL'){console.log(JSON.stringify({ok:false,...(opts?.status?{status:opts.status}:{}),commandState:state,approvalId:entry.approvalId??null,expiresAt:entry.approvalExpiresAt??null,error:{code:'APPROVAL_PENDING',message:'Lần thử lại bị từ chối: '+err.code+' — '+err.message+'; lệnh vẫn chờ ADMIN duyệt (chưa ghi). Khôi phục quyền truy cập rồi chạy lại retry '+key+' trước hạn duyệt.'},attemptError:err,idempotencyKey:key},null,2));process.exit(4);}
    const message=attempt==='REFUSED'?'Lần thử lại bị từ chối: '+err.code+' — '+err.message+'; kết quả lệnh ban đầu vẫn chưa xác định. Khôi phục quyền truy cập rồi chạy lại retry '+key+' (không tạo key mới cho lệnh này).':UNKNOWN_MSG(key);
    console.log(JSON.stringify({ok:false,...(opts?.status?{status:opts.status}:{}),commandState:state,error:{code:'RESULT_UNKNOWN',message},...(err?{attemptError:err}:{}),idempotencyKey:key},null,2));process.exit(exitFor(state));
  };
  if(method==='POST'){
    if(!KEY.test(key))die('Idempotency-Key 8–100 ký tự A-Z a-z 0-9 . _ : -');
    const prev=readEntry(key),hash=digest(path,body);
    if(prev&&prev.hash!==hash)die('Key '+key+' đã dùng cho một lệnh khác (đường dẫn / nội dung khác). Dùng key mới cho lệnh mới; key cũ chỉ để gửi lại đúng lệnh cũ.');
    before=prev?.state??null;
    if(p==='batch')batchBefore=prev?.items||((before==='SENDING'||before==='UNKNOWN')?body.items.map(()=>({state:'UNKNOWN'})):[]);
    const now=new Date().toISOString();
    // While this attempt is in flight the command may get recorded: SENDING, except a DONE command, which stays DONE.
    entry={...(prev||{}),key,method,path,body,hash,createdAt:prev?.createdAt||now,attempts:(prev?.attempts||0)+1,state:before==='DONE'?'DONE':'SENDING',lastTryAt:now,lastAttempt:{at:now,result:'SENDING'}};
    if(p==='batch')entry.items=body.items.map((it,i)=>({index:i,path:it.path,idempotencyKey:it.idempotencyKey,state:batchBefore[i]?.state==='DONE'?'DONE':'SENDING'}));
    writeEntry(entry);
    console.error('Idempotency-Key: '+key+' (đã lưu lệnh vào '+entryFile(key)+' trước khi gửi)');
    headers['content-type']='application/json';headers['idempotency-key']=key;
  }
  let res;
  try{res=await fetch(url,{method,headers,body:method==='POST'?JSON.stringify(body):undefined,redirect:'manual'});}
  catch(e){
    if(entry)unsettled('UNCLEAR',{why:String(e?.cause?.code||e?.name||'network')});
    die('Không kết nối được: '+String(e?.cause?.code||e?.name||'network'),3);
  }
  if(res.status>=300&&res.status<400){
    if(entry){const {state}=settle('UNCLEAR',{status:res.status,why:'redirect'});die('Máy chủ trả chuyển hướng ('+res.status+'); không đi theo để không gửi token ra ngoài.'+(state==='DONE'?' Lệnh vẫn là DONE (đã ghi trước đó).':' '+UNKNOWN_MSG(key)),state==='DONE'?0:3);}
    die('Máy chủ trả chuyển hướng ('+res.status+'); không đi theo để không gửi token ra ngoài.',3);
  }
  let text;try{text=await res.text();}catch(e){if(entry)unsettled('UNCLEAR',{status:res.status,why:'body'});throw e;}
  let out=null;try{out=JSON.parse(text);}catch{/* not JSON */}
  if(entry){
    // Only a well-formed answer with a meaning in the contract counts: a gateway 5xx, HTML or a broken envelope may come after the
    // app already recorded the command.
    if(!definiteAnswer(res.status,out))unsettled('UNCLEAR',{status:res.status,why:out===null?'not-json':res.status>=500?'server':'envelope'});
    if(p==='batch'&&out.ok){
      const items=out.data.items;
      if(!Array.isArray(items)||items.length!==body.items.length||items.some((r,i)=>!r||r.index!==i||r.path!==body.items[i].path||(r.idempotencyKey!==undefined&&r.idempotencyKey!==body.items[i].idempotencyKey)||!Number.isInteger(r.status)))unsettled('UNCLEAR',{status:res.status,why:'batch-envelope'});
      const rows=items.map((r,i)=>{
        const definite=definiteAnswer(r.status,r.body),attempt=!definite?'UNCLEAR':isApprovalHold(r.status,r.body)?'WAITING':r.body.ok?'OK':r.body.error.code==='APPROVAL_REJECTED'?'REJECTED':r.body.error.code==='APPROVAL_EXPIRED'?'EXPIRED':'REFUSED';
        return {index:i,path:body.items[i].path,idempotencyKey:body.items[i].idempotencyKey,state:nextState(batchBefore[i]?.state,attempt),httpStatus:r.status,...(definite&&!r.body.ok?{errorCode:r.body.error.code}:{})};
      });
      const state=rows.some(r=>r.state==='UNKNOWN')?'UNKNOWN':rows.some(r=>r.state==='WAITING_APPROVAL')?'WAITING_APPROVAL':rows.every(r=>r.state==='DONE')?'DONE':'PARTIAL';
      const info=out.data.approval||items.find(r=>isApprovalHold(r.status,r.body))?.body.error.details;
      if(state==='WAITING_APPROVAL'&&typeof info?.approvalId!=='string')unsettled('UNCLEAR',{status:res.status,why:'missing-batch-approval'});
      let safeItems;
      try{safeItems=items.map((r,i)=>{
        const safe=definiteAnswer(r.status,r.body)?hideSecretResult(body.items[i].path,r.body,{batch:true,key,index:i}):{ok:false,data:null,error:{code:'RESULT_UNKNOWN',message:'Kết quả mục chưa xác định; retry cùng key lô.'}};
        return {index:i,path:body.items[i].path,idempotencyKey:body.items[i].idempotencyKey,status:r.status,body:safe,...(safe?.secretFile?{secretFile:safe.secretFile}:{}),commandState:rows[i].state};
      });}catch{unsettled('UNCLEAR',{status:res.status,why:'secret-file'});}
      const now=new Date().toISOString();
      writeEntry({...entry,state,items:rows,lastAttempt:{at:now,result:state,httpStatus:res.status},...(state==='DONE'?{doneAt:entry.doneAt||now}:{}),...(state==='WAITING_APPROVAL'?{approvalId:info.approvalId,approvalExpiresAt:info.expiresAt??null,waitingSince:entry.waitingSince||now}:{})});
      // Do not copy arbitrary outer data: credentials belong only to their private item response files.
      console.log(JSON.stringify({ok:true,status:res.status,idempotencyKey:key,commandState:state,...(state==='WAITING_APPROVAL'?{approvalId:info.approvalId}:{}),data:{items:safeItems,summary:{ok:rows.filter(r=>r.state==='DONE').length,waiting:rows.filter(r=>r.state==='WAITING_APPROVAL').length,refused:rows.filter(r=>['ANSWERED','REJECTED','EXPIRED'].includes(r.state)).length}},...(rows.some(r=>r.state==='EXPIRED'||r.state==='REJECTED')?{message:'Approval kết thúc; kiểm tra kết quả từng mục và dùng key MỚI cho lệnh mới (không tạo lại mục đã DONE).'}:{})},null,2));
      process.exitCode=exitFor(state);return;
    }
    // Approval answers (23/10/2026): held (not recorded), rejected or expired — each settles the command on its own, whatever came before.
    if(isApprovalHold(res.status,out)){
      const {state}=settle('WAITING',{status:res.status,out}),d=out.error.details;
      if(state==='DONE')unsettled('WAITING',{status:res.status,out});
      console.log(JSON.stringify({ok:false,status:res.status,requestId:res.headers.get('x-request-id'),idempotencyKey:key,commandState:state,approvalId:d.approvalId,expiresAt:d.expiresAt??null,
        error:{code:out.error.code,message:out.error.message},message:'Lệnh chưa ghi: đang chờ duyệt. '+WAITING_MSG(key)+' (trước '+(d.expiresAt??'hạn duyệt')+').'},null,2));
      process.exitCode=exitFor(state);return;}
    if(!out.ok&&(out.error.code==='APPROVAL_REJECTED'||out.error.code==='APPROVAL_EXPIRED')){
      const {state}=settle(out.error.code==='APPROVAL_REJECTED'?'REJECTED':'EXPIRED',{status:res.status,out});
      const message=state==='REJECTED'?'ADMIN đã từ chối; lệnh không được ghi và key này kết thúc. Cần làm lại thì thống nhất với ADMIN rồi gửi lệnh mới với key mới.':state==='EXPIRED'?'Yêu cầu duyệt đã hết hạn (chưa ghi). Gửi lại lệnh với key MỚI để xin duyệt lại.':'Lệnh đã DONE trước đó; câu trả lời này chỉ ghi vào lastAttempt.';
      console.log(JSON.stringify({ok:false,status:res.status,requestId:res.headers.get('x-request-id'),idempotencyKey:key,commandState:state,approvalId:out.error.details?.approvalId??null,error:{code:out.error.code,message:out.error.message},message},null,2));
      process.exitCode=exitFor(state);return;}
    if(!out.ok&&nextState(before,'REFUSED')!=='ANSWERED')unsettled('REFUSED',{status:res.status,out});
    try{out=hideSecretResult(path,out,{key});}catch{unsettled('UNCLEAR',{status:res.status,why:'secret-file'});}
    const {state}=settle(out.ok?'OK':'REFUSED',{status:res.status,out});
    // sdks/{id}/reveal: the full code is in `out.data.code` and goes to stdout once; the command log holds key / path / body / state only.
    console.log(JSON.stringify({status:res.status,requestId:res.headers.get('x-request-id'),idempotencyKey:key,commandState:state,...out},null,2));
    process.exitCode=exitFor(state);return;
  }
  if(out===null)out={ok:false,error:{code:'HTTP_'+res.status,message:text.slice(0,200)}};
  out=hideSecretResult(path,out);
  console.log(JSON.stringify({status:res.status,requestId:res.headers.get('x-request-id'),...out},null,2));
  if(!out.ok)process.exitCode=1;
}
// ─── SDK survey (owner briefs 22/10/2026; independent review fix: capture-time identity) ─────────────────────────────────────
// Step 1, BEFORE the machines are read: `sdk-prepare` reads the web and writes one capture per VM — projectId, vmId, serverCode,
// vmCode, capturedAt, expectedCycle (round), expectedVmRevision and knownSdks {code: revision} (the codes the web holds for that VM,
// plus --code extras). Step 2: the machine survey adds observedAt, source, evidence? and sdks:[{code, amountUsd?, amountRead?,
// current?}] to the SAME entry. Step 3: sdk-check / sdk-observe / sdk-survey send exactly that identity: each code's
// expectedSdkRevision comes from knownSdks (null = the web had no such code at capture), never from a read at send time. An entry
// without its capture, or read before its capture, is refused ("đối chiếu / khảo sát lại"); a round or revision that moved after the
// capture is refused by the web (CYCLE_CHANGED / REVISION_CONFLICT) — the client never rebinds an old survey to the VM as it is now,
// not on the first send, not on a retry (same key, same body) and not on --redo (same captured entry, new key).
const SDK_CODE=/^[A-Za-z0-9._:-]{8,128}$/,SDK_USD=/^\d{1,10}(\.\d{1,6})?$/;
const isoMs=v=>typeof v==='string'&&!Number.isNaN(Date.parse(v))?Date.parse(v):null;
const RECHECK='đối chiếu / khảo sát lại (chụp web bằng sdk-prepare rồi đọc máy)';
export function checkSdkSurvey(list){
  const problems=[],where=new Map(),out=[];
  for(const [i,vm] of (Array.isArray(list)?list:[list]).entries()){
    const at=vm?.vmId||'#'+(i+1),byCode=new Map(),bad=(issue,code)=>problems.push({vm:at,...(code!==undefined?{code}:{}),issue});
    if(!vm?.vmId)bad('thiếu vmId');
    if(!vm?.projectId)bad('thiếu projectId');
    const captured=isoMs(vm?.capturedAt),observed=isoMs(vm?.observedAt);
    if(captured===null)bad('thiếu capturedAt (chưa chụp web trước khi khảo sát máy); '+RECHECK);
    if(!(Number.isInteger(vm?.expectedCycle)&&vm.expectedCycle>=1))bad('thiếu expectedCycle (lượt VM lúc chụp); '+RECHECK);
    if(!(Number.isInteger(vm?.expectedVmRevision)&&vm.expectedVmRevision>=0))bad('thiếu expectedVmRevision (revision VM lúc chụp); '+RECHECK);
    const known=vm?.knownSdks&&typeof vm.knownSdks==='object'&&!Array.isArray(vm.knownSdks)?vm.knownSdks:null;
    if(!known)bad('thiếu knownSdks (mã + revision web giữ lúc chụp); '+RECHECK);
    if(observed===null)bad('thiếu observedAt (giờ đọc máy)');
    if(captured!==null&&observed!==null&&observed<captured)bad('observedAt trước capturedAt: máy phải được đọc SAU khi chụp web; chụp lại rồi khảo sát lại');
    if(typeof vm?.source!=='string'||vm.source.trim().length<2)bad('thiếu source (nơi đọc)');
    if(!Array.isArray(vm?.sdks)||!vm.sdks.length){bad('thiếu danh sách sdks');continue;}
    for(const s of vm.sdks){
      const code=String(s?.code??'').trim();
      if(!SDK_CODE.test(code)){bad('mã SDK không hợp lệ',code);continue;}
      if(s.amountUsd!=null&&!SDK_USD.test(String(s.amountUsd)))bad('tiền USD không đúng dạng "12.345"',code);
      if(s.amountRead===false&&s.amountUsd!=null)bad('amountRead=false nhưng có amountUsd',code);
      if(s.amountRead===true&&s.amountUsd==null)bad('amountRead=true cần amountUsd',code);
      const fromCapture=known&&code in known?known[code]:null;
      if(fromCapture!==null&&!(Number.isInteger(fromCapture)&&fromCapture>=0))bad('knownSdks: revision là số nguyên ≥ 0',code);
      if(s.expectedSdkRevision!==undefined&&s.expectedSdkRevision!==fromCapture)bad('expectedSdkRevision khác bản chụp (knownSdks); không tự sửa revision — chụp lại rồi khảo sát lại',code);
      const prev=byCode.get(code);
      if(prev){if(prev.amountUsd!=null&&s.amountUsd!=null&&Number(prev.amountUsd)!==Number(s.amountUsd))bad('cùng mã hai số tiền khác nhau trên một máy',code);
        prev.amountUsd=prev.amountUsd??(s.amountUsd!=null?String(s.amountUsd):undefined);prev.amountRead=prev.amountRead??(s.amountRead!=null?!!s.amountRead:undefined);if(s.current)prev.current=true;continue;}
      byCode.set(code,{code,expectedSdkRevision:fromCapture,...(s.amountUsd!=null?{amountUsd:String(s.amountUsd)}:{}),...(s.amountRead!=null?{amountRead:!!s.amountRead}:{}),...(s.current?{current:true}:{})});
      where.set(code,[...(where.get(code)||[]),at]);
    }
    const sdks=[...byCode.values()].map(x=>Object.fromEntries(Object.entries(x).filter(([,v])=>v!==undefined)));if(sdks.filter(x=>x.current).length>1)bad('nhiều hơn một mã current');
    out.push({...vm,sdks});
  }
  for(const [code,vms] of where)if(new Set(vms).size>1)problems.push({code,vms:[...new Set(vms)],issue:'cùng mã SDK ở nhiều VM'});
  return {problems,vms:out,codes:where.size};
}
/** The request of one captured + surveyed entry. Pure: nothing is read from the web here; a missing identity is a refusal. */
export async function surveyBody(vm){
  const r=checkSdkSurvey(vm);
  if(r.problems.length)throw new Error('Khảo sát thiếu định danh lúc chụp hoặc có lỗi; không gửi: '+r.problems.map(p=>(p.code?p.code+': ':'')+p.issue).join('; '));
  const v=r.vms[0];
  return {path:'vms/'+encodeURIComponent(v.vmId)+'/sdk-observations',body:{projectId:v.projectId,expectedCycle:v.expectedCycle,expectedVmRevision:v.expectedVmRevision,observedAt:v.observedAt,source:v.source,...(v.evidence?{evidence:v.evidence}:{}),sdks:v.sdks}};
}
// ─── SDK survey runner ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Reads (GET) go straight to the API; every write goes through this same script as a child `post` / `retry`, so the command log,
// key-before-send, UNKNOWN on a lost answer and retry rules are exactly those of a single command.
async function getJson(path){
  const s=secrets(),res=await fetch(opsUrl(path),{headers:{authorization:'Bearer '+s.token,accept:'application/json'},redirect:'manual'});
  let out=null;try{out=JSON.parse(await res.text());}catch{/* not JSON */}
  if(!out||!out.ok)throw new Error('Đọc '+path.split('?')[0]+' thất bại: '+(out?.error?.code||'HTTP_'+res.status)+(out?.error?.message?' — '+out.error.message:''));
  return out.data;
}
/** sdk-prepare: the web identity of each VM, taken BEFORE the machine is read; the survey fills observedAt / source / sdks into it. */
export async function prepareSurvey(projectId,targets,extraCodes,read=getJson){
  const out=[];
  for(const t of targets){
    let vmId=t;
    if(t.includes('/')){const [server,vm]=t.split('/');vmId=(await read('vms/resolve?'+new URLSearchParams({projectId,server,vm}))).id;}
    const d=await read('vms/'+encodeURIComponent(vmId)+'?'+new URLSearchParams({projectId})),known={};
    for(const it of d.sdk?.items||[])known[it.code]=it.revision;
    if(extraCodes.length){const q=new URLSearchParams({projectId});for(const c of extraCodes)q.append('code',c);for(const it of (await read('sdks?'+q)).items)if(it.found&&!(it.code in known))known[it.code]=it.revision;}
    out.push({projectId,vmId:d.id,serverCode:d.serverCode,vmCode:d.code,capturedAt:new Date().toISOString(),expectedCycle:d.expectedCycle,expectedVmRevision:d.revision,knownSdks:known,currentSdkOnWeb:d.currentSdk??null,
      observedAt:null,source:null,evidence:null,sdks:[]});
  }
  return out;
}
const entryHash=vm=>sha(JSON.stringify(vm));
function child(args){
  const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),...args],{env:process.env,encoding:'utf8'});
  let out=null;try{out=JSON.parse(r.stdout);}catch{/* not JSON */}
  return {code:r.status,out,err:(r.stderr||'').trim()};
}
const STATE_OF={0:'DONE',1:'ANSWERED',3:'UNKNOWN'};
async function runSurvey(file,stateFile,redo){
  const r=checkSdkSurvey(JSON.parse(readFileSync(file,'utf8')));
  if(r.problems.length){console.log(JSON.stringify({ok:false,sent:0,problems:r.problems},null,2));die('Dừng trước khi gửi: sửa các dòng trên (không gửi VM nào)',1);}
  const runFile=stateFile||file+'.run.json',run=existsSync(runFile)?JSON.parse(readFileSync(runFile,'utf8')):{survey:file,rows:{}};
  const save=()=>{const tmp=runFile+'.tmp-'+process.pid;writeFileSync(tmp,JSON.stringify(run,null,1),{mode:0o600});renameSync(tmp,runFile);};
  const bodyDir=runFile+'.bodies';mkdirSync(bodyDir,{recursive:true});
  const lines=[];
  for(const [i,vm] of r.vms.entries()){
    const line=i+1,h=entryHash(vm);let row=run.rows[vm.vmId];
    // --redo only drops a command that was clearly refused (nothing recorded); DONE / unknown commands are never replaced. The entry is
    // sent again exactly as captured + surveyed (a stale round / revision is refused again until a new capture + survey).
    if(row&&redo.includes(vm.vmId)&&row.state==='ANSWERED'){delete run.rows[vm.vmId];row=undefined;save();}
    const changed=!!row&&row.entryHash!==h,note=changed?{note:'Dòng khảo sát đã đổi so với lệnh đã lưu; lệnh đã lưu được giữ nguyên (không gửi nội dung mới). Khảo sát lại thì dùng file khảo sát mới.'}:{};
    if(row?.state==='DONE'){lines.push({line,vmId:vm.vmId,state:'DONE',key:row.key,message:'Đã ghi (lần trước); không gửi lại',...note});continue;}
    if(row?.state==='ANSWERED'){lines.push({line,vmId:vm.vmId,state:'ANSWERED',key:row.key,errorCode:row.errorCode,message:(row.message||'Bị từ chối')+' — kiểm tra rồi chạy lại với --redo '+vm.vmId,...note});continue;}
    if(!row){
      const plan=await surveyBody(vm);
      row={key:'svy-'+randomUUID(),entryHash:h,path:plan.path,body:plan.body,state:'PLANNED',createdAt:new Date().toISOString()};run.rows[vm.vmId]=row;save();
    }
    // PLANNED (never reached the log) → post with the planned key and body; SENDING / UNKNOWN → retry the same key.
    let res;
    if(readEntry(row.key))res=child(['retry',row.key]);
    else{const bf=join(bodyDir,row.key+'.json');writeFileSync(bf,JSON.stringify(row.body),{mode:0o600});res=child(['post',row.path,bf,'--key',row.key]);}
    const state=STATE_OF[res.code]??'UNKNOWN',err=res.out?.error||null;
    // A stale round / revision is never "fixed" by the client: the person captures the web again and reads the machine again.
    const stale=state==='ANSWERED'&&['CYCLE_CHANGED','REVISION_CONFLICT'].includes(err?.code)?' (lượt / revision đã đổi sau lúc chụp: chụp lại bằng sdk-prepare và khảo sát lại máy; không tự cập nhật)':'';
    Object.assign(row,{state,lastAt:new Date().toISOString(),errorCode:state==='ANSWERED'?err?.code??null:null,message:state==='ANSWERED'?String(err?.message||'').slice(0,300)+stale:null});save();
    const sdks=res.out?.data?.recorded?.sdks?.map(x=>({code:x.code,placed:x.placed,linkState:x.linkState,current:x.current,amount:x.amount}))??null;
    lines.push({line,vmId:vm.vmId,state,key:row.key,...(res.out?.data?{replay:res.out.data.replay}:{}),...(sdks?{sdks}:{}),...(state==='ANSWERED'?{errorCode:row.errorCode,message:row.message,details:err?.details??null}:{}),
      ...(state==='UNKNOWN'?{message:'Chưa xác định kết quả; chạy lại sdk-survey (gửi lại đúng key '+row.key+')'}:{}),...note});
  }
  const count=k=>lines.filter(l=>l.state===k).length;
  console.log(JSON.stringify({runFile,total:lines.length,done:count('DONE'),refused:count('ANSWERED'),unknown:count('UNKNOWN'),lines},null,2));
  process.exitCode=count('UNKNOWN')?3:count('ANSWERED')?1:0;
}
const isMain=!!process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url;
if(isMain){
  const [cmd,...args]=process.argv.slice(2);
  const flag=n=>{const i=args.indexOf(n);return i>=0?args.splice(i,2)[1]:null;};
  try{
    if(cmd==='init'){
      const token=(await hidden('Token (không hiện khi gõ): ')).trim();
      if(!/^mth_[A-Za-z0-9_-]{20,100}$/.test(token))die('Token không đúng dạng mth_…');
      mkdirSync(dirname(FILE),{recursive:true});writeFileSync(FILE,JSON.stringify({token}),{mode:0o600});try{chmodSync(FILE,0o600);}catch{/* Windows keeps the user's ACL */}
      console.log('Đã lưu vào '+FILE+' (không in nội dung).');
    }else if(cmd==='me'||cmd==='projects')await call('GET',cmd);
    else if(cmd==='resolve'&&args.length===3)await call('GET','vms/resolve?'+new URLSearchParams({projectId:args[0],server:args[1],vm:args[2]}));
    else if(cmd==='vm'&&args.length===2)await call('GET','vms/'+encodeURIComponent(args[1])+'?'+new URLSearchParams({projectId:args[0]}));
    else if(cmd==='get'&&args.length===1)await call('GET',args[0]);
    else if(cmd==='post'){const key=flag('--key')||randomUUID();if(args.length!==2)die('post <path> <body.json> [--key K]');await call('POST',args[0],JSON.parse(readFileSync(args[1],'utf8')),key);}
    else if(cmd==='batch'){const key=flag('--key');if(args.length!==1)die('batch <file.json> [--key K]');await batchCommand(args[0],key);}
    else if(cmd==='approve'){const admin=flag('--admin'),at=args.indexOf('--totp-stdin'),stdin=at>=0;if(stdin)args.splice(at,1);if(args.length!==1||!admin)die('approve <approvalId> --admin <username> [--totp-stdin]');await approve(args[0],admin,stdin);}
    else if(cmd==='proxy'){const out=flag('--out'),pkey=flag('--key')||randomUUID();if(args.length!==4||!/^\d+$/.test(args[3]))die('proxy <projectId> <vmId> <jobId> <cycle> [--out <file>]');proxyOut=out;
      await call('POST','vms/'+encodeURIComponent(args[1])+'/proxy-credentials',{projectId:args[0],jobId:args[2],expectedCycle:Number(args[3])},pkey);}
    else if(cmd==='sdk-check'&&args.length===1){const r=checkSdkSurvey(JSON.parse(readFileSync(args[0],'utf8')));console.log(JSON.stringify({ok:!r.problems.length,vms:r.vms.length,codes:r.codes,problems:r.problems},null,2));if(r.problems.length)process.exitCode=1;}
    else if(cmd==='sdk-prepare'){const out=flag('--out'),codes=[];for(let x=flag('--code');x;x=flag('--code'))codes.push(x);if(args.length<2)die('sdk-prepare <projectId> <vmId|server/vm>... [--code C] [--out <capture.json>]');
      const list=await prepareSurvey(args[0],args.slice(1),codes),text=JSON.stringify(list,null,1);if(out){writeFileSync(out,text);console.log('Đã chụp '+list.length+' VM vào '+out+'; đọc máy SAU lúc này rồi điền observedAt / source / sdks vào từng VM.');}else console.log(text);}
    else if(cmd==='sdk-observe'){const key=flag('--key')||randomUUID();if(args.length!==1)die('sdk-observe <one-vm.json> [--key K]');
      const raw=JSON.parse(readFileSync(args[0],'utf8'));if(Array.isArray(raw))die('sdk-observe gửi MỘT VM; dùng sdk-survey cho cả bảng');
      const r=checkSdkSurvey(raw);if(r.problems.length){console.log(JSON.stringify({ok:false,problems:r.problems},null,2));die('Dừng trước khi gửi: sửa các dòng trên',1);}
      const plan=await surveyBody(raw);await call('POST',plan.path,plan.body,key);}
    else if(cmd==='sdk-survey'){const state=flag('--state'),redo=[];for(let x=flag('--redo');x;x=flag('--redo'))redo.push(x);if(args.length!==1)die('sdk-survey <survey.json> [--state <file>] [--redo <vmId>]');await runSurvey(args[0],state,redo);}
    else if(cmd==='retry'&&args.length===1){const key=args[0],e=readEntry(key);if(!e)die('Không có lệnh với key '+key+' trong '+JOURNAL);await call('POST',e.path,e.body,key);}
    else if(cmd==='sdk-reveal'){const key=flag('--key')||randomUUID();if(args.length!==2)die('sdk-reveal <projectId> <sdkId> [--key K]');
      await call('POST','sdks/'+encodeURIComponent(args[1])+'/reveal',{projectId:args[0]},key);}
    else if(cmd==='approvals'){const list=allEntries().filter(e=>e.state==='WAITING_APPROVAL');
      console.log(JSON.stringify(list.map(e=>({key:e.key,path:e.path,state:e.state,approvalId:e.approvalId??null,expiresAt:e.approvalExpiresAt??null,expired:!!e.approvalExpiresAt&&Date.parse(e.approvalExpiresAt)<Date.now(),waitingSince:e.waitingSince??null,attempts:e.attempts,next:WAITING_MSG(e.key)})),null,2));}
    else if(cmd==='pending'){const list=allEntries().filter(e=>e.state==='SENDING'||e.state==='UNKNOWN'||e.state==='UNREADABLE');
      console.log(JSON.stringify(list.map(e=>e.state==='UNREADABLE'?{key:null,file:e.file,state:e.state,error:e.error}:{key:e.key,path:e.path,state:e.state,attempts:e.attempts,lastTryAt:e.lastTryAt,...(e.httpStatus?{httpStatus:e.httpStatus}:{})}),null,2));}
    else die('Lệnh: init | me | projects | resolve <projectId> <server> <vm> | vm <projectId> <vmId> | get <path> | post <path> <body.json> [--key K] | batch <file.json> [--key K] | approve <approvalId> --admin <username> [--totp-stdin] | retry <key> | pending | approvals | sdk-reveal <projectId> <sdkId> [--key K] | proxy <projectId> <vmId> <jobId> <cycle> [--out F] | sdk-prepare <projectId> <vm>... [--code C] [--out F] | sdk-check <survey.json> | sdk-observe <one-vm.json> [--key K] | sdk-survey <survey.json> [--state F] [--redo vmId]\n'
      +'Mã thoát: 0 DONE · 1 ANSWERED / REJECTED / EXPIRED · 2 lỗi dùng lệnh · 3 UNKNOWN (retry <key>) · 4 WAITING_APPROVAL (ADMIN duyệt trên web rồi retry <key>). Không còn PIN (23/10/2026); lệnh quan trọng chờ ADMIN duyệt.');
  }catch(e){die(String(e.message||e),e.exitCode===130?130:2);}
}
