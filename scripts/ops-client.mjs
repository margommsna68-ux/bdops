#!/usr/bin/env node
// MoneyToHome ops API client (21/10/2026). Reads the token and PIN from the environment (MTH_TOKEN / MTH_PIN) or from a local secret
// file (default ~/.mth/ops-secret.json, or MTH_SECRET_FILE). It never prints the token, the PIN, request headers or the environment.
//
//   node scripts/ops-client.mjs init                     # in YOUR own terminal (not through a chat): asks token + PIN without echo
//   node scripts/ops-client.mjs me | projects
//   node scripts/ops-client.mjs resolve <projectId> <serverCode> <vmCode>
//   node scripts/ops-client.mjs vm <projectId> <vmId>
//   node scripts/ops-client.mjs get '<path?query>'       # any GET under /api/ops/v1/, e.g. 'withdrawals?projectId=…&status=PREPARING'
//   node scripts/ops-client.mjs post <path> <body.json> [--key <Idempotency-Key>]
//   node scripts/ops-client.mjs retry <Idempotency-Key>  # send the SAME command again (same path, body and key) after a lost answer
//   node scripts/ops-client.mjs pending                  # commands whose result is not known yet
//
// Writes (review fix 21/10/2026): the key and the body are written to a local command log (~/.mth/ops-journal, or MTH_JOURNAL_DIR;
// never the token or PIN) and the key is printed BEFORE the request is sent. If the answer is lost the result is "Chưa xác định kết
// quả": the command may have been recorded; run `retry <key>` (never a new key). A key is never reused for a different body.
// Secrets go only to MTH_BASE's own origin under /api/ops/v1/ (no "..", no encoded traversal, no redirects); https only, except a
// local test server on localhost.
// Second review fix 21/10/2026: a write is settled (DONE / ANSWERED) only by a well-formed {ok, data, error} answer with a meaning in the
// contract (2xx + ok:true, or 4xx + ok:false with an error code). 5xx (a gateway 502 / 503 / 504 may come after the app recorded it),
// HTML, a broken envelope or an unreadable body stay UNKNOWN in pending. Each command is stored under sha256(exact key), so keys that
// differ only by ":" / "_" or letter case never share a file; a record is used only when its key matches exactly.
import {readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync,readdirSync,renameSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
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
  if(process.env.MTH_TOKEN)return {token:process.env.MTH_TOKEN,pin:process.env.MTH_PIN||null};
  if(existsSync(FILE)){const j=JSON.parse(readFileSync(FILE,'utf8'));return {token:j.token,pin:j.pin||null};}
  die('Chưa có token: đặt MTH_TOKEN / MTH_PIN hoặc chạy "init" trong terminal của bạn.');
}
async function hidden(prompt){
  if(!process.stdin.isTTY)die('init cần một terminal thật (không chạy qua chat hay pipe).');
  process.stdout.write(prompt);process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
  return new Promise(resolve=>{let v='';const on=ch=>{if(ch==='\r'||ch==='\n'){process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',on);process.stdout.write('\n');resolve(v);}else if(ch==='\u0003')process.exit(130);else if(ch==='\u007f')v=v.slice(0,-1);else v+=ch;};process.stdin.on('data',on);});
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
/** A well-formed answer with a meaning in the contract: { ok:true, data, error:null } on 2xx, { ok:false, data:null, error:{code, message} } on 4xx. */
export function definiteAnswer(status,out){
  if(!out||typeof out!=='object'||Array.isArray(out)||typeof out.ok!=='boolean'||!('data' in out)||!('error' in out))return false;
  if(out.ok)return status>=200&&status<300&&out.error===null&&!!out.data&&typeof out.data==='object';
  return status>=400&&status<500&&out.data===null&&!!out.error&&typeof out.error==='object'&&typeof out.error.code==='string'&&/^[A-Z_]+$/.test(out.error.code)&&typeof out.error.message==='string';
}
async function call(method,path,body,key){
  const url=opsUrl(path),s=secrets(),headers={authorization:'Bearer '+s.token,accept:'application/json'};
  let entry=null;
  const unknown=(why,status)=>{writeEntry({...entry,state:'UNKNOWN',error:why,httpStatus:status??null,answeredAt:new Date().toISOString()});
    console.log(JSON.stringify({ok:false,...(status?{status}:{}),error:{code:'RESULT_UNKNOWN',message:UNKNOWN_MSG(key)},idempotencyKey:key},null,2));process.exit(3);};
  if(method==='POST'){
    if(!s.pin)die('Lệnh ghi cần MTH_PIN (hoặc pin trong file bí mật).');
    if(!KEY.test(key))die('Idempotency-Key 8–100 ký tự A-Z a-z 0-9 . _ : -');
    const prev=readEntry(key),hash=digest(path,body);
    if(prev&&prev.hash!==hash)die('Key '+key+' đã dùng cho một lệnh khác (đường dẫn / nội dung khác). Dùng key mới cho lệnh mới; key cũ chỉ để gửi lại đúng lệnh cũ.');
    entry={key,method,path,body,hash,createdAt:prev?.createdAt||new Date().toISOString(),attempts:(prev?.attempts||0)+1,state:'SENDING',lastTryAt:new Date().toISOString()};
    writeEntry(entry);
    console.error('Idempotency-Key: '+key+' (đã lưu lệnh vào '+entryFile(key)+' trước khi gửi)');
    headers['content-type']='application/json';headers['x-ops-pin']=s.pin;headers['idempotency-key']=key;
  }
  let res;
  try{res=await fetch(url,{method,headers,body:method==='POST'?JSON.stringify(body):undefined,redirect:'manual'});}
  catch(e){
    if(entry)unknown(String(e?.cause?.code||e?.name||'network'));
    die('Không kết nối được: '+String(e?.cause?.code||e?.name||'network'),3);
  }
  if(res.status>=300&&res.status<400){if(entry)writeEntry({...entry,state:'UNKNOWN',error:'redirect',httpStatus:res.status});die('Máy chủ trả chuyển hướng ('+res.status+'); không đi theo để không gửi token / PIN ra ngoài.'+(entry?' '+UNKNOWN_MSG(key):''),3);}
  let text;try{text=await res.text();}catch(e){if(entry)unknown('body',res.status);throw e;}
  let out=null;try{out=JSON.parse(text);}catch{/* not JSON */}
  if(entry){
    // Only a well-formed answer with a meaning in the contract settles a write: a gateway 5xx, HTML or a broken envelope may come
    // after the app already recorded the command.
    if(!definiteAnswer(res.status,out))unknown(out===null?'not-json':res.status>=500?'server':'envelope',res.status);
    writeEntry({...entry,state:out.ok?'DONE':'ANSWERED',httpStatus:res.status,errorCode:out.error?.code??null,answeredAt:new Date().toISOString()});
  }
  if(out===null)out={ok:false,error:{code:'HTTP_'+res.status,message:text.slice(0,200)}};
  console.log(JSON.stringify({status:res.status,requestId:res.headers.get('x-request-id'),...(key?{idempotencyKey:key}:{}),...out},null,2));
  if(!out.ok)process.exitCode=1;
}
const isMain=!!process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url;
if(isMain){
  const [cmd,...args]=process.argv.slice(2);
  const flag=n=>{const i=args.indexOf(n);return i>=0?args.splice(i,2)[1]:null;};
  try{
    if(cmd==='init'){
      const token=(await hidden('Token (không hiện khi gõ): ')).trim(),pin=(await hidden('PIN (không hiện khi gõ): ')).trim();
      if(!/^mth_[A-Za-z0-9_-]{20,100}$/.test(token))die('Token không đúng dạng mth_…');
      mkdirSync(dirname(FILE),{recursive:true});writeFileSync(FILE,JSON.stringify({token,pin}),{mode:0o600});try{chmodSync(FILE,0o600);}catch{/* Windows keeps the user's ACL */}
      console.log('Đã lưu vào '+FILE+' (không in nội dung).');
    }else if(cmd==='me'||cmd==='projects')await call('GET',cmd);
    else if(cmd==='resolve'&&args.length===3)await call('GET','vms/resolve?'+new URLSearchParams({projectId:args[0],server:args[1],vm:args[2]}));
    else if(cmd==='vm'&&args.length===2)await call('GET','vms/'+encodeURIComponent(args[1])+'?'+new URLSearchParams({projectId:args[0]}));
    else if(cmd==='get'&&args.length===1)await call('GET',args[0]);
    else if(cmd==='post'){const key=flag('--key')||randomUUID();if(args.length!==2)die('post <path> <body.json> [--key K]');await call('POST',args[0],JSON.parse(readFileSync(args[1],'utf8')),key);}
    else if(cmd==='retry'&&args.length===1){const key=args[0],e=readEntry(key);if(!e)die('Không có lệnh với key '+key+' trong '+JOURNAL);await call('POST',e.path,e.body,key);}
    else if(cmd==='pending'){const list=allEntries().filter(e=>e.state==='SENDING'||e.state==='UNKNOWN'||e.state==='UNREADABLE');
      console.log(JSON.stringify(list.map(e=>e.state==='UNREADABLE'?{key:null,file:e.file,state:e.state,error:e.error}:{key:e.key,path:e.path,state:e.state,attempts:e.attempts,lastTryAt:e.lastTryAt,...(e.httpStatus?{httpStatus:e.httpStatus}:{})}),null,2));}
    else die('Lệnh: init | me | projects | resolve <projectId> <server> <vm> | vm <projectId> <vmId> | get <path> | post <path> <body.json> [--key K] | retry <key> | pending');
  }catch(e){die(String(e.message||e));}
}
