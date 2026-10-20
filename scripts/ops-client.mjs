#!/usr/bin/env node
// MoneyToHome ops API client (21/10/2026). Reads the token and PIN from the environment (MTH_TOKEN / MTH_PIN) or from a local secret
// file (default ~/.mth/ops-secret.json, or MTH_SECRET_FILE). It never prints the token, the PIN, request headers or the environment.
//
//   node scripts/ops-client.mjs init                     # in YOUR own terminal (not through a chat): asks token + PIN without echo
//   node scripts/ops-client.mjs me
//   node scripts/ops-client.mjs projects
//   node scripts/ops-client.mjs resolve <projectId> <serverCode> <vmCode>
//   node scripts/ops-client.mjs vm <projectId> <vmId>
//   node scripts/ops-client.mjs get '<path?query>'       # any GET, e.g. 'withdrawals?projectId=…&status=PREPARING'
//   node scripts/ops-client.mjs post <path> <body.json> [--key <Idempotency-Key>]
//
// A write without --key gets a new random key, printed so the SAME command can be retried safely with --key after a lost answer.
// Base URL: MTH_BASE (default https://moneytohome.up.railway.app).
import {readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
const BASE=(process.env.MTH_BASE||'https://moneytohome.up.railway.app').replace(/\/$/,'')+'/api/ops/v1/';
const FILE=process.env.MTH_SECRET_FILE||join(homedir(),'.mth','ops-secret.json');
function secrets(){
  if(process.env.MTH_TOKEN)return {token:process.env.MTH_TOKEN,pin:process.env.MTH_PIN||null};
  if(existsSync(FILE)){const j=JSON.parse(readFileSync(FILE,'utf8'));return {token:j.token,pin:j.pin||null};}
  console.error('Chưa có token: đặt MTH_TOKEN / MTH_PIN hoặc chạy "init" trong terminal của bạn.');process.exit(2);
}
async function hidden(prompt){
  if(!process.stdin.isTTY){console.error('init cần một terminal thật (không chạy qua chat hay pipe).');process.exit(2);}
  process.stdout.write(prompt);process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
  return new Promise(resolve=>{let v='';const on=ch=>{if(ch==='\r'||ch==='\n'){process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',on);process.stdout.write('\n');resolve(v);}else if(ch==='\u0003')process.exit(130);else if(ch==='\u007f')v=v.slice(0,-1);else v+=ch;};process.stdin.on('data',on);});
}
async function call(method,path,body,key){
  const s=secrets(),headers={authorization:'Bearer '+s.token,accept:'application/json'};
  if(method==='POST'){if(!s.pin){console.error('Lệnh ghi cần MTH_PIN (hoặc pin trong file bí mật).');process.exit(2);}headers['content-type']='application/json';headers['x-ops-pin']=s.pin;headers['idempotency-key']=key;}
  const res=await fetch(BASE+path.replace(/^\//,''),{method,headers,body:method==='POST'?JSON.stringify(body):undefined});
  const text=await res.text();let out;try{out=JSON.parse(text);}catch{out={ok:false,error:{code:'HTTP_'+res.status,message:text.slice(0,200)}};}
  console.log(JSON.stringify({status:res.status,requestId:res.headers.get('x-request-id'),...(key?{idempotencyKey:key}:{}),...out},null,2));
  if(!out.ok)process.exitCode=1;
}
const [cmd,...args]=process.argv.slice(2);
const flag=n=>{const i=args.indexOf(n);return i>=0?args.splice(i,2)[1]:null;};
if(cmd==='init'){
  const token=(await hidden('Token (không hiện khi gõ): ')).trim(),pin=(await hidden('PIN (không hiện khi gõ): ')).trim();
  if(!/^mth_[A-Za-z0-9_-]{20,100}$/.test(token)){console.error('Token không đúng dạng mth_…');process.exit(2);}
  mkdirSync(dirname(FILE),{recursive:true});writeFileSync(FILE,JSON.stringify({token,pin}),{mode:0o600});try{chmodSync(FILE,0o600);}catch{/* Windows keeps the user's ACL */}
  console.log('Đã lưu vào '+FILE+' (không in nội dung).');
}else if(cmd==='me'||cmd==='projects')await call('GET',cmd);
else if(cmd==='resolve'&&args.length===3)await call('GET','vms/resolve?'+new URLSearchParams({projectId:args[0],server:args[1],vm:args[2]}));
else if(cmd==='vm'&&args.length===2)await call('GET','vms/'+encodeURIComponent(args[1])+'?'+new URLSearchParams({projectId:args[0]}));
else if(cmd==='get'&&args.length===1)await call('GET',args[0]);
else if(cmd==='post'){const key=flag('--key')||randomUUID();if(args.length!==2){console.error('post <path> <body.json> [--key K]');process.exit(2);}await call('POST',args[0],JSON.parse(readFileSync(args[1],'utf8')),key);}
else{console.error('Lệnh: init | me | projects | resolve <projectId> <server> <vm> | vm <projectId> <vmId> | get <path> | post <path> <body.json> [--key K]');process.exit(2);}
