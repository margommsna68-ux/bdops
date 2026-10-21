import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
// scripts/ops-client.mjs, third review fix 21/10/2026: the command's state is not the result of the latest attempt.
// Fake local server, fake token / PIN. The reviewer's reproduction (.runtime/review-ops-client-retry-refused-20261021.test.ts) is kept
// with unchanged expectations in the first block.
const SCRIPT=resolve('scripts/ops-client.mjs'),TOKEN='mth_'+'s'.repeat(43),PIN='000111';
const dir=mkdtempSync(join(tmpdir(),'ops-client-state-'));
type Reply='commit502'|'ok'|'okReplay'|'r401'|'r403'|'r429'|'r422'|'g502';
const REFUSE:Record<string,[number,string]>={r401:[401,'TOKEN_REVOKED'],r403:[403,'FORBIDDEN'],r429:[429,'RATE_LIMITED'],r422:[422,'VALIDATION']};
// Scenario = the server's answer for attempt 1, 2, 3… of one key (last one repeats). "commit" answers record the effect.
const SCEN:Record<string,Reply[]>={
  revoked:['commit502','r401','okReplay'],rights:['commit502','r403','okReplay'],rate:['commit502','r429','okReplay'],
  donethen401:['ok','r401'],donethen403:['ok','r403'],donethen429:['ok','r429'],donethen502:['ok','g502'],
  newrefused:['r422','r422','ok'],newrefused502:['r422','g502','okReplay'],twice:['commit502','g502','r403','r429','okReplay'],
};
const hits=new Map<string,number>(),effects=new Map<string,number>();
let server:Server,port=0;
beforeAll(async()=>{
  server=createServer((req,res)=>{req.resume();req.on('end',()=>{
    const key=String(req.headers['idempotency-key']),n=(hits.get(key)||0)+1;hits.set(key,n);
    const s=SCEN[req.url!.split('/').pop()!],r=s[Math.min(n,s.length)-1];
    const effect=()=>effects.set(key,(effects.get(key)||0)+(effects.has(key)?0:1)); // once per key, like the API
    if(r==='commit502'||r==='g502'){if(r==='commit502')effect();res.statusCode=502;res.end('<html>Bad gateway</html>');return;}
    res.setHeader('content-type','application/json');
    if(r==='ok'||r==='okReplay'){const replay=effects.has(key);effect();res.end(JSON.stringify({ok:true,data:{replay,recorded:{key}},error:null}));return;}
    const [st,code]=REFUSE[r];res.statusCode=st;if(st===429)res.setHeader('retry-after','30');res.end(JSON.stringify({ok:false,data:null,error:{code,message:'refused '+code}}));
  });});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',()=>r()));port=(server.address() as {port:number}).port;
});
afterAll(()=>new Promise<void>(r=>{server.close(()=>r());rmSync(dir,{recursive:true,force:true});}));
const run=(args:string[],j:string)=>new Promise<{code:number;out:string;err:string}>(r=>execFile(process.execPath,[SCRIPT,...args],{env:{...process.env,MTH_BASE:'http://127.0.0.1:'+port,MTH_TOKEN:TOKEN,MTH_PIN:PIN,MTH_JOURNAL_DIR:join(dir,j)}},(e,out,err)=>r({code:e?Number((e as {code?:number}).code??1):0,out,err})));
const post=(scen:string,key:string)=>{const f=join(dir,scen+'.json');writeFileSync(f,JSON.stringify({projectId:'synthetic',amount:'10.00'}));return run(['post','withdrawals/'+scen,f,'--key',key],scen);};
const pending=async(j:string)=>(JSON.parse((await run(['pending'],j)).out) as {key:string}[]).map(x=>x.key);
const record=(j:string)=>JSON.parse(readFileSync(join(dir,j,readdirSync(join(dir,j)).find(f=>f.startsWith('k-'))!),'utf8'));

