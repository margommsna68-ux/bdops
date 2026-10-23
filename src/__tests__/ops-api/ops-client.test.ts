import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync,readdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
// scripts/ops-client.mjs (review fix 21/10/2026; approvals + no PIN 23/10/2026) against fake local servers, with a fake token only.
const SCRIPT=resolve('scripts/ops-client.mjs'),TOKEN='mth_'+'f'.repeat(43),FULL_SDK='sdk-full-code-ABCDEF123456';
type Hit={method:string;url:string;key:string|null;auth:boolean;pin:boolean;body:string};
const hits:Hit[]=[],stolen:Hit[]=[];const effects=new Map<string,string>(),dropFirst=true;
// Approval fakes (23/10/2026): a key under /approve/ is held until `decide` names it; the body hash is what the ADMIN approves.
const decide=new Map<string,'APPROVED'|'REJECTED'|'EXPIRED'>();const held=new Map<string,string>();
let api:Server,other:Server,apiPort=0,otherPort=0;const dir=mkdtempSync(join(tmpdir(),'ops-client-'));
const listen=(s:Server)=>new Promise<number>(r=>s.listen(0,'127.0.0.1',()=>r((s.address() as {port:number}).port)));
const env=(s:string,code:string,details:Record<string,unknown>)=>JSON.stringify({ok:false,data:null,error:{code,message:s,details}});
beforeAll(async()=>{
  other=createServer((req,res)=>{stolen.push({method:req.method!,url:req.url!,key:null,auth:!!req.headers.authorization,pin:!!req.headers['x-ops-pin'],body:''});res.end('{}');});otherPort=await listen(other);
  api=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const h={method:req.method!,url:req.url!,key:(req.headers['idempotency-key'] as string)||null,auth:!!req.headers.authorization,pin:!!req.headers['x-ops-pin'],body};hits.push(h);
    if(req.url==='/api/ops/v1/me'){res.writeHead(302,{location:'http://127.0.0.1:'+otherPort+'/steal'});res.end();return;}
    if(req.method==='POST'&&h.key&&/\/api\/ops\/v1\/(withdrawals\/prepare|sdks\/[^/]+\/reveal)$/.test(req.url!)&&h.key.startsWith('appr-')){
      res.setHeader('content-type','application/json');
      const d=decide.get(h.key);
      if(held.has(h.key)&&held.get(h.key)!==body){res.writeHead(409);res.end(env('khác nội dung','IDEMPOTENCY_CONFLICT',{}));return;}
      if(!d){held.set(h.key,body);res.writeHead(202);res.end(env('chờ ADMIN duyệt','APPROVAL_REQUIRED',{approvalId:'ap-'+h.key,status:'PENDING',expiresAt:'2026-10-23T09:15:00.000Z'}));return;}
      if(d==='REJECTED'){res.writeHead(403);res.end(env('ADMIN đã từ chối','APPROVAL_REJECTED',{approvalId:'ap-'+h.key,status:'REJECTED'}));return;}
      if(d==='EXPIRED'){res.writeHead(410);res.end(env('hết hạn','APPROVAL_EXPIRED',{approvalId:'ap-'+h.key,expiredAt:'2026-10-23T09:15:00.000Z'}));return;}
      const first=!effects.has(h.key);if(first)effects.set(h.key,body);
      res.end(JSON.stringify({ok:true,data:req.url!.includes('/reveal')?{replay:!first,sdkId:'s1',code:FULL_SDK,revision:0,linkState:'UNLINKED',currentOf:null,note:'một lần'}:{replay:!first},error:null}));return;}
    if(req.method==='POST'&&h.key){const first=!effects.has(h.key);if(first)effects.set(h.key,body); // the command takes effect once per key
      if(first&&dropFirst){req.socket.destroy();return;}
      res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,data:{replay:!first},error:null}));return;}
    res.end(JSON.stringify({ok:true,data:{},error:null}));});});apiPort=await listen(api);
});
afterAll(async()=>{api.close();other.close();rmSync(dir,{recursive:true,force:true});});
const run=(args:string[],base=`http://localhost:${apiPort}`)=>new Promise<{code:number;out:string;err:string}>(r=>execFile('node',[SCRIPT,...args],{env:{...process.env,MTH_BASE:base,MTH_TOKEN:TOKEN,MTH_PIN:undefined,MTH_JOURNAL_DIR:join(dir,'journal')}},(e,out,err)=>r({code:e?(e as {code?:number}).code??1:0,out,err})));
const journalText=()=>readdirSync(join(dir,'journal')).map(f=>readFileSync(join(dir,'journal',f),'utf8')).join('\n');
describe('ops-client: lost answers',()=>{
  it('prints and logs the key before sending; a dropped connection is "Chưa xác định kết quả"; retry sends the same key and body once more, with one effect; no X-Ops-Pin is ever sent',async()=>{
    const body=join(dir,'balance.json');writeFileSync(body,JSON.stringify({projectId:'p',amount:'10.00'}));
    const first=await run(['post','vms/v1/balance-check',body]);
    expect(first.code).toBe(3);const out=JSON.parse(first.out);expect(out.error.code).toBe('RESULT_UNKNOWN');expect(out.error.message).toMatch(/Chưa xác định kết quả/);
    const key=out.idempotencyKey as string;expect(first.err).toContain('Idempotency-Key: '+key);
    const log=readFileSync(join(dir,'journal',readdirSync(join(dir,'journal'))[0]),'utf8');expect(log).toContain(key);expect(log).not.toContain(TOKEN);expect(JSON.parse(log).state).toBe('UNKNOWN');
    expect(JSON.parse((await run(['pending'])).out).map((e:{key:string})=>e.key)).toEqual([key]);
    const again=await run(['retry',key]);expect(again.code).toBe(0);expect(JSON.parse(again.out)).toMatchObject({ok:true,data:{replay:true},idempotencyKey:key});
    const posts=hits.filter(h=>h.method==='POST');expect(posts.map(h=>h.key)).toEqual([key,key]);expect(new Set(posts.map(h=>h.body)).size).toBe(1);expect(effects.size).toBe(1);
    expect(posts.every(h=>h.auth&&!h.pin)).toBe(true);
    expect(JSON.parse((await run(['pending'])).out)).toEqual([]);
    // The key of that command is never used for another body.
    const changed=join(dir,'changed.json');writeFileSync(changed,JSON.stringify({projectId:'p',amount:'20.00'}));
    const n=hits.length,refused=await run(['post','vms/v1/balance-check',changed,'--key',key]);expect(refused.code).toBe(2);expect(refused.err).toMatch(/lệnh khác/);expect(hits.length).toBe(n);
  });
  it('an old secret file with a pin is read for its token; the pin is ignored and never sent',async()=>{
    const file=join(dir,'old-secret.json');writeFileSync(file,JSON.stringify({token:TOKEN,pin:'000111'}));
    const r=await new Promise<{code:number;out:string}>(res=>execFile('node',[SCRIPT,'projects'],{env:{...process.env,MTH_BASE:`http://localhost:${apiPort}`,MTH_TOKEN:undefined,MTH_SECRET_FILE:file,MTH_JOURNAL_DIR:join(dir,'journal')}},(e,out)=>res({code:e?(e as {code?:number}).code??1:0,out})));
    expect(r.code).toBe(0);const last=hits[hits.length-1];expect(last.url).toBe('/api/ops/v1/projects');expect(last.auth).toBe(true);expect(last.pin).toBe(false);
  });
});
describe('ops-client: approvals (23/10/2026)',()=>{
  it('202 APPROVAL_REQUIRED → WAITING_APPROVAL (exit 4, not recorded, listed by `approvals`); after the ADMIN approves, retry with the same key and body runs once → DONE',async()=>{
    const body=join(dir,'prepare.json');writeFileSync(body,JSON.stringify({projectId:'p',amount:'10.00'}));
    const key='appr-ok-'+Date.now();
    const first=await run(['post','withdrawals/prepare',body,'--key',key]);
    expect(first.code).toBe(4);const out=JSON.parse(first.out);
    expect(out).toMatchObject({ok:false,status:202,commandState:'WAITING_APPROVAL',approvalId:'ap-'+key,expiresAt:'2026-10-23T09:15:00.000Z',idempotencyKey:key,error:{code:'APPROVAL_REQUIRED'}});
    expect(out.message).toContain('ADMIN duyệt trên web (Phê duyệt), rồi chạy lại: retry '+key);
    const entry=JSON.parse(readFileSync(join(dir,'journal','k-'+(await import('node:crypto')).createHash('sha256').update(key).digest('hex')+'.json'),'utf8'));
    expect(entry).toMatchObject({key,state:'WAITING_APPROVAL',approvalId:'ap-'+key,approvalExpiresAt:'2026-10-23T09:15:00.000Z',body:{projectId:'p',amount:'10.00'}});expect(entry.hash).toBeTruthy();
    expect(JSON.parse((await run(['approvals'])).out)).toMatchObject([{key,approvalId:'ap-'+key,expiresAt:'2026-10-23T09:15:00.000Z',state:'WAITING_APPROVAL'}]);
    expect(JSON.parse((await run(['pending'])).out)).toEqual([]); // waiting is not "result unknown"
    // Still pending: a retry gets 202 again and stays waiting with the same approval.
    const again=await run(['retry',key]);expect(again.code).toBe(4);expect(JSON.parse(again.out)).toMatchObject({commandState:'WAITING_APPROVAL',approvalId:'ap-'+key});
    decide.set(key,'APPROVED');
    const done=await run(['retry',key]);expect(done.code).toBe(0);expect(JSON.parse(done.out)).toMatchObject({ok:true,commandState:'DONE',data:{replay:false},idempotencyKey:key});
    const posts=hits.filter(h=>h.key===key);expect(posts.length).toBe(3);expect(new Set(posts.map(h=>h.body)).size).toBe(1);expect(posts.every(h=>!h.pin)).toBe(true);
    expect(JSON.parse((await run(['approvals'])).out)).toEqual([]);
    // A later retry replays and the command stays DONE.
    const replay=await run(['retry',key]);expect(replay.code).toBe(0);expect(JSON.parse(replay.out)).toMatchObject({commandState:'DONE',data:{replay:true}});
  });
  it('403 APPROVAL_REJECTED → REJECTED (final, exit 1); 410 APPROVAL_EXPIRED → EXPIRED (exit 1, new key needed)',async()=>{
    const body=join(dir,'prepare2.json');writeFileSync(body,JSON.stringify({projectId:'p',amount:'11.00'}));
    const rej='appr-rej-'+Date.now(),exp='appr-exp-'+Date.now();
    expect((await run(['post','withdrawals/prepare',body,'--key',rej])).code).toBe(4);
    expect((await run(['post','withdrawals/prepare',body,'--key',exp])).code).toBe(4);
    expect(JSON.parse((await run(['approvals'])).out).map((e:{key:string})=>e.key).sort()).toEqual([exp,rej].sort());
    decide.set(rej,'REJECTED');decide.set(exp,'EXPIRED');
    const r=await run(['retry',rej]);expect(r.code).toBe(1);expect(JSON.parse(r.out)).toMatchObject({commandState:'REJECTED',error:{code:'APPROVAL_REJECTED'},approvalId:'ap-'+rej});
    const e=await run(['retry',exp]);expect(e.code).toBe(1);const eo=JSON.parse(e.out);expect(eo).toMatchObject({commandState:'EXPIRED',error:{code:'APPROVAL_EXPIRED'}});expect(eo.message).toMatch(/key MỚI/);
    expect(JSON.parse((await run(['approvals'])).out)).toEqual([]);expect(JSON.parse((await run(['pending'])).out)).toEqual([]);
    // Final: a further retry of a rejected command is not sent again as a new approval request by the client's own state (it still sends, the server answers the same).
    const r2=await run(['retry',rej]);expect(r2.code).toBe(1);expect(JSON.parse(r2.out).commandState).toBe('REJECTED');
  });
  it('sdk-reveal: waits for approval, then prints the full code once on stdout; the command log never holds the code',async()=>{
    const key='appr-reveal-'+Date.now();
    const first=await run(['sdk-reveal','p','s1','--key',key]);expect(first.code).toBe(4);expect(JSON.parse(first.out).commandState).toBe('WAITING_APPROVAL');
    const sent=hits.filter(h=>h.key===key);expect(sent[0].url).toBe('/api/ops/v1/sdks/s1/reveal');expect(JSON.parse(sent[0].body)).toEqual({projectId:'p'});
    decide.set(key,'APPROVED');
    const done=await run(['retry',key]);expect(done.code).toBe(0);const out=JSON.parse(done.out);expect(out.commandState).toBe('DONE');expect(out.data.code).toBe(FULL_SDK);
    expect(journalText()).not.toContain(FULL_SDK);expect(journalText()).not.toContain(TOKEN);
  });
});
describe('ops-client: secrets go only to /api/ops/v1/ on MTH_BASE',()=>{
  it('refuses traversal (plain and encoded), https-less remote bases and redirects, before any credential is sent elsewhere',async()=>{
    const n=hits.length;
    for(const p of ['../../../outside-ops','%2e%2e/%2e%2e/outside','%252e%252e/x','..%2fx','/absolute','http://127.0.0.1:'+otherPort+'/x','a/./b','x\\..\\y']){const r=await run(['get',p]);expect(r.code,p).toBe(2);expect(r.err,p).toMatch(/bị từ chối|không hợp lệ/);}
    expect(hits.length).toBe(n);
    expect((await run(['me'],'http://example.invalid')).err).toMatch(/https/);
    const r=await run(['me']);expect(r.code).toBe(3);expect(r.err).toMatch(/chuyển hướng/);expect(stolen).toEqual([]);
  });
});
