import {afterAll,beforeAll,expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';

// Only local HTTP and fake credentials. Removing batch state aggregation, direct confirmation,
// or secret-file routing must break these end-to-end CLI tests.
const dir=mkdtempSync(join(tmpdir(),'cli-stock-batch-')),journal=join(dir,'journal');
const SECRET='fake-account-password-unique',SDK='fake-batch-sdk-secret',TOTP='987654';
const hits:{path:string;key:string;body:any}[]=[];
let server:Server,port:number,approved=false,mode='normal';
const ok=(data:unknown)=>({ok:true,data,error:null});
const refusal=(code:string,details={})=>({ok:false,data:null,error:{code,message:'fake refusal',details}});
beforeAll(async()=>{
  server=createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
    const body=raw?JSON.parse(raw):{},path=req.url!.replace('/api/ops/v1/','');
    hits.push({path,key:String(req.headers['idempotency-key']||''),body});
    const send=(status:number,data:unknown)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
    if(path.endsWith('/confirm')){
      if(mode==='locked-confirm')return send(403,refusal('APPROVAL_REJECTED',{status:'LOCKED',echo:TOTP}));
      if(mode==='expired-confirm')return send(410,refusal('APPROVAL_EXPIRED',{echo:TOTP}));
      if(mode==='bad-confirm')return send(403,refusal('FORBIDDEN',{echo:TOTP}));
      if(mode==='unclear-confirm')return send(200,ok({status:'PENDING',totp:TOTP}));
      approved=true;return send(200,ok({approvalId:'approval1',status:'APPROVED',totp:TOTP}));
    }
    if(mode==='drop'){req.socket.destroy();return;}
    if(path==='batch'){
      if(mode==='malformed-batch')return send(200,ok({items:[],summary:{ok:2,waiting:0,refused:0}}));
      if(mode==='item-unknown')return send(200,ok({items:body.items.map((it:any,index:number)=>({index,path:it.path,status:index===0?200:502,body:index===0?ok({replay:false}):{unsafe:SECRET}})),summary:{ok:1,refused:1,waiting:0}}));
      const waiting=!approved&&mode!=='partial';
      const items=body.items.map((it:any,index:number)=>({index,path:it.path,idempotencyKey:it.idempotencyKey,
        status:waiting&&index===1?202:mode==='partial'&&index===1?403:200,
        body:waiting&&index===1?refusal('APPROVAL_REQUIRED',{approvalId:'approval1'}):mode==='partial'&&index===1?refusal('FORBIDDEN'):
          ok(index===1?{credentials:{email:'fake@mail.test',password:SECRET,nested:{sms:SECRET}}}:index===2?{code:SDK}:{replay:approved})}));
      return send(waiting?202:200,ok({items,summary:{ok:waiting||mode==='partial'?1:items.length,waiting:waiting?1:0,refused:mode==='partial'?1:0},approval:{approvalId:'approval1',expiresAt:'2099-01-01T00:00:00Z'}}));
    }
    if(mode==='single-hold'&&!approved)return send(202,refusal('APPROVAL_REQUIRED',{approvalId:'single-approval',expiresAt:'2099-01-01T00:00:00Z'}));
    if(path.includes('/credentials')||path.includes('/proxy-credentials'))return send(200,ok({recorded:{configurationId:'c'},credentials:{password:SECRET},proxy:{host:'198.18.0.1',password:SECRET},unexpected:{password:SECRET}}));
    send(200,ok({replay:false}));
  });});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));port=(server.address() as any).port;
});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));rmSync(dir,{recursive:true,force:true});});
function run(args:string[],input?:string){return new Promise<{code:number;out:string;err:string}>(r=>{
  const p=execFile(process.execPath,[resolve('scripts/ops-client.mjs'),...args],{env:{...process.env,MTH_BASE:`http://127.0.0.1:${port}`,MTH_TOKEN:'mth_'+'f'.repeat(43),MTH_JOURNAL_DIR:journal,MTH_RUNTIME_DIR:join(dir,'private'),MTH_PROXY_DIR:join(dir,'proxy')}},(e,out,err)=>r({code:e?Number(e.code):0,out,err}));
  p.stdin!.end(input??'');
});}
function file(name:string,body:unknown){const f=join(dir,name+'.json');writeFileSync(f,JSON.stringify(body));return f;}
function entry(key:string){return JSON.parse(readFileSync(join(journal,'k-'+createHash('sha256').update(key).digest('hex')+'.json'),'utf8'));}
function logs(){return readdirSync(journal).map(f=>readFileSync(join(journal,f),'utf8')).join('\n');}
const batchBody=()=>({projectId:'p',items:[{method:'POST',path:'vms/v1/status',body:{expectedCycle:2,expectedRevision:3},idempotencyKey:'inner-status-01'},
  {method:'POST',path:'earnapp-accounts/a1/credentials',body:{vmId:'v1',jobId:'j1',expectedCycle:2},idempotencyKey:'inner-secret-01'}]});

