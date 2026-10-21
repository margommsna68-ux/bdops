import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
// ops-client `sdk-prepare` → survey → `sdk-survey` (owner brief 22/10/2026; independent review fix) against a fake local server, with a
// fake token and PIN only: the identity is captured before the machines are read and sent as captured; one result per VM line; a
// refused line keeps the list going; a rerun never sends a recorded VM again, retries an unknown one with the same key and body, and
// leaves a refused one alone until --redo (which resends the same captured entry, never a re-read one).
const SCRIPT=resolve('scripts/ops-client.mjs'),TOKEN='mth_'+'v'.repeat(43),PIN='000111';
type Hit={method:string;url:string;key:string|null;body:string};
const hits:Hit[]=[],effects=new Map<string,string>();let dropVm2=true,refuseVm3=true,vmRevision=7;
let api:Server,port=0;const dir=mkdtempSync(join(tmpdir(),'ops-survey-'));
const listen=(s:Server)=>new Promise<number>(r=>s.listen(0,'127.0.0.1',()=>r((s.address() as {port:number}).port)));
const ok=(data:unknown)=>JSON.stringify({ok:true,data,error:null});
beforeAll(async()=>{
  api=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const key=(req.headers['idempotency-key'] as string)||null;hits.push({method:req.method!,url:req.url!,key,body});res.setHeader('content-type','application/json');
    const u=new URL(req.url!,'http://x'),m=/^\/api\/ops\/v1\/vms\/([^/]+)(\/sdk-observations)?$/.exec(u.pathname);
    if(req.method==='GET'&&m&&!m[2]){res.end(ok({id:m[1],serverCode:'S1',code:m[1].toUpperCase(),expectedCycle:2,revision:vmRevision,currentSdk:null,sdk:{items:m[1]==='vm1'?[{code:'SDKLIST0001',revision:4}]:[]}}));return;}
    if(req.method==='GET'&&u.pathname==='/api/ops/v1/sdks'){res.end(ok({amountsVisible:true,items:u.searchParams.getAll('code').map(code=>code==='SDKSTORE001'?{code,found:true,revision:1}:{code,found:false,revision:null})}));return;}
    if(req.method==='POST'&&m&&m[2]&&key){
      if(m[1]==='vm3'&&refuseVm3){res.statusCode=409;res.end(JSON.stringify({ok:false,data:null,error:{code:'SDK_CONFLICT',message:'VM đang có SDK hiện hành khác',details:{kind:'CURRENT_DIFFERS'}}}));return;}
      const first=!effects.has(key);if(first)effects.set(key,body);
      if(m[1]==='vm2'&&first&&dropVm2){req.socket.destroy();return;}
      res.end(ok({replay:!first,recorded:{sdks:JSON.parse(body).sdks.map((s:{code:string})=>({code:s.code,placed:'CREATED',linkState:'UNCONFIRMED',current:false,amount:{outcome:'SAVED',amountUsd:'1',observedAt:null}}))},current:null}));return;}
    res.statusCode=404;res.end(JSON.stringify({ok:false,data:null,error:{code:'NOT_FOUND',message:'x'}}));});});port=await listen(api);
});
afterAll(()=>{api.close();rmSync(dir,{recursive:true,force:true});});
const run=(args:string[])=>new Promise<{code:number;out:string;err:string}>(r=>execFile('node',[SCRIPT,...args],{env:{...process.env,MTH_BASE:'http://localhost:'+port,MTH_TOKEN:TOKEN,MTH_PIN:PIN,MTH_JOURNAL_DIR:join(dir,'journal')}},(e,out,err)=>r({code:e?(e as {code?:number}).code??1:0,out,err})));
type Capture={vmId:string;capturedAt:string;expectedCycle:number;expectedVmRevision:number;knownSdks:Record<string,number>;sdks:unknown[];observedAt:string|null;source:string|null};
const later=(iso:string,min:number)=>new Date(Date.parse(iso)+min*60e3).toISOString();
describe('ops-client sdk-prepare + sdk-survey',()=>{
  it('a survey without its capture, or read before it, is stopped before anything is sent',async()=>{
    const f=join(dir,'bad.json');writeFileSync(f,JSON.stringify([{projectId:'p1',vmId:'vm1',observedAt:'2026-10-21T01:00:00Z',source:'OCR',sdks:[{code:'SDKSAME0001'}]}]));
    const n=hits.length,r=await run(['sdk-survey',f]);expect(r.code).toBe(1);expect(JSON.parse(r.out).problems.some((p:{issue:string})=>/capturedAt/.test(p.issue))).toBe(true);expect(hits.length).toBe(n);
    const g=join(dir,'bad2.json');writeFileSync(g,JSON.stringify([{projectId:'p1',vmId:'vm1',capturedAt:'2026-10-21T02:00:00Z',expectedCycle:1,expectedVmRevision:0,knownSdks:{},observedAt:'2026-10-21T01:00:00Z',source:'OCR',sdks:[{code:'SDKSAME0001'}]}]));
    expect((await run(['sdk-survey',g])).code).toBe(1);expect(hits.length).toBe(n);
  });
  it('prepare captures the identity; the survey is sent exactly as captured (no read at send time); rerun / retry / --redo keep it',async()=>{
    const cap=join(dir,'capture.json'),f=join(dir,'survey.json');
    const p=await run(['sdk-prepare','p1','vm1','vm2','vm3','--code','SDKSTORE001','--out',cap]);expect(p.code).toBe(0);
    const captured=JSON.parse(readFileSync(cap,'utf8')) as Capture[];
    expect(captured.map(c=>[c.vmId,c.expectedCycle,c.expectedVmRevision,c.knownSdks])).toEqual([['vm1',2,7,{SDKLIST0001:4,SDKSTORE001:1}],['vm2',2,7,{SDKSTORE001:1}],['vm3',2,7,{SDKSTORE001:1}]]);
    // The machines are read after the capture; the survey is the capture plus what was seen.
    const fill=(c:Capture,sdks:unknown[])=>({...c,observedAt:later(c.capturedAt,5),source:'AE Mini Tool · OCR',sdks});
    writeFileSync(f,JSON.stringify([fill(captured[0],[{code:'SDKLIST0001',amountUsd:'0.21',current:true},{code:'SDKSTORE001'},{code:'SDKNEW00001',amountRead:false}]),fill(captured[1],[{code:'SDKNEW00002',amountUsd:'0'}]),fill(captured[2],[{code:'SDKNEW00003',current:true}])]));
    // The web moves on meanwhile (a newer VM revision): the survey must still carry the captured one.
    vmRevision=8;const before=hits.length;
    const first=await run(['sdk-survey',f]),out=JSON.parse(first.out);
    expect(first.code).toBe(3);expect(out).toMatchObject({total:3,done:1,refused:1,unknown:1});
    expect(out.lines.map((l:{vmId:string;state:string})=>[l.vmId,l.state])).toEqual([['vm1','DONE'],['vm2','UNKNOWN'],['vm3','ANSWERED']]);
    expect(out.lines[2]).toMatchObject({errorCode:'SDK_CONFLICT',details:{kind:'CURRENT_DIFFERS'}});
    expect(hits.slice(before).filter(h=>h.method==='GET')).toEqual([]);
    const post1=hits.find(h=>h.method==='POST'&&h.url.includes('/vms/vm1/'))!,b1=JSON.parse(post1.body);
    expect(b1).toMatchObject({projectId:'p1',expectedCycle:2,expectedVmRevision:7,observedAt:later(captured[0].capturedAt,5),source:'AE Mini Tool · OCR'});
    expect(b1.sdks).toEqual([{code:'SDKLIST0001',expectedSdkRevision:4,amountUsd:'0.21',current:true},{code:'SDKSTORE001',expectedSdkRevision:1},{code:'SDKNEW00001',expectedSdkRevision:null,amountRead:false}]);
    const keys=Object.fromEntries(out.lines.map((l:{vmId:string;key:string})=>[l.vmId,l.key]));
    // Rerun: vm1 is not sent again, vm2 goes again with the same key and body (one effect), vm3 is not resent; nothing read.
    dropVm2=false;const n=hits.length,again=JSON.parse((await run(['sdk-survey',f])).out),posts=hits.slice(n).filter(h=>h.method==='POST');
    expect(again).toMatchObject({done:2,refused:1,unknown:0});expect(posts.map(h=>h.key)).toEqual([keys.vm2]);
    expect(posts[0].body).toBe(effects.get(keys.vm2));expect(again.lines[1]).toMatchObject({state:'DONE',replay:true});
    expect(hits.slice(n).filter(h=>h.method==='GET')).toEqual([]);
    // --redo vm3 after the person checked: the same captured entry again (captured revision 7, not the web's 8), new key; DONE rows untouched.
    refuseVm3=false;const m=hits.length,redo=JSON.parse((await run(['sdk-survey',f,'--redo','vm3','--redo','vm1'])).out),p2=hits.slice(m).filter(h=>h.method==='POST');
    expect(redo).toMatchObject({done:3,refused:0});expect(p2.length).toBe(1);expect(p2[0].url).toContain('/vms/vm3/');expect(p2[0].key).not.toBe(keys.vm3);
    expect(JSON.parse(p2[0].body)).toMatchObject({expectedCycle:2,expectedVmRevision:7,sdks:[{code:'SDKNEW00003',expectedSdkRevision:null,current:true}]});
    expect(hits.slice(m).filter(h=>h.method==='GET')).toEqual([]);
    const runFile=JSON.parse(readFileSync(f+'.run.json','utf8'));expect(runFile.rows.vm1.key).toBe(keys.vm1);expect(JSON.stringify(runFile)).not.toContain(TOKEN);expect(JSON.stringify(runFile)).not.toContain(PIN);
  });
});
