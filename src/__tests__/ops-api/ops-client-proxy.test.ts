import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {execFile} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
// scripts/ops-client.mjs `proxy` (21/10/2026): the full proxy of the VM in hand goes to a private file for AE Mini Tool only — never to
// stdout, the command log or a retry's output. Fake server, fake token / PIN / proxy.
const SCRIPT=resolve('scripts/ops-client.mjs'),TOKEN='mth_'+'p'.repeat(43),PIN='000111',SECRET='fake-proxy-pass-9f3';
const dir=mkdtempSync(join(tmpdir(),'ops-client-proxy-'));let server:Server,port=0,drop=true;
beforeAll(async()=>{
  server=createServer((req,res)=>{req.resume();req.on('end',()=>{
    if(drop){drop=false;res.statusCode=502;res.end('<html>gateway</html>');return;} // first answer lost: the retry must still hide the proxy
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ok:true,data:{replay:false,recorded:{vmId:'vm1',cycle:1,configurationId:'cfg1',endpointId:'ep1'},proxy:{host:'198.18.0.9',port:8080,username:'fake-user',password:SECRET}},error:null}));
  });});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',()=>r()));port=(server.address() as {port:number}).port;
});
afterAll(()=>new Promise<void>(r=>{server.close(()=>r());rmSync(dir,{recursive:true,force:true});}));
const run=(args:string[])=>new Promise<{code:number;out:string;err:string}>(r=>execFile(process.execPath,[SCRIPT,...args],{env:{...process.env,MTH_BASE:'http://127.0.0.1:'+port,MTH_TOKEN:TOKEN,MTH_PIN:PIN,MTH_JOURNAL_DIR:join(dir,'journal'),MTH_PROXY_DIR:join(dir,'proxy')}},(e,out,err)=>r({code:e?Number((e as {code?:number}).code??1):0,out,err})));
describe('ops-client proxy',()=>{
  it('writes the proxy only to the private file, also when it arrives on a retry; stdout and the command log never hold it',async()=>{
    const first=await run(['proxy','proj1','vm1','job1','1','--key','proxy-key-0001']);
    expect(first.code).toBe(3);expect(first.out+first.err).not.toContain(SECRET);
    const again=await run(['retry','proxy-key-0001']);
    expect(again.code).toBe(0);expect(again.out+again.err).not.toContain(SECRET);expect(again.out).not.toContain('fake-user');
    const out=JSON.parse(again.out);expect(out.proxyFile).toBe(join(dir,'proxy','vm1.json'));expect(out.data.proxy).toMatch(/đã ghi vào file/);
    expect(JSON.parse(readFileSync(out.proxyFile,'utf8'))).toEqual({vmId:'vm1',configurationId:'cfg1',host:'198.18.0.9',port:8080,username:'fake-user',password:SECRET});
    for(const f of readdirSync(join(dir,'journal')))expect(readFileSync(join(dir,'journal',f),'utf8')).not.toContain(SECRET);
    expect(existsSync(join(dir,'proxy','vm1.json.tmp-'+process.pid))).toBe(false);
  });
});
