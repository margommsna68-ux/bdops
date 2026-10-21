import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
// scripts/ops-client.mjs, second review fix 21/10/2026: an unclear answer stays UNKNOWN, and every exact key has its own record.
// Fake local server, fake token and PIN only. The reviewer's reproductions (.runtime/review-ops-client-retry-20261021.test.ts) are
// kept unchanged in the first two tests.
const SCRIPT=resolve('scripts/ops-client.mjs'),TOKEN='mth_'+'r'.repeat(43),PIN='000111';
const dir=mkdtempSync(join(tmpdir(),'ops-client-retry-'));
const hits:{url:string;key:string;body:string}[]=[];const effects=new Map<string,string>();
// First answer per key for each failure mode; the command takes effect once per key before the answer is lost.
const FIRST:Record<string,(res:import('node:http').ServerResponse)=>void>={
  gateway:res=>{res.statusCode=502;res.end('<html>Gateway failure after upstream accepted</html>');},
  unavailable:res=>{res.statusCode=503;res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:false,data:null,error:{code:'UNAVAILABLE',message:'x'}}));},
  internal:res=>{res.statusCode=500;res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:false,data:null,error:{code:'INTERNAL',message:'Lỗi máy chủ'}}));},
  html200:res=>{res.setHeader('content-type','text/html');res.end('<html>ok</html>');},
  shape:res=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({success:true,result:{}}));},
  okfalse200:res=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:false,data:null,error:{code:'VALIDATION',message:'x'}}));},
  array:res=>{res.setHeader('content-type','application/json');res.end('[]');},
  truncated:res=>{res.setHeader('content-type','application/json');res.end('{"ok":true,"data":{"rec');},
};
let server:Server,port=0;
beforeAll(async()=>{
  server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const key=String(req.headers['idempotency-key']);hits.push({url:req.url!,key,body});
    const mode=req.url!.split('/').pop()!;const first=!effects.has(key);if(first)effects.set(key,body);
    if(mode==='refuse'){res.statusCode=422;res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:false,data:null,error:{code:'VALIDATION',message:'Số tiền không hợp lệ'}}));return;}
    if(first&&FIRST[mode]){FIRST[mode](res);return;}
    res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,data:{replay:!first,key},error:null}));
  });});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',()=>r()));port=(server.address() as {port:number}).port;
});
afterAll(()=>new Promise<void>(r=>{server.close(()=>r());rmSync(dir,{recursive:true,force:true});}));
const run=(args:string[],journal:string)=>new Promise<{code:number;out:string;err:string}>(r=>execFile(process.execPath,[SCRIPT,...args],{env:{...process.env,MTH_BASE:'http://127.0.0.1:'+port,MTH_TOKEN:TOKEN,MTH_PIN:PIN,MTH_JOURNAL_DIR:join(dir,journal)}},(e,out,err)=>r({code:e?(e as {code?:number}).code??1:0,out,err})));
const bodyFile=(name:string,v:unknown)=>{const f=join(dir,name+'.json');writeFileSync(f,JSON.stringify(v));return f;};
const pendingKeys=async(journal:string)=>(JSON.parse((await run(['pending'],journal)).out) as {key:string}[]).map(x=>x.key);

describe('ops-client: reviewer reproductions (unchanged expectations)',()=>{
  it('a gateway failure after accepting POST stays unresolved and appears in pending',async()=>{
    const body=bodyFile('gateway-body',{projectId:'synthetic',amount:'10.00'});
    const result=await run(['post','gateway',body,'--key','review-gateway-1'],'repro-gateway');
    expect(hits.some(h=>h.key==='review-gateway-1')).toBe(true);
    expect(await pendingKeys('repro-gateway')).toContain('review-gateway-1');
    expect(JSON.parse(result.out).error.code).toBe('RESULT_UNKNOWN');
  });
  it('two distinct valid keys keep distinct command records and retry sends exactly the requested key',async()=>{
    const body=bodyFile('key-body',{projectId:'synthetic',amount:'10.00'});
    expect((await run(['post','withdrawals/prepare',body,'--key','review:collision:1'],'repro-collision')).code).toBe(0);
    expect((await run(['post','withdrawals/prepare',body,'--key','review_collision_1'],'repro-collision')).code).toBe(0);
    await run(['retry','review:collision:1'],'repro-collision');
    expect(hits.at(-1)!.key).toBe('review:collision:1');
  });
});

describe('ops-client: an answer that does not settle the command stays UNKNOWN',()=>{
  for(const mode of Object.keys(FIRST))it(mode+': the command took effect once, the answer is unclear → UNKNOWN, pending; retry = same key / path / body, one effect',async()=>{
    const key='unk-'+mode+'-0001',journal='unk-'+mode,body=bodyFile('unk-'+mode,{projectId:'p',amount:'10.00',mode});
    const first=await run(['post','withdrawals/'+mode,body,'--key',key],journal);
    expect(first.code).toBe(3);
    const out=JSON.parse(first.out);expect(out.error).toEqual({code:'RESULT_UNKNOWN',message:'Chưa xác định kết quả. Gửi lại bằng retry '+key+'.'});expect(out.idempotencyKey).toBe(key);
    expect(await pendingKeys(journal)).toEqual([key]);
    const again=await run(['retry',key],journal);
    expect(again.code).toBe(0);expect(JSON.parse(again.out)).toMatchObject({ok:true,data:{replay:true,key}});
    const mine=hits.filter(h=>h.key===key);expect(mine).toHaveLength(2);expect(new Set(mine.map(h=>h.url+'|'+h.body)).size).toBe(1);
    expect(effects.get(key)).toBe(mine[0].body);
    expect(await pendingKeys(journal)).toEqual([]);
  });
  it('a well-formed 4xx refusal of the contract is a known result (ANSWERED, not pending)',async()=>{
    const r=await run(['post','withdrawals/refuse',bodyFile('refuse',{projectId:'p'}),'--key','refuse-0001'],'refuse');
    expect(r.code).toBe(1);expect(JSON.parse(r.out).error.code).toBe('VALIDATION');
    expect(await pendingKeys('refuse')).toEqual([]);
  });
});

