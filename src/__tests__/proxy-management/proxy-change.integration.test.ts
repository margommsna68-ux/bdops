import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {businessDB as db,businessFixture} from './business-fixture';
import {changeVmProxy,checkVmProxyChange} from '@/server/vm-management/proxy-command';
import {setVmStatus} from '@/server/vm-ops/ops';
import {createProxyBatchService} from '@/server/proxy-management/batches';
import {persistSourceSnapshot} from '@/server/proxy-management/sources';
import {copyProxyRows} from '@/server/proxy-management/history';
import {previewVmBulk,applyVmBulk} from '@/server/vm-management/bulk';
import {undoOperation} from '@/server/operation-history/undo';
import {readVMWorkspace} from '@/server/vm-management/repository';
import type {VmOpsStatus} from '@prisma/client';
afterAll(()=>db.$disconnect());
// Owner decision 19/10/2026: assigning a proxy is recording the proxy the VM uses (no install step); the proxy can be changed from
// the VM cell or from Kho proxy with the same rules; a VM Blocked by its proxy goes back to its status before Blocked when the proxy
// is replaced. Synthetic data only (203.0.113.x / 198.18.x test IPs), test database only.
const octet=()=>1+Math.floor(Math.random()*250);
async function setup(){
  const f=await businessFixture(),projectId=f.scope.projectId,net='100.64.'+octet()+'.';
  await db.project.update({where:{id:projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
  await db.proxyProviderAccount.create({data:{projectId,code:'pkg',label:'pkg',credentialCipher:encrypt(JSON.stringify({username:'u',password:'p'}))}});
  const vms=[f.vm];for(let i=2;i<=3;i++)vms.push(await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_00'+i,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}}));
  let n=0;
  const proxy=async(port=8080,ip=net+(++n))=>{const identity=await db.proxyIdentity.upsert({where:{ip},update:{},create:{ip,owner:'SELF'}});
    return db.proxyIP.create({data:{projectId,identityId:identity.id,address:ip+':'+port,host:ip,port,credentialCipher:encrypt(JSON.stringify({username:'u',password:'p'})),packageCode:'pkg',inventoryState:'NEW',inventoryKey:identity.allocationMode==='APPROVED_PORT_STREAM'?identity.id+':'+port:identity.id}});};
  const vm=(i:number)=>db.virtualMachine.findUniqueOrThrow({where:{id:vms[i].id},include:{operation:true}});
  const change=async(i:number,endpointId:string,key=randomUUID(),scope=f.scope)=>{const v=await vm(i);return changeVmProxy(scope,{key,vmId:v.id,expectedVmRevision:v.revision,expectedCycle:v.operation?.cycle??1,endpointId},db);};
  const status=async(i:number,s:VmOpsStatus)=>{const v=await vm(i);return setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:v.id,status:s,expectedCycle:v.operation?.cycle??1}]},db);};
  const ops=async(i:number)=>(await db.vmOperation.findUnique({where:{vmId:vms[i].id}}));
  const state=async(id:string)=>(await db.proxyIP.findUniqueOrThrow({where:{id}})).inventoryState;
  const current=async(i:number)=>{const ws=await readVMWorkspace(f.scope,db);return ws.vms.find(v=>v.id===vms[i].id)!;};
  const service=createProxyBatchService(db,{refreshSource:async()=>persistSourceSnapshot(projectId,{id:randomUUID(),sourceKey:'GENJY',hash:'proxy-change',fetchedAt:new Date().toISOString(),scanSucceeded:true,evidence:[]},db)});
  const batch=async(input:Record<string,unknown>)=>{const key=randomUUID(),p=await service.preview(f.scope,{...input,idempotencyKey:key} as never);return {preview:p,result:p.ready?await service.commit(f.scope,p.token,key):null};};
  const cleanup=async()=>{
    await db.vMTask.deleteMany({where:{vm:{server:{projectId}}}});await db.vMProxyAllocation.deleteMany({where:{projectId}});await db.virtualMachine.updateMany({where:{server:{projectId}},data:{proxyId:null,desiredConfigurationId:null,installedConfigurationId:null}});
    await db.vMConfiguration.deleteMany({where:{projectId}});await db.operationJournal.deleteMany({where:{projectId}});await db.proxyReplacement.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});
    const ids=(await db.proxyIP.findMany({where:{projectId},select:{identityId:true}})).map(p=>p.identityId!).filter(Boolean);await db.proxyIP.deleteMany({where:{projectId}});await db.proxyIdentity.deleteMany({where:{id:{in:ids}}});await db.proxyProviderAccount.deleteMany({where:{projectId}});await f.cleanup();};
  return {...f,net,vms,proxy,vm,change,status,ops,state,current,batch,cleanup};
}
describe('Gán proxy là xong, thay proxy tại VM',()=>{
  it('assigning records the current proxy at once: LIVE, no install task or event; the same proxy again writes nothing; Dán bảng too',async()=>{
    const f=await setup();try{
      const a=await f.proxy(),b=await f.proxy();
      const check=await checkVmProxyChange(f.scope,{vmId:f.vms[0].id,text:a.host+':'+a.port},db);expect(check).toMatchObject({outcome:'READY',endpointId:a.id});
      expect(await f.change(0,a.id)).toMatchObject({changed:true});
      expect(await f.state(a.id)).toBe('LIVE');expect(await db.vMTask.count({where:{vmId:f.vms[0].id}})).toBe(0);
      expect(await db.proxyStatusEvent.count({where:{endpointId:a.id,kind:{in:['INSTALL_STARTED','INSTALLED']}}})).toBe(0);
      const ws=await f.current(0);expect(ws.desired?.ip).toBe(a.host);
      const journals=await db.operationJournal.count({where:{projectId:f.scope.projectId}});
      expect(await checkVmProxyChange(f.scope,{vmId:f.vms[0].id,endpointId:a.id},db)).toMatchObject({outcome:'SKIP'});
      expect(await f.change(0,a.id)).toMatchObject({changed:false});expect(await db.operationJournal.count({where:{projectId:f.scope.projectId}})).toBe(journals);
      // Dán bảng onto an empty VM goes through the same core: current at once, no task.
      const p=await previewVmBulk(f.scope,{kind:'PROXY',serverId:f.server.id,text:`${f.vms[1].code} | ${b.host}`},db),row=p.rows[0];
      await applyVmBulk(f.scope,{kind:'PROXY',key:randomUUID(),items:[{line:row.line,vmId:row.vmId!,expectedRevision:row.expectedRevision!,value:row.value}]},db);
      expect(await f.state(b.id)).toBe('LIVE');expect(await db.vMTask.count({where:{vmId:f.vms[1].id}})).toBe(0);
      // A proxy used by another VM is never taken silently.
      expect(await checkVmProxyChange(f.scope,{vmId:f.vms[0].id,endpointId:b.id},db)).toMatchObject({outcome:'ERROR',message:expect.stringMatching(/đang dùng ở/)});
      await expect(f.change(0,b.id)).rejects.toMatchObject({code:'INVALID_INPUT'});
    }finally{await f.cleanup();}
  });
  it('two people changing the same VM: the second (old revision) is refused; a retry with the same key replays without a second change',async()=>{
    const f=await setup();try{
      const a=await f.proxy(),b=await f.proxy(),c=await f.proxy();await f.change(0,a.id);
      const v=await f.vm(0),key=randomUUID(),input={vmId:v.id,expectedVmRevision:v.revision,expectedCycle:1};
      const first=await changeVmProxy(f.scope,{...input,key,endpointId:b.id},db),again=await changeVmProxy(f.scope,{...input,key,endpointId:b.id},db);
      expect(first.changed).toBe(true);expect(again).toMatchObject({changed:true,replay:true});
      await expect(changeVmProxy(f.worker,{...input,key:randomUUID(),endpointId:c.id},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      expect(await db.vMProxyAllocation.count({where:{vmId:v.id,releasedAt:null}})).toBe(1);
      expect([await f.state(a.id),await f.state(b.id),await f.state(c.id)]).toEqual(['NEW','LIVE','NEW']);
    }finally{await f.cleanup();}
  });
});
describe('Blocked và khôi phục tình trạng VM',()=>{
  it('OK → Blocked (Kho proxy) → change to a stock proxy → OK; the old proxy stays BLOCKED and still copies for the provider',async()=>{
    const f=await setup();try{
      const a=await f.proxy(),spare=await f.proxy();await f.change(0,a.id);await f.status(0,'OK');
      await f.batch({kind:'BLOCKED',text:a.host});
      expect(await f.state(a.id)).toBe('BLOCKED');expect(await f.ops(0)).toMatchObject({status:'PROXY_BLOCKED',blockedFrom:'OK',blockedEndpointId:a.id,blockedCycle:1});
      // A repeated report (at the VM this time) never overwrites the first mark.
      expect((await f.status(0,'PROXY_BLOCKED')).rows[0].outcome).toBe('SKIP');expect((await f.ops(0))?.blockedFrom).toBe('OK');
      const check=await checkVmProxyChange(f.scope,{vmId:f.vms[0].id,endpointId:spare.id},db);expect(check).toMatchObject({outcome:'READY',restore:'OK'});
      await f.change(0,spare.id);
      expect(await f.ops(0)).toMatchObject({status:'OK',blockedEndpointId:null});expect(await f.state(a.id)).toBe('BLOCKED');expect(await f.state(spare.id)).toBe('LIVE');
      const copy=await copyProxyRows(f.scope,{endpointIds:[a.id,spare.id,a.id]},db,{onlyBlocked:true});expect(copy.proxies).toEqual([`${a.host}:${a.port}:u:p`]);
      const history=await db.vmOpsEvent.findMany({where:{vmId:f.vms[0].id},orderBy:{createdAt:'asc'}});expect(history.map(h=>[h.fromStatus,h.toStatus])).toEqual([[null,'OK'],['OK','PROXY_BLOCKED'],['PROXY_BLOCKED','OK']]);
    }finally{await f.cleanup();}
  });
  it('Chưa ghi / Chưa nối / LINKED come back as they were; Blocked chosen at the VM blocks the proxy in Kho proxy too',async()=>{
    const f=await setup();try{
      const cases:(VmOpsStatus|null)[]=[null,'NOT_LINKED','LINKED'];
      for(let i=0;i<3;i++){
        const a=await f.proxy(),spare=await f.proxy();await f.change(i,a.id);if(cases[i])await f.status(i,cases[i]!);
        const r=await f.status(i,'PROXY_BLOCKED');expect(r.rows[0].outcome).toBe('APPLIED');expect(await f.state(a.id)).toBe('BLOCKED');
        await f.change(i,spare.id);expect((await f.ops(i))?.status??null).toBe(cases[i]);
      }
    }finally{await f.cleanup();}
  });
  it('a newer status chosen while waiting is kept; SUS is never overwritten by Blocked; a new round never uses the old round mark',async()=>{
    const f=await setup();try{
      const a=await f.proxy(),b=await f.proxy(),c=await f.proxy(),d=await f.proxy(),e=await f.proxy();
      await f.change(0,a.id);await f.status(0,'LINKED');await f.batch({kind:'BLOCKED',text:a.host});await f.status(0,'OFF');
      await f.change(0,b.id);expect((await f.ops(0))?.status).toBe('OFF');
      await f.change(1,c.id);await f.status(1,'SUSPENDED');await f.batch({kind:'BLOCKED',text:c.host});
      expect((await f.ops(1))?.status).toBe('SUSPENDED');expect((await f.current(1)).holds[0].state).toBe('BLOCKED');
      // A mark left from round 1 on a VM now in round 2 (recreation clears it; this covers older rows): never used for round 2.
      await f.change(2,d.id);await f.status(2,'OK');await f.batch({kind:'BLOCKED',text:d.host});
      const o=await f.ops(2);await db.vmOperation.update({where:{id:o!.id},data:{cycle:2}});
      await f.change(2,e.id);expect(await f.ops(2)).toMatchObject({status:'PROXY_BLOCKED',blockedEndpointId:null});
    }finally{await f.cleanup();}
  });
  it('a provider replacement in Kho proxy changes the VM in the same save, restores its status, leaves the Blocked list; undo puts everything back',async()=>{
    const f=await setup();try{
      const a=await f.proxy(),b=await f.proxy();await f.change(0,a.id);await f.change(1,b.id);await f.status(0,'LINKED');await f.status(1,'OK');
      await f.batch({kind:'BLOCKED',text:[a.host,b.host].join('\n')});
      const n1=f.net+'201',n2=f.net+'202';
      // Line N old ↔ line N new; a bare new IP inherits port/user/pass of its own old proxy.
      const {preview,result}=await f.batch({kind:'REPLACE',removedText:`${a.host}\n${b.host}`,addedText:`${n1}\n${n2}`});
      expect(preview.rows.map(r=>[r.oldIp,r.newIp,r.outcome])).toEqual([[a.host,n1,'READY'],[b.host,n2,'READY']]);expect(result?.applied).toBe(2);
      const [na,nb]=await Promise.all([n1,n2].map(ip=>db.proxyIP.findFirstOrThrow({where:{projectId:f.scope.projectId,host:ip}})));
      expect([await f.state(a.id),na.inventoryState,nb.inventoryState]).toEqual(['REPLACED','LIVE','LIVE']);expect(na.port).toBe(a.port);
      expect((await f.current(0)).desired?.ip).toBe(n1);expect((await f.current(1)).desired?.ip).toBe(n2);
      expect([(await f.ops(0))?.status,(await f.ops(1))?.status]).toEqual(['LINKED','OK']);
      expect((await copyProxyRows(f.scope,{endpointIds:[a.id,b.id]},db,{onlyBlocked:true})).proxies).toEqual([]);
      const op=await db.operationJournal.findFirstOrThrow({where:{projectId:f.scope.projectId,kind:'REPLACE'}});
      await undoOperation(f.scope,op.id,'',db);
      expect(await f.state(a.id)).toBe('BLOCKED');expect((await f.current(0)).desired?.ip).toBe(a.host);expect((await f.ops(0))?.status).toBe('PROXY_BLOCKED');
    }finally{await f.cleanup();}
  });
});
describe('Copy proxy Blocked',()=>{
  it('selection or whole filter (all pages), each endpoint once, display order, full IP:port:user:pass; port-stream ports are separate; history is never copied',async()=>{
    const f=await setup();try{
      const ip=f.net+'50',stream=await db.proxyIdentity.create({data:{ip,owner:'SELF',allocationMode:'APPROVED_PORT_STREAM'}});
      const p1=await f.proxy(10001,ip),p2=await f.proxy(10002,ip),other=await f.proxy(),good=await f.proxy();
      await db.proxyIP.updateMany({where:{id:{in:[p1.id,p2.id,other.id]}},data:{inventoryState:'BLOCKED',status:'BLOCKED'}});
      const old=await f.proxy();await db.proxyIP.update({where:{id:old.id},data:{inventoryState:'REPLACED',retiredAt:new Date()}});
      expect(stream.allocationMode).toBe('APPROVED_PORT_STREAM');
      const chosen=await copyProxyRows(f.scope,{endpointIds:[other.id,p2.id,good.id,old.id]},db,{onlyBlocked:true});
      expect(chosen).toMatchObject({copied:2,proxies:[`${other.host}:${other.port}:u:p`,`${ip}:10002:u:p`]});
      const all=await copyProxyRows(f.scope,{filter:{projectId:f.scope.projectId,limit:100,state:'BLOCKED'} as never},db,{onlyBlocked:true});
      expect(all.copied).toBe(3);expect(new Set(all.proxies).size).toBe(3);expect(all.proxies.every(p=>/^\d+\.\d+\.\d+\.\d+:\d+:u:p$/.test(p))).toBe(true);
      const log=await db.auditLog.findFirstOrThrow({where:{projectId:f.scope.projectId,entityId:'blocked-copy'},orderBy:{createdAt:'desc'}});expect(JSON.stringify(log.changes)).not.toMatch(/:u:p|"p"/);
    }finally{await f.cleanup();}
  });
});
