import {afterAll,beforeAll,expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync,readdirSync,readFileSync,rmSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
// Owner decision 28/10/2026: the AI passes the ADMIN code typed in the chat to `session-open`. Local HTTP only: the code is sent once,
// to approval-sessions only, and never reaches the journal, stdout / stderr or any file, even when the server reflects it.
const dir=mkdtempSync(join(tmpdir(),'cli-approval-session-')),journal=join(dir,'journal'),TOTP='864209';
const hits:{path:string;key:string;body:any}[]=[];
let server:Server,port:number,mode='normal';
const ok=(data:unknown)=>({ok:true,data,error:null});
beforeAll(async()=>{
  server=createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
    const body=raw?JSON.parse(raw):{},path=req.url!.replace('/api/ops/v1/','');
    hits.push({path,key:String(req.headers['idempotency-key']||''),body});
    const send=(status:number,data:unknown)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
    if(path==='me')return send(200,ok({projects:[{projectId:'p1'}],approvalSession:{open:mode!=='closed',expiresAt:mode!=='closed'?'2099-01-01T00:00:00.000Z':null,approvedBy:mode!=='closed'?'tut':null}}));
    if(path==='approval-sessions'){
      if(mode==='refused')return send(403,{ok:false,data:null,error:{code:'FORBIDDEN',message:'Mã chưa đúng '+TOTP,details:{echo:TOTP}}});
      if(mode==='drop'){req.socket.destroy();return;}
      return send(200,ok({sessionId:'s1',expiresAt:'2099-01-01T00:00:00.000Z',approvedPending:2,totp:TOTP}));
    }
    if(path==='approval-sessions/close')return send(200,ok({closed:1}));
    send(200,ok({replay:false}));
  });});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));port=(server.address() as any).port;
});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));rmSync(dir,{recursive:true,force:true});});
function run(args:string[],input?:string){return new Promise<{code:number;out:string;err:string}>(r=>{
  const p=execFile(process.execPath,[resolve('scripts/ops-client.mjs'),...args],{env:{...process.env,MTH_BASE:`http://127.0.0.1:${port}`,MTH_TOKEN:'mth_'+'f'.repeat(43),MTH_JOURNAL_DIR:journal,MTH_RUNTIME_DIR:join(dir,'private'),MTH_PROXY_DIR:join(dir,'proxy')}},(e,out,err)=>r({code:e?Number(e.code):0,out,err}));
  p.stdin!.end(input??'');
});}
function everything(){const files:string[]=[];const walk=(d:string)=>{if(!existsSync(d))return;for(const f of readdirSync(d,{withFileTypes:true})){if(f.isDirectory())walk(join(d,f.name));else files.push(readFileSync(join(d,f.name),"utf8"));}};walk(dir);return files.join('\n');}
it('session-open --totp sends the code once to approval-sessions and prints only whitelisted fields',async()=>{
  mode='normal';const n=hits.length,r=await run(['session-open','--admin','tut','--totp',TOTP]);
  expect(r.code).toBe(0);expect(JSON.parse(r.out)).toEqual({ok:true,projectId:'p1',sessionId:'s1',expiresAt:'2099-01-01T00:00:00.000Z',approvedPending:2});
  const sent=hits.slice(n).filter(h=>h.path==='approval-sessions');expect(sent).toHaveLength(1);
  expect(sent[0].body).toEqual({projectId:'p1',admin:'tut',totp:TOTP});expect(sent[0].key).toMatch(/^[\w-]{8,100}$/);
  expect(r.out+r.err+everything()).not.toContain(TOTP);
});
it('session-open --totp-stdin with --project skips the me read; a refusal never echoes the code and is not resent',async()=>{
  mode='refused';const n=hits.length,r=await run(['session-open','--admin','tut','--totp-stdin','--project','p9'],TOTP+'\n');
  expect(r.code).toBe(1);expect(hits.slice(n).map(h=>h.path)).toEqual(['approval-sessions']);expect(hits[hits.length-1].body.projectId).toBe('p9');
  expect(JSON.parse(r.out).error.code).toBe('FORBIDDEN');expect(r.out+r.err+everything()).not.toContain(TOTP);
});
it('a lost answer is UNKNOWN (exit 3) and the code is not resent',async()=>{
  mode='drop';const n=hits.length,r=await run(['session-open','--admin','tut','--totp',TOTP,'--project','p1']);
  expect(r.code).toBe(3);expect(hits.slice(n).filter(h=>h.path==='approval-sessions')).toHaveLength(1);expect(r.out+r.err+everything()).not.toContain(TOTP);
});
it('a bad code shape, missing admin or no TTY sends nothing',async()=>{
  const n=hits.length;
  expect((await run(['session-open','--admin','tut','--totp','12ab56'])).code).toBe(2);
  expect((await run(['session-open','--totp',TOTP])).code).toBe(2);
  expect((await run(['session-open','--admin','tut'],TOTP+'\n')).code).toBe(2);
  expect(hits.length).toBe(n);
});
it('generic post / batch of approval-sessions is refused before sending or journaling',async()=>{
  const n=hits.length,f=join(dir,'open.json');writeFileSync(f,JSON.stringify({projectId:'p1',admin:'tut',totp:TOTP}));
  expect((await run(['post','approval-sessions',f])).code).toBe(2);
  const b=join(dir,'batch.json');writeFileSync(b,JSON.stringify({projectId:'p1',items:[{method:'POST',path:'approval-sessions',body:{admin:'tut',totp:TOTP},idempotencyKey:'sess-open-01'}]}));
  expect((await run(['batch',b])).code).toBe(2);
  expect(hits.length).toBe(n);
  const files=existsSync(journal)?readdirSync(journal).map(x=>readFileSync(join(journal,x),'utf8')).join('\n'):'';expect(files).not.toContain(TOTP);
});
it('session reads me; session-close closes this token\'s session of the only project',async()=>{
  mode='normal';const s=await run(['session']);expect(s.code).toBe(0);expect(JSON.parse(s.out)).toEqual({approvalSession:{open:true,expiresAt:'2099-01-01T00:00:00.000Z',approvedBy:'tut'}});
  const n=hits.length,c=await run(['session-close']);expect(c.code).toBe(0);
  const sent=hits.slice(n).filter(h=>h.path==='approval-sessions/close');expect(sent).toHaveLength(1);expect(sent[0].body).toEqual({projectId:'p1'});
});