it('202 success envelope keeps DONE items, approval and immutable outer/inner keys; approve confirms without journaling code and retries whole batch',async()=>{
  mode='normal';approved=false;const f=file('batch',batchBody());
  const first=await run(['batch',f]);expect(first.code).toBe(4);
  const out=JSON.parse(first.out),key=out.idempotencyKey;
  expect(out.commandState).toBe('WAITING_APPROVAL');expect(out.approvalId).toBe('approval1');
  expect(entry(key).items.map((i:any)=>i.state)).toEqual(['DONE','WAITING_APPROVAL']);
  const again=await run(['batch',f]);expect(again.code).toBe(4);expect(JSON.parse(again.out).idempotencyKey).toBe(key);
  const done=await run(['approve','approval1','--admin','owner','--totp-stdin'],TOTP+'\n');
  expect(done.code).toBe(0);expect(JSON.parse(done.out).commandState).toBe('DONE');
  const confirms=hits.filter(h=>h.path.endsWith('/confirm'));expect(confirms).toHaveLength(1);
  expect(confirms[0].key).toMatch(/^[\w-]{8,100}$/);expect(confirms[0].body).toEqual({projectId:'p',admin:'owner',totp:TOTP});
  const requests=hits.filter(h=>h.path==='batch');expect(requests).toHaveLength(3);
  expect(new Set(requests.map(h=>h.key)).size).toBe(1);expect(new Set(requests.map(h=>JSON.stringify(h.body))).size).toBe(1);
  expect(entry(key).items.map((i:any)=>i.state)).toEqual(['DONE','DONE']);
  expect(logs()+done.out+done.err).not.toContain(TOTP);expect(logs()+done.out+done.err).not.toContain(SECRET);
  const secretFile=JSON.parse(done.out).data.items[1].secretFile;
  expect(readFileSync(secretFile,'utf8')).toContain(SECRET);
});
it('final per-item refusals are PARTIAL, exit 1, including generic post batch',async()=>{
  mode='partial';const f=file('partial',batchBody());const r=await run(['post','batch',f,'--key','partial-batch-01']);
  expect(r.code).toBe(1);expect(JSON.parse(r.out).commandState).toBe('PARTIAL');
  expect(entry('partial-batch-01').items.map((i:any)=>i.state)).toEqual(['DONE','ANSWERED']);
});
it('a lost retry keeps completed item states and resends the exact original body; changed input is refused',async()=>{
  mode='normal';approved=false;const f=file('lost',batchBody());
  const first=await run(['batch',f,'--key','lost-batch-01']);expect(first.code).toBe(4);
  mode='drop';expect((await run(['retry','lost-batch-01'])).code).toBe(3);
  expect(entry('lost-batch-01').items[0].state).toBe('DONE');
  mode='normal';approved=true;expect((await run(['batch',f])).code).toBe(0);
  const n=hits.length;writeFileSync(f,JSON.stringify({...batchBody(),projectId:'changed'}));
  expect((await run(['batch',f])).code).toBe(2);expect(hits.length).toBe(n);
});
it('generic credential post and retry put the entire nested response only in a private file',async()=>{
  mode='drop';const f=file('account',{projectId:'p',vmId:'v1',jobId:'j1',expectedCycle:2});
  expect((await run(['post','earnapp-accounts/a1/credentials',f,'--key','account-secret-01'])).code).toBe(3);
  mode='normal';const r=await run(['retry','account-secret-01']);expect(r.code).toBe(0);
  const out=JSON.parse(r.out);expect(readFileSync(out.secretFile,'utf8')).toContain(SECRET);
  expect(logs()+r.out+r.err).not.toContain(SECRET);
  if(process.platform!=='win32')expect(statSync(out.secretFile).mode&0o777).toBe(0o600);
  const proxy=await run(['post','vms/v1/proxy-credentials',f,'--key','proxy-secret-01']);
  expect(proxy.code).toBe(0);expect(proxy.out+proxy.err).not.toContain(SECRET);
});
it('batch SDK reveal is file-only even when deeply nested credential data accompanies it',async()=>{
  approved=true;const b=batchBody();b.items.push({method:'POST',path:'sdks/s1/reveal',body:{} as any,idempotencyKey:'inner-reveal-01'});
  const r=await run(['batch',file('reveal',b)]);expect(r.code).toBe(0);
  expect(r.out+r.err+logs()).not.toContain(SDK);expect(r.out+r.err+logs()).not.toContain(SECRET);
  expect(readFileSync(JSON.parse(r.out).data.items[2].secretFile,'utf8')).toContain(SDK);
});
it('rejects generic confirmation, recursive batch and duplicate item keys before sending or journaling ADMIN code',async()=>{
  const n=hits.length,f=file('confirm',{projectId:'p',admin:'owner',totp:TOTP});
  expect((await run(['post','approvals/approval1/confirm',f])).code).toBe(2);
  for(const path of ['batch','approvals/approval1/confirm','../escape']){
    const b=batchBody();b.items[0].path=path;
    expect((await run(['batch',file('invalid',b)])).code).toBe(2);
  }
  const b=batchBody();b.items[1].idempotencyKey=b.items[0].idempotencyKey;
  expect((await run(['batch',file('duplicate',b)])).code).toBe(2);
  expect(hits.length).toBe(n);expect(logs()).not.toContain(TOTP);
});
it('failed or non-approved confirm sends once, never retries business command, and never echoes even a reflected code',async()=>{
  approved=false;mode='normal';const r=await run(['batch',file('bad-approve',batchBody()),'--key','bad-approve-01']);expect(r.code).toBe(4);
  for(const state of ['bad-confirm','unclear-confirm']){
    mode=state;const n=hits.length;
    const r=await run(['approve','approval1','--admin','owner','--totp-stdin'],TOTP+'\n');
    expect(r.code).not.toBe(0);expect(hits.length).toBe(n+1);expect(r.out+r.err+logs()).not.toContain(TOTP);
  }
  const n=hits.length;expect((await run(['approve','approval1','--admin','owner'],TOTP+'\n')).code).toBe(2);expect(hits.length).toBe(n);
});
it('LOCKED and expired confirmation settle the local approval and explicitly require a new key',async()=>{
  // Finish the earlier pending approval before creating another (real approval IDs are unique).
  mode='normal';approved=true;await run(['retry','bad-approve-01']);
  for(const [state,expected] of [['locked-confirm','REJECTED'],['expired-confirm','EXPIRED']]){
    mode='normal';approved=false;const key=state+'-01';
    expect((await run(['batch',file(state,batchBody()),'--key',key])).code).toBe(4);
    mode=state;const n=hits.length,r=await run(['approve','approval1','--admin','owner','--totp-stdin'],TOTP+'\n');
    expect(r.code).toBe(1);expect(hits.length).toBe(n+1);expect(entry(key).state).toBe(expected);
    expect(r.out).toMatch(/key MỚI/);expect(r.out+r.err+logs()).not.toContain(TOTP);
    expect(entry(key).items[0].state).toBe('DONE');
  }
});
it('missing/non-string inner keys and malformed result lists never become a successful batch',async()=>{
  for(const key of [undefined,12345678]){
    const b=batchBody();(b.items[0] as any).idempotencyKey=key;const n=hits.length;
    expect((await run(['batch',file('missing-key',b)])).code).toBe(2);expect(hits.length).toBe(n);
  }
  mode='normal';approved=false;const f=file('malformed',batchBody());
  expect((await run(['batch',f,'--key','malformed-batch-01'])).code).toBe(4);
  mode='malformed-batch';const r=await run(['retry','malformed-batch-01']);
  expect(r.code).toBe(3);expect(entry('malformed-batch-01').items[0].state).toBe('DONE');
});
it('per-item 5xx retains successful siblings and hides untrusted secret results while the batch remains UNKNOWN',async()=>{
  mode='item-unknown';const r=await run(['batch',file('item-unknown',batchBody()),'--key','item-unknown-01']);
  expect(r.code).toBe(3);expect(entry('item-unknown-01').items.map((i:any)=>i.state)).toEqual(['DONE','UNKNOWN']);
  expect(r.out+r.err+logs()).not.toContain(SECRET);
});
it('single credential command approval retries its corresponding key and preserves all nested secrets in the private file',async()=>{
  mode='single-hold';approved=false;const f=file('single-credential',{projectId:'p',vmId:'v1',jobId:'j1',expectedCycle:2});
  expect((await run(['post','earnapp-accounts/a1/credentials',f,'--key','single-account-01'])).code).toBe(4);
  const n=hits.length,r=await run(['approve','single-approval','--admin','owner','--totp-stdin'],TOTP+'\n');
  expect(r.code).toBe(0);expect(hits.length).toBe(n+2);expect(hits.at(-1)!.key).toBe('single-account-01');
  const out=JSON.parse(r.out);expect(readFileSync(out.secretFile,'utf8')).toContain(SECRET);
  expect(logs()+r.out+r.err).not.toContain(SECRET);expect(logs()+r.out+r.err).not.toContain(TOTP);
});