describe('ops-client: one record per exact key',()=>{
  it('keys that differ by ":" / "_" or by letter case are stored apart, and each retry sends its own key and body',async()=>{
    const keys=['case:mix:0001','case_mix_0001','Case_Mix_0001','CASE_MIX_0001','case.mix.0001'];
    for(const [i,k] of keys.entries())expect((await run(['post','withdrawals/prepare',bodyFile('case-'+i,{projectId:'p',n:i}),'--key',k],'case')).code,k).toBe(0);
    expect(readdirSync(join(dir,'case')).filter(f=>f.endsWith('.json'))).toHaveLength(keys.length);
    for(const [i,k] of keys.entries()){const r=await run(['retry',k],'case');expect(r.code,k).toBe(0);expect(hits.at(-1)).toMatchObject({key:k,body:JSON.stringify({projectId:'p',n:i})});}
    // The same key with another body is still refused, nothing sent.
    const n=hits.length,refused=await run(['post','withdrawals/prepare',bodyFile('case-other',{projectId:'p',n:99}),'--key','case:mix:0001'],'case');
    expect(refused.code).toBe(2);expect(refused.err).toMatch(/lệnh khác/);expect(hits.length).toBe(n);
  });
  it('an old journal file of this exact key still works and is kept; an old file of another key or a broken record stops without sending or touching it',async()=>{
    const j=join(dir,'legacy');mkdirSync(j,{recursive:true});
    const rec=(key:string,path:string,body:unknown)=>({key,method:'POST',path,body,hash:createHash('sha256').update(path+'\u0000'+JSON.stringify(body)).digest('hex'),createdAt:'2026-10-21T00:00:00.000Z',attempts:1,state:'UNKNOWN',lastTryAt:'2026-10-21T00:00:00.000Z'});
    const own=JSON.stringify(rec('legacy_own_01','withdrawals/prepare',{projectId:'p',old:1}));writeFileSync(join(j,'legacy_own_01.json'),own);
    const other=JSON.stringify(rec('legacy:col:01','withdrawals/prepare',{projectId:'p',old:2}));writeFileSync(join(j,'legacy_col_01.json'),other);
    expect(await pendingKeys('legacy')).toEqual(expect.arrayContaining(['legacy_own_01','legacy:col:01']));
    const ok=await run(['retry','legacy_own_01'],'legacy');expect(ok.code).toBe(0);expect(hits.at(-1)).toMatchObject({key:'legacy_own_01',body:JSON.stringify({projectId:'p',old:1})});
    expect(readFileSync(join(j,'legacy_own_01.json'),'utf8')).toBe(own);
    expect(await pendingKeys('legacy')).toEqual(['legacy:col:01']);
    // "legacy_col_01" maps to the old file that holds "legacy:col:01": its own record may have been overwritten → stop.
    let n=hits.length,stop=await run(['retry','legacy_col_01'],'legacy');
    expect(stop.code).toBe(2);expect(stop.err).toMatch(/Nhật ký cũ .* giữ key "legacy:col:01"/);expect(hits.length).toBe(n);
    stop=await run(['post','withdrawals/prepare',bodyFile('legacy-new',{projectId:'p'}),'--key','legacy_col_01'],'legacy');
    expect(stop.code).toBe(2);expect(hits.length).toBe(n);expect(readFileSync(join(j,'legacy_col_01.json'),'utf8')).toBe(other);
    // The exact old key itself still retries from the old file.
    const col=await run(['retry','legacy:col:01'],'legacy');expect(col.code).toBe(0);expect(hits.at(-1)!.key).toBe('legacy:col:01');
    // A broken record is never guessed or overwritten.
    const key='broken-key-01',file=join(j,'k-'+createHash('sha256').update(key).digest('hex')+'.json');writeFileSync(file,'{"key":"broken-key-01",');
    n=hits.length;stop=await run(['retry',key],'legacy');expect(stop.code).toBe(2);expect(stop.err).toMatch(/bị hỏng/);
    stop=await run(['post','withdrawals/prepare',bodyFile('broken',{projectId:'p'}),'--key',key],'legacy');expect(stop.code).toBe(2);expect(hits.length).toBe(n);
    expect(readFileSync(file,'utf8')).toBe('{"key":"broken-key-01",');
    expect(JSON.parse((await run(['pending'],'legacy')).out)).toEqual(expect.arrayContaining([expect.objectContaining({state:'UNREADABLE',file:'k-'+createHash('sha256').update(key).digest('hex')+'.json'})]));
    // A record moved to another key's file is refused too.
    const k2='moved-key-01',f2=join(j,'k-'+createHash('sha256').update(k2).digest('hex')+'.json');writeFileSync(f2,JSON.stringify(rec('other-key-01','withdrawals/prepare',{projectId:'p'})));
    stop=await run(['retry',k2],'legacy');expect(stop.code).toBe(2);expect(stop.err).toMatch(/không phải "moved-key-01"/);expect(hits.length).toBe(n);expect(existsSync(f2)).toBe(true);
  });
});
