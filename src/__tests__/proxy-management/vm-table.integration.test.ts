import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {previewVmBulk,applyVmBulk} from '@/server/vm-management/bulk';
import {copyVmConfigurations,startInstall,reportInstallFailure,confirmInstalled} from '@/server/vm-management/installation';
import {archiveManagedResource,updateManagedVM} from '@/server/vm-management/metadata';
import {createVMService} from '@/server/vm-management/allocation';
import type {ActorScope} from '@/server/proxy-management/types';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
// Fixture: moonA VM_001..VM_006, moonB VM_001; proxies TUT ×2, Chung mooon–Genjy ×1, Genjy riêng ×1 (all NEW, full credentials); Gmail g1, g2.
async function fixture(){
  const projectId=randomUUID(),userId=randomUUID(),identities:string[]=[],tag=projectId.slice(0,8);
  await db.project.create({data:{id:projectId,code:projectId,name:'VM table fixture',settings:{businessMode:'PROXY_VM'}}});await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});
  await db.projectMember.create({data:{projectId,userId,role:'ADMIN',allowedModules:['INFRASTRUCTURE'],capabilities:['PROXY_IMPORT','COPY_CREDENTIALS']}});
  const a=await db.server.create({data:{projectId,code:'moonA',managed:true}}),b=await db.server.create({data:{projectId,code:'moonB',managed:true}});
  const vm=(serverId:string,code:string)=>db.virtualMachine.create({data:{serverId,code,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}});
  const v:Record<string,Awaited<ReturnType<typeof vm>>>={};for(const c of ['VM_001','VM_002','VM_003','VM_004','VM_005','VM_006']) v[c]=await vm(a.id,c);const b1=await vm(b.id,'VM_001');
  const net='203.4.'+(1+Math.floor(Math.random()*250))+'.';
  const proxy=async(n:number,owner:'SELF'|'GENJY',subgroup:'PC_CHUNG'|null)=>{const ip=net+n,identity=await db.proxyIdentity.create({data:{ip,owner,subgroup,ownerDecidedAt:owner==='GENJY'?new Date():null}});identities.push(identity.id);return db.proxyIP.create({data:{projectId,identityId:identity.id,address:ip+':8080',host:ip,port:8080,credentialCipher:encrypt(JSON.stringify({username:'u'+n,password:'p'+n})),packageCode:'pkg',inventoryState:'NEW',inventoryKey:identity.id}});};
  const tut1=await proxy(1,'SELF',null),tut2=await proxy(2,'SELF',null),shared=await proxy(3,'GENJY','PC_CHUNG'),genjy=await proxy(4,'GENJY',null);
  const g1=await db.gmailAccount.create({data:{email:'g1-'+tag+'@fixture.invalid',projectId,businessManaged:true}}),g2=await db.gmailAccount.create({data:{email:'g2-'+tag+'@fixture.invalid',projectId,businessManaged:true}});
  const snapshot=await db.proxySourceSnapshot.create({data:{projectId,sourceKey:'GENJY',hash:'vm-table',scanSucceeded:true}});
  const scope:ActorScope={projectId,userId,role:'ADMIN',capabilities:['PROXY_IMPORT','COPY_CREDENTIALS']};
  const service=createVMService(db,{refreshSource:async()=>({id:snapshot.id,sourceKey:'GENJY',hash:'vm-table',fetchedAt:new Date().toISOString(),scanSucceeded:true})});
  const cleanup=async()=>{await db.vMTask.deleteMany({where:{vm:{server:{projectId}}}});await db.vMProxyAllocation.deleteMany({where:{projectId}});await db.virtualMachine.updateMany({where:{server:{projectId}},data:{proxyId:null,desiredConfigurationId:null,installedConfigurationId:null,gmailId:null}});await db.vMConfiguration.deleteMany({where:{projectId}});await db.vMSdkHistory.deleteMany({where:{projectId}});await db.virtualMachine.deleteMany({where:{server:{projectId}}});await db.server.deleteMany({where:{projectId}});await db.gmailAccount.deleteMany({where:{projectId}});await db.auditLog.deleteMany({where:{projectId}});await db.operationJournal.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});await db.proxyIP.deleteMany({where:{projectId}});await db.proxyIdentity.deleteMany({where:{id:{in:identities}}});await db.projectMember.deleteMany({where:{projectId}});await db.project.deleteMany({where:{id:projectId}});await db.user.deleteMany({where:{id:userId}});};
  return {projectId,userId,scope,a,b,v,b1,net,tut1,tut2,shared,genjy,g1,g2,service,cleanup};
}
const ready=(rows:{outcome:string;vmId:string|null;expectedRevision:number|null;value:string|null;line:number}[])=>rows.filter(r=>r.outcome==='READY').map(r=>({line:r.line,vmId:r.vmId!,expectedRevision:r.expectedRevision!,value:r.value}));
describe('Dán bảng (Server/VM paste table)',()=>{
  it('SDK: matches by server + VM code, reports repeated VM keys and SDKs, keeps blanks; apply re-checks every row and a retry writes nothing twice',async()=>{
    const f=await fixture();try{
      const text=['moonB\tVM_001\tsdk-BBBB2222','moonA\tVM_001\tsdk-CCCC3333','moonA\tVM_003\t','moonA\tVM_004\tsdk-DUPL0001','moonA\tVM_005\tsdk-DUPL0001','moonA\tVM_006\tsdk-EEEE5555','moonA\tVM_006\tsdk-FFFF6666','moonA\tVM_999\tsdk-GGGG7777','moonA\tVM_002\tbad sdk!'].join('\n');
      const p=await previewVmBulk(f.scope,{kind:'SDK',text},db);const at=(line:number)=>p.rows.find(r=>r.line===line)!;
      expect(at(1)).toMatchObject({outcome:'READY',vmId:f.b1.id,after:'sdk-BBBB2222'});expect(at(2)).toMatchObject({outcome:'READY',vmId:f.v.VM_001.id});
      expect(at(3).outcome).toBe('SKIP');expect(at(4).outcome).toBe('ERROR');expect(at(5).outcome).toBe('ERROR');
      expect(at(6)).toMatchObject({outcome:'ERROR'});expect(at(6).message).toContain('dòng 7');expect(at(7).outcome).toBe('ERROR');
      expect(at(8).outcome).toBe('ERROR');expect(at(9).outcome).toBe('ERROR');
      // moonA/VM_001 changes after the preview: that row is refused and reported, the other row is saved.
      await updateManagedVM(f.scope,f.v.VM_001.id,{notes:'đổi sau xem trước',expectedRevision:f.v.VM_001.revision},db);
      const r=await applyVmBulk(f.scope,{kind:'SDK',key:randomUUID(),items:ready(p.rows)},db);
      expect(r.applied).toBe(1);expect(r.rows.find(x=>x.line===2)).toMatchObject({outcome:'ERROR'});expect(r.rows.find(x=>x.line===1)?.outcome).toBe('APPLIED');
      expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.b1.id}})).sdkId).toBe('sdk-BBBB2222');expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.v.VM_001.id}})).sdkId).toBeNull();
      // Retry the same paste: the saved row is now "giữ nguyên", the refused row is ready again; no second history entry.
      const again=await previewVmBulk(f.scope,{kind:'SDK',text:'moonB\tVM_001\tsdk-BBBB2222\nmoonA\tVM_001\tsdk-CCCC3333'},db);
      expect(again.rows.map(x=>x.outcome)).toEqual(['SKIP','READY']);
      await applyVmBulk(f.scope,{kind:'SDK',key:randomUUID(),items:ready(again.rows)},db);
      expect(await db.vMSdkHistory.count({where:{vmId:f.b1.id}})).toBe(1);expect(await db.vMSdkHistory.count({where:{vmId:f.v.VM_001.id}})).toBe(1);
      // "-" clears explicitly; a blank cell never does.
      const clear=await previewVmBulk(f.scope,{kind:'SDK',serverId:f.b.id,text:'VM_001\t-'},db);expect(clear.rows[0]).toMatchObject({outcome:'READY',value:null});
      await applyVmBulk(f.scope,{kind:'SDK',key:randomUUID(),items:ready(clear.rows)},db);expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.b1.id}})).sdkId).toBeNull();
    }finally{await f.cleanup();}
  });
  it('NOTE: long notes for selected VMs, same value writes nothing; GMAIL: one existing Gmail on many VMs, unknown Gmail is never created',async()=>{
    const f=await fixture();try{
      const long='Ghi chú dài '.repeat(40).trim();
      const p=await previewVmBulk(f.scope,{kind:'NOTE',items:[{vmId:f.v.VM_001.id,value:long},{vmId:f.v.VM_002.id,value:long}]},db);expect(p.ready).toBe(2);
      const r=await applyVmBulk(f.scope,{kind:'NOTE',key:randomUUID(),items:ready(p.rows)},db);expect(r.applied).toBe(2);
      expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.v.VM_002.id}})).notes).toBe(long);
      expect((await previewVmBulk(f.scope,{kind:'NOTE',items:[{vmId:f.v.VM_001.id,value:long}]},db)).rows[0].outcome).toBe('SKIP');
      await db.virtualMachine.update({where:{id:f.v.VM_004.id},data:{gmailId:f.g1.id}});
      const g=await previewVmBulk(f.scope,{kind:'GMAIL',serverId:f.a.id,text:`VM_001 | ${f.g1.email}\nVM_002 | ${f.g1.email.toUpperCase()}\nVM_003 | nobody@fixture.invalid`},db);
      expect(g.rows.map(x=>x.outcome)).toEqual(['READY','READY','ERROR']);
      await applyVmBulk(f.scope,{kind:'GMAIL',key:randomUUID(),items:ready(g.rows)},db);
      const bound=await db.virtualMachine.findMany({where:{gmailId:f.g1.id},select:{code:true}});expect(bound.map(x=>x.code).sort()).toEqual(['VM_001','VM_002','VM_004']);
      expect(await db.gmailAccount.count({where:{projectId:f.projectId}})).toBe(2);
    }finally{await f.cleanup();}
  });
  it('PROXY: TUT and Chung mooon–Genjy go onto empty VMs by hand; Genjy riêng, occupied VMs and proxies held elsewhere are refused',async()=>{
    const f=await fixture();try{
      const p=await previewVmBulk(f.scope,{kind:'PROXY',serverId:f.a.id,text:`VM_001 | ${f.net}1:8080\nVM_002 | ${f.net}3:8080:u3:p3\nVM_003 | ${f.net}4`},db);
      expect(p.rows.map(x=>x.outcome)).toEqual(['READY','READY','ERROR']);
      const r=await applyVmBulk(f.scope,{kind:'PROXY',key:randomUUID(),items:ready(p.rows)},db);expect(r.applied).toBe(2);
      const held=await db.vMProxyAllocation.findMany({where:{projectId:f.projectId,releasedAt:null},select:{vmId:true,endpointId:true,role:true}});
      expect(held).toEqual(expect.arrayContaining([{vmId:f.v.VM_001.id,endpointId:f.tut1.id,role:'DESIRED'},{vmId:f.v.VM_002.id,endpointId:f.shared.id,role:'DESIRED'}]));
      expect((await db.proxyIP.findUniqueOrThrow({where:{id:f.shared.id}})).inventoryState).toBe('LIVE');
      expect((await previewVmBulk(f.scope,{kind:'PROXY',serverId:f.a.id,text:`VM_001 | ${f.net}1`},db)).rows[0].outcome).toBe('SKIP');
      const again=await previewVmBulk(f.scope,{kind:'PROXY',serverId:f.a.id,text:`VM_004 | ${f.net}1\nVM_003 | ${f.net}2\nVM_005 | ${f.net}2`},db);
      expect(again.rows[0].message).toContain('moonA/VM_001');expect(again.rows[1].message).toContain('dòng 3');
      expect(again.rows.map(x=>x.outcome)).toEqual(['ERROR','ERROR','ERROR']);
      const occupied=await previewVmBulk(f.scope,{kind:'PROXY',serverId:f.a.id,text:`VM_002 | ${f.net}2`},db);expect(occupied.rows[0].message).toContain(f.net+'3');
    }finally{await f.cleanup();}
  });
});
describe('Autofill only on the selected VMs',()=>{
  it('needs vmIds, fills only those VMs with unused TUT NEW, never Chung or Genjy riêng',async()=>{
    const f=await fixture();try{
      await expect(f.service.preview(f.scope,{mode:'AUTO',serverId:f.a.id,idempotencyKey:randomUUID()})).rejects.toMatchObject({code:'INVALID_INPUT'});
      const p=await f.service.preview(f.scope,{mode:'AUTO',vmIds:[f.v.VM_005.id,f.v.VM_006.id,f.v.VM_004.id],idempotencyKey:randomUUID()});
      expect(p.rows.map(r=>r.vm)).toEqual(['VM_004','VM_005','VM_006']);
      expect(p.rows.filter(r=>r.outcome==='READY').map(r=>r.ip).sort()).toEqual([f.net+'1',f.net+'2']);
      expect(p.rows.filter(r=>r.outcome==='ERROR')).toHaveLength(1);
    }finally{await f.cleanup();}
  });
  it('manual change of proxy accepts Chung mooon–Genjy through preview and commit',async()=>{
    const f=await fixture();try{
      const key=randomUUID(),p=await f.service.preview(f.scope,{mode:'MANUAL',vmIds:[f.v.VM_001.id],endpointId:f.shared.id,idempotencyKey:key});expect(p.ready).toBe(1);
      await f.service.commit(f.scope,p.token,key);
      expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.v.VM_001.id},include:{desiredConfiguration:true}})).desiredConfiguration?.endpointId).toBe(f.shared.id);
      const genjy=await f.service.preview(f.scope,{mode:'MANUAL',vmIds:[f.v.VM_002.id],endpointId:f.genjy.id,idempotencyKey:randomUUID()});expect(genjy.errors).toBe(1);
    }finally{await f.cleanup();}
  });
});
describe('Copy and delete',()=>{
  it('plain copy returns the assigned or installed snapshot in order and never starts the install; Copy để cài still does',async()=>{
    const f=await fixture();try{
      const p=await previewVmBulk(f.scope,{kind:'PROXY',serverId:f.a.id,text:`VM_002 | ${f.net}1\nVM_001 | ${f.net}2`},db);await applyVmBulk(f.scope,{kind:'PROXY',key:randomUUID(),items:ready(p.rows)},db);
      const c=await copyVmConfigurations(f.scope,{vmIds:[f.v.VM_001.id,f.v.VM_002.id,f.v.VM_003.id],which:'DESIRED'},db);
      expect(c.items.map(i=>i.proxy)).toEqual([f.net+'2:8080:u2:p2',f.net+'1:8080:u1:p1']);expect(c.skipped).toEqual([expect.objectContaining({vmId:f.v.VM_003.id})]);
      const configs=await db.vMConfiguration.findMany({where:{projectId:f.projectId},include:{task:true}});
      expect(configs.every(x=>x.status==='PLANNED'&&!x.startedAt&&x.task?.status==='PENDING')).toBe(true);
      expect((await copyVmConfigurations(f.scope,{vmIds:[f.v.VM_001.id],which:'INSTALLED'},db)).skipped).toHaveLength(1);
      await startInstall(f.scope,configs.find(x=>x.vmId===f.v.VM_001.id)!.id,db);
      expect((await db.vMConfiguration.findFirstOrThrow({where:{vmId:f.v.VM_001.id}})).startedAt).not.toBeNull();
    }finally{await f.cleanup();}
  });
  it('the old archive API uses the same delete checks',async()=>{
    const f=await fixture();try{
      const p=await previewVmBulk(f.scope,{kind:'PROXY',serverId:f.a.id,text:`VM_001 | ${f.net}1`},db);await applyVmBulk(f.scope,{kind:'PROXY',key:randomUUID(),items:ready(p.rows)},db);
      await expect(archiveManagedResource(f.scope,'VM',f.v.VM_001.id,db)).rejects.toThrow(/Còn proxy/);
      await archiveManagedResource(f.scope,'VM',f.v.VM_002.id,db);expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.v.VM_002.id}})).archivedAt).not.toBeNull();
      await expect(archiveManagedResource(f.scope,'SERVER',f.a.id,db)).rejects.toThrow(/VM_001/);
    }finally{await f.cleanup();}
  });
});
describe('Tình trạng actions at the cell',()=>{
  it('start is a no-op when already started, refuses a stale VM revision, failure note unchanged writes nothing, confirm replays without history',async()=>{
    const f=await fixture();try{
      const p=await previewVmBulk(f.scope,{kind:'PROXY',serverId:f.a.id,text:`VM_001 | ${f.net}1`},db);await applyVmBulk(f.scope,{kind:'PROXY',key:randomUUID(),items:ready(p.rows)},db);
      const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.v.VM_001.id}}),config=vm.desiredConfigurationId!;
      await expect(startInstall(f.scope,config,db,{expectedVmRevision:vm.revision-1})).rejects.toMatchObject({code:'STALE_PREVIEW'});
      await startInstall(f.scope,config,db,{expectedVmRevision:vm.revision});
      const ops=()=>db.operationJournal.count({where:{projectId:f.projectId}}),afterStart=await ops();
      const again=await startInstall(f.scope,config,db,{expectedVmRevision:vm.revision});expect(again.replay).toBe(true);expect(await ops()).toBe(afterStart);
      const v2=await db.virtualMachine.findUniqueOrThrow({where:{id:vm.id}});
      expect((await reportInstallFailure(f.scope,config,'Chưa vào được máy',db,{expectedVmRevision:v2.revision})).saved).toBe(true);const afterFail=await ops();
      const v3=await db.virtualMachine.findUniqueOrThrow({where:{id:vm.id}});
      expect((await reportInstallFailure(f.scope,config,' Chưa vào được máy ',db,{expectedVmRevision:v3.revision})).saved).toBe(false);expect(await ops()).toBe(afterFail);
      await expect(reportInstallFailure(f.scope,config,'khác',db,{expectedVmRevision:v3.revision-1})).rejects.toMatchObject({code:'STALE_PREVIEW'});
      const c=await db.vMConfiguration.findUniqueOrThrow({where:{id:config}}),refreshSource=async()=>({id:'s',sourceKey:'GENJY',hash:'vm-table',fetchedAt:new Date().toISOString(),scanSucceeded:true});
      await confirmInstalled(f.scope,{configurationId:config,configurationHash:c.configurationHash,expectedVmRevision:v3.revision},db,{refreshSource});const afterConfirm=await ops();
      expect((await confirmInstalled(f.scope,{configurationId:config,configurationHash:c.configurationHash,expectedVmRevision:v3.revision},db,{refreshSource})).replay).toBe(true);expect(await ops()).toBe(afterConfirm);
      expect((await db.virtualMachine.findUniqueOrThrow({where:{id:vm.id}})).installedConfigurationId).toBe(config);
    }finally{await f.cleanup();}
  });
});
