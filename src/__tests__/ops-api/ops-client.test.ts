import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync,readdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
// scripts/ops-client.mjs (review fix 21/10/2026) against fake local servers, with a fake token and PIN only.
const SCRIPT=resolve('scripts/ops-client.mjs'),TOKEN='mth_'+'f'.repeat(43),PIN='000111';
type Hit={method:string;url:string;key:string|null;auth:boolean;pin:boolean;body:string};
const hits:Hit[]=[],stolen:Hit[]=[];const effects=new Map<string,string>(),dropFirst=true;
let api:Server,other:Server,apiPort=0,otherPort=0;const dir=mkdtempSync(join(tmpdir(),'ops-client-'));
const listen=(s:Server)=>new Promise<number>(r=>s.listen(0,'127.0.0.1',()=>r((s.address() as {port:number}).port)));
beforeAll(async()=>{
  other=createServer((req,res)=>{stolen.push({method:req.method!,url:req.url!,key:null,auth:!!req.headers.authorization,pin:!!req.headers['x-ops-pin'],body:''});res.end('{}');});otherPort=await listen(other);
  api=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const h={method:req.method!,url:req.url!,key:(req.headers['idempotency-key'] as string)||null,auth:!!req.headers.authorization,pin:!!req.headers['x-ops-pin'],body};hits.push(h);
    if(req.url==='/api/ops/v1/me'){res.writeHead(302,{location:'http://127.0.0.1:'+otherPort+'/steal'});res.end();return;}
    if(req.method==='POST'&&h.key){const first=!effects.has(h.key);if(first)effects.set(h.key,body); // the command takes effect once per key
      if(first&&dropFirst){req.socket.destroy();return;}
      res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,data:{replay:!first},error:null}));return;}
    res.end(JSON.stringify({ok:true,data:{},error:null}));});});apiPort=await listen(api);
});
afterAll(async()=>{api.close();other.close();rmSync(dir,{recursive:true,force:true});});
const run=(args:string[],base=`http://localhost:${apiPort}`)=>new Promise<{code:number;out:string;err:string}>(r=>execFile('node',[SCRIPT,...args],{env:{...process.env,MTH_BASE:base,MTH_TOKEN:TOKEN,MTH_PIN:PIN,MTH_JOURNAL_DIR:join(dir,'journal')}},(e,out,err)=>r({code:e?(e as {code?:number}).code??1:0,out,err})));
describe('ops-client: lost answers',()=>{
  it('prints and logs the key before sending; a dropped connection is "Chưa xác định kết quả"; retry sends the same key and body once more, with one effect',async()=>{
    const body=join(dir,'prepare.json');writeFileSync(body,JSON.stringify({projectId:'p',amount:'10.00'}));
    const first=await run(['post','withdrawals/prepare',body]);
    expect(first.code).toBe(3);const out=JSON.parse(first.out);expect(out.error.code).toBe('RESULT_UNKNOWN');expect(out.error.message).toMatch(/Chưa xác định kết quả/);
    const key=out.idempotencyKey as string;expect(first.err).toContain('Idempotency-Key: '+key);
    const log=readFileSync(join(dir,'journal',readdirSync(join(dir,'journal'))[0]),'utf8');expect(log).toContain(key);expect(log).not.toContain(TOKEN);expect(log).not.toContain(PIN);expect(JSON.parse(log).state).toBe('UNKNOWN');
    expect(JSON.parse((await run(['pending'])).out).map((e:{key:string})=>e.key)).toEqual([key]);
    const again=await run(['retry',key]);expect(again.code).toBe(0);expect(JSON.parse(again.out)).toMatchObject({ok:true,data:{replay:true},idempotencyKey:key});
    const posts=hits.filter(h=>h.method==='POST');expect(posts.map(h=>h.key)).toEqual([key,key]);expect(new Set(posts.map(h=>h.body)).size).toBe(1);expect(effects.size).toBe(1);
    expect(JSON.parse((await run(['pending'])).out)).toEqual([]);
    // The key of that command is never used for another body.
    const changed=join(dir,'changed.json');writeFileSync(changed,JSON.stringify({projectId:'p',amount:'20.00'}));
    const n=hits.length,refused=await run(['post','withdrawals/prepare',changed,'--key',key]);expect(refused.code).toBe(2);expect(refused.err).toMatch(/lệnh khác/);expect(hits.length).toBe(n);
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