describe('a refused retry never settles a command that may already be recorded (reviewer reproduction)',()=>{
  for(const [mode,code] of [['revoked','TOKEN_REVOKED'],['rights','FORBIDDEN'],['rate','RATE_LIMITED']])it('502 after commit, then '+code+' → still UNKNOWN in pending, exit 3; after access is back the same key acknowledges the one effect',async()=>{
    const key='state-'+mode+'-0001';
    expect((await post(mode,key)).code).toBe(3);expect(await pending(mode)).toEqual([key]);
    const retry=await run(['retry',key],mode);
    expect(retry.code).toBe(3);expect(await pending(mode)).toEqual([key]);
    const out=JSON.parse(retry.out);expect(out.commandState).toBe('UNKNOWN');expect(out.attemptError.code).toBe(code);
    expect(out.error.message).toBe('Lần thử lại bị từ chối: '+code+' — refused '+code+'; kết quả lệnh ban đầu vẫn chưa xác định. Khôi phục quyền truy cập rồi chạy lại retry '+key+' (không tạo key mới cho lệnh này).');
    expect(record(mode)).toMatchObject({key,path:'withdrawals/'+mode,body:{projectId:'synthetic',amount:'10.00'},state:'UNKNOWN',lastAttempt:{result:'REFUSED',httpStatus:code==='TOKEN_REVOKED'?401:code==='FORBIDDEN'?403:429,errorCode:code}});
    const ok=await run(['retry',key],mode);expect(ok.code).toBe(0);expect(JSON.parse(ok.out)).toMatchObject({commandState:'DONE',data:{replay:true}});
    expect(effects.get(key)).toBe(1);expect(await pending(mode)).toEqual([]);
  });
  it('several unclear and refused retries in a row keep the command UNKNOWN until a success',async()=>{
    const key='state-twice-0001';expect((await post('twice',key)).code).toBe(3);
    for(let i=0;i<3;i++){expect((await run(['retry',key],'twice')).code).toBe(3);expect(await pending('twice')).toEqual([key]);}
    expect((await run(['retry',key],'twice')).code).toBe(0);expect(effects.get(key)).toBe(1);expect(record('twice').attempts).toBe(5);
  });
});

describe('a DONE command stays DONE whatever a later retry gets',()=>{
  for(const [scen,code] of [['donethen401','TOKEN_REVOKED'],['donethen403','FORBIDDEN'],['donethen429','RATE_LIMITED'],['donethen502',null]] as const)it('DONE, then retry '+(code??'502 HTML')+' → DONE, exit 0, not pending',async()=>{
    const key='state-'+scen+'-01';expect((await post(scen,key)).code).toBe(0);
    const r=await run(['retry',key],scen);expect(r.code).toBe(0);
    const out=JSON.parse(r.out);expect(out.commandState).toBe('DONE');expect(out.message).toMatch(/^Lệnh đã ghi xong trước đó \(DONE lúc /);expect(out.message).toMatch(/không làm lệnh thành chưa ghi/);
    if(code)expect(out.lastAttempt).toMatchObject({result:'REFUSED',errorCode:code});else expect(out.lastAttempt).toMatchObject({result:'UNCLEAR',httpStatus:502});
    expect(record(scen)).toMatchObject({state:'DONE',lastAttempt:{result:code?'REFUSED':'UNCLEAR'}});expect(await pending(scen)).toEqual([]);
  });
});

describe('a new command refused clearly on its first attempt is handled as before',()=>{
  it('first 422 → ANSWERED, exit 1, not pending; refused again → ANSWERED; a later success → DONE',async()=>{
    const key='state-newrefused-01',first=await post('newrefused',key);
    expect(first.code).toBe(1);expect(JSON.parse(first.out)).toMatchObject({commandState:'ANSWERED',ok:false,error:{code:'VALIDATION'}});expect(await pending('newrefused')).toEqual([]);
    expect((await run(['retry',key],'newrefused')).code).toBe(1);expect(record('newrefused').state).toBe('ANSWERED');
    expect((await run(['retry',key],'newrefused')).code).toBe(0);expect(record('newrefused').state).toBe('DONE');
  });
  it('ANSWERED, then a retry with an unclear answer → UNKNOWN (that attempt may have been recorded)',async()=>{
    const key='state-newrefused502-01';expect((await post('newrefused502',key)).code).toBe(1);
    expect((await run(['retry',key],'newrefused502')).code).toBe(3);expect(await pending('newrefused502')).toEqual([key]);
  });
});
