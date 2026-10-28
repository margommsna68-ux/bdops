import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt,decrypt} from '@/lib/encryption';
import {businessDB as db,businessFixture} from './business-fixture';
import {changeVmProxy} from '@/server/vm-management/proxy-command';
import {renamePackage,changeProxyCredentials} from '@/server/proxy-management/package-credentials';
import {listPackages} from '@/server/proxy-management/catalog-management';
import {queryRegistry} from '@/server/proxy-management/history';
import {packageReminders} from '@/server/proxy-management/reminders';
import {undoOperation} from '@/server/operation-history/undo';
import {openSnapshot} from '@/server/operation-history/journal';
import {pendingApply} from '@/server/vm-management/proxy-change';
afterAll(()=>db.$disconnect());
// Owner 29/10/2026: the provider renumbers packages after payment and changes user/pass of proxies on its site. Synthetic data only.
const octet=()=>1+Math.floor(Math.random()*250);
async function setup(){
  const f=await businessFixture(),projectId=f.scope.projectId,net='100.65.'+octet()+'.';
  await db.project.update({where:{id:projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
  const pkg=await db.proxyProviderAccount.create({data:{projectId,code:'231243',label:'231243',credentialCipher:encrypt(JSON.stringify({username:'u',password:'p'})),nextDueDate:new Date(Date.now()+2*86400000),reminderDays:7}});
  await db.proxyProviderAccount.create({data:{projectId,code:'other',label:'other',credentialCipher:encrypt(JSON.stringify({username:'ou',password:'op'}))}});
  const vms=[f.vm];for(let i=2;i<=3;i++)vms.push(await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_00'+i,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}}));
  const proxy=async(ip:string,port:number,packageCode='231243')=>{const identity=await db.proxyIdentity.upsert({where:{ip},update:{},create:{ip,owner:'SELF',allocationMode:'APPROVED_PORT_STREAM',policyEvidenceCipher:encrypt('test-evidence')}});
    return db.proxyIP.create({data:{projectId,identityId:identity.id,address:ip+':'+port,host:ip,port,credentialCipher:encrypt(JSON.stringify(packageCode==='other'?{username:'ou',password:'op'}:{username:'u',password:'p'})),packageCode,inventoryState:'NEW',inventoryKey:identity.id+':'+port}});};
  const vm=(i:number)=>db.virtualMachine.findUniqueOrThrow({where:{id:vms[i].id},include:{operation:true}});
  const assign=async(i:number,endpointId:string)=>{const v=await vm(i);return changeVmProxy(f.scope,{key:randomUUID(),vmId:v.id,expectedVmRevision:v.revision,expectedCycle:v.operation?.cycle??1,endpointId},db);};
  const creds=async(id:string)=>JSON.parse(decrypt((await db.proxyIP.findUniqueOrThrow({where:{id}})).credentialCipher!));
  const cleanup=async()=>{
    await db.vMTask.deleteMany({where:{vm:{server:{projectId}}}});await db.vMProxyAllocation.deleteMany({where:{projectId}});await db.virtualMachine.updateMany({where:{server:{projectId}},data:{proxyId:null,desiredConfigurationId:null,installedConfigurationId:null}});
    await db.vMConfiguration.deleteMany({where:{projectId}});await db.operationJournal.deleteMany({where:{projectId}});await db.proxyReplacement.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});
    const ids=(await db.proxyIP.findMany({where:{projectId},select:{identityId:true}})).map(p=>p.identityId!).filter(Boolean);await db.proxyIP.deleteMany({where:{projectId}});await db.proxyIdentity.deleteMany({where:{id:{in:ids}}});await db.proxyProviderAccount.deleteMany({where:{projectId}});await f.cleanup();};
  return {...f,projectId,net,pkg,vms,proxy,vm,assign,creds,cleanup};
}
describe('Đổi mã gói',()=>{
  it('moves the package and every endpoint to the new code, keeps the id (reminders), refuses a duplicate and undoes',async()=>{
    const f=await setup();try{
      const a=await f.proxy(f.net+'1',8001),b=await f.proxy(f.net+'2',8002);
      const before=packageReminders([{...f.pkg,price:null}],new Date(),true);
      const r=await renamePackage(f.scope,{key:randomUUID(),code:'231243',newCode:'252037',expectedRevision:f.pkg.revision},db);
      expect(r).toMatchObject({code:'252037',oldCode:'231243',endpoints:2,replay:false});
      const pkg=await db.proxyProviderAccount.findUniqueOrThrow({where:{id:f.pkg.id}});
      expect(pkg).toMatchObject({code:'252037',label:'252037'});expect(pkg.note).toMatch(/^Mã cũ: 231243 \(đổi \d\d\/\d\d\/\d{4}\)$/);
      for(const e of [a,b])expect((await db.proxyIP.findUniqueOrThrow({where:{id:e.id}})).packageCode).toBe('252037');
      expect((await queryRegistry(f.scope,{view:'CURRENT',limit:50,packageCode:'252037'},db)).total).toBe(2);
      expect((await listPackages(f.scope,db)).find(p=>p.code==='252037')).toMatchObject({id:f.pkg.id,proxyCount:2});
      const after=packageReminders([{...pkg,price:null}],new Date(),true);
      expect(after[0].id).toBe(before[0].id);expect(after[0].code).toBe('252037');
      await expect(renamePackage(f.scope,{key:randomUUID(),code:'252037',newCode:'other'},db)).rejects.toMatchObject({code:'DUPLICATE_INPUT'});
      const op=await db.operationJournal.findFirstOrThrow({where:{projectId:f.projectId,kind:'PACKAGE_RENAME'}});
      await undoOperation(f.scope,op.id,'',db);
      expect((await db.proxyProviderAccount.findUniqueOrThrow({where:{id:f.pkg.id}})).code).toBe('231243');
      for(const e of [a,b])expect((await db.proxyIP.findUniqueOrThrow({where:{id:e.id}})).packageCode).toBe('231243');
    }finally{await f.cleanup();}
  });
});
describe('Đổi user/pass tại chỗ',()=>{
  it('3 endpoints of one IP, 2 on VMs: credentials changed, package kept, VMs pending a new config; secrets never journaled; undo',async()=>{
    const f=await setup();try{
      const ip=f.net+'73',e=[await f.proxy(ip,9001),await f.proxy(ip,9002),await f.proxy(ip,9003)];
      await f.assign(0,e[0].id);await f.assign(1,e[1].id);
      const v0=await f.vm(0),statusBefore=v0.operation?.status??null,oldConfig=v0.desiredConfigurationId;
      // New credentials of no package: refused unless the package itself moves (all of its proxies are here).
      const input={ip,username:'newuser',password:'S3cretPass'};
      const preview=await changeProxyCredentials(f.scope,{...input,key:randomUUID(),preview:true},db);
      expect(preview).toMatchObject({endpoints:3,vms:2,package:null,refusal:expect.stringMatching(/chưa thuộc gói/)});
      await expect(changeProxyCredentials(f.scope,{...input,key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
      const ok=await changeProxyCredentials(f.scope,{...input,key:randomUUID(),updatePackageCredentials:true,preview:true},db);
      expect(ok).toMatchObject({endpoints:3,byState:{LIVE:2,NEW:1},vms:2,blockedVms:0,activeWork:[],package:'231243',updatesPackage:true,refusal:null});expect([...(ok as {alreadyPendingVmIds:string[]}).alreadyPendingVmIds].sort()).toEqual([f.vms[0].id,f.vms[1].id].sort());
      const key=randomUUID(),done=await changeProxyCredentials(f.scope,{...input,key,updatePackageCredentials:true},db);
      expect(done).toMatchObject({endpoints:3,vms:2,replay:false});
      expect(await changeProxyCredentials(f.scope,{...input,key,updatePackageCredentials:true},db)).toMatchObject({replay:true});
      for(const x of e){const row=await db.proxyIP.findUniqueOrThrow({where:{id:x.id}});expect(await f.creds(x.id)).toEqual({username:'newuser',password:'S3cretPass'});expect(row.packageCode).toBe('231243');expect(row.port).toBe(x.port);}
      expect((await db.proxyIP.findUniqueOrThrow({where:{id:e[0].id}})).inventoryState).toBe('LIVE');
      expect((await db.proxyIP.findUniqueOrThrow({where:{id:e[2].id}})).inventoryState).toBe('NEW');
      for(const i of [0,1]){
        const v=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[i].id},include:{operation:true,desiredConfiguration:true}});
        expect(v.desiredConfiguration?.endpointId).toBe(e[i].id);expect(pendingApply(v)).toBe(v.desiredConfigurationId);
        expect(JSON.parse(decrypt(v.desiredConfiguration!.snapshotCipher)).proxy).toMatchObject({username:'newuser',password:'S3cretPass'});
        expect(await db.vMProxyAllocation.count({where:{vmId:v.id,releasedAt:null,role:'DESIRED'}})).toBe(1);
      }
      const v0b=await f.vm(0);expect(v0b.desiredConfigurationId).not.toBe(oldConfig);expect(v0b.operation?.status??null).toBe(statusBefore);
      expect(await db.proxyStatusEvent.count({where:{projectId:f.projectId,kind:'CREDENTIALS_CHANGED'}})).toBe(3);
      // Secrets never in clear in the journal (summary, request hash, decrypted snapshot) or the audit log.
      const op=await db.operationJournal.findFirstOrThrow({where:{projectId:f.projectId,kind:'PROXY_CREDENTIALS'}});
      const audits=await db.auditLog.findMany({where:{projectId:f.projectId}});
      const events=await db.proxyStatusEvent.findMany({where:{projectId:f.projectId}});
      for(const text of [JSON.stringify(op),JSON.stringify(openSnapshot(op.snapshotCipher)),JSON.stringify(audits),JSON.stringify(events)])expect(text).not.toMatch(/S3cretPass|newuser/);
      await undoOperation(f.scope,op.id,'',db);
      for(const x of e)expect(await f.creds(x.id)).toEqual({username:'u',password:'p'});
      expect(JSON.parse(decrypt((await db.proxyProviderAccount.findUniqueOrThrow({where:{id:f.pkg.id}})).credentialCipher))).toEqual({username:'u',password:'p'});
      const back=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[0].id},include:{operation:true}});
      expect(back.desiredConfigurationId).toBe(oldConfig);expect(v0.operation?.proxyPendingConfigId).toBe(oldConfig);expect(pendingApply(back)).toBe(oldConfig); // the VM was already pending on its old configuration: undo keeps that mark
      expect(await db.vMProxyAllocation.count({where:{vmId:back.id,releasedAt:null,role:'DESIRED',configurationId:oldConfig!}})).toBe(1);
    }finally{await f.cleanup();}
  });
  it('a BLOCKED proxy only changes credentials (its VM waits for the replacement); active work refuses unless forced',async()=>{
    const f=await setup();try{
      const ip=f.net+'80',a=await f.proxy(ip,6001),b=await f.proxy(ip,6002);
      await f.assign(0,a.id);await f.assign(1,b.id);
      await db.proxyIP.update({where:{id:b.id},data:{inventoryState:'BLOCKED',status:'BLOCKED'}});
      const v1=await f.vm(1),cfg1=v1.desiredConfigurationId;
      await db.vmJob.create({data:{projectId:f.projectId,vmId:f.vms[0].id,cycle:1,kind:'CHECK',claimedById:f.scope.userId,expiresAt:new Date(Date.now()+3600000)}});
      const input={ip,username:'ou',password:'op'};
      const p=await changeProxyCredentials(f.scope,{...input,key:randomUUID(),preview:true},db);
      expect(p).toMatchObject({endpoints:2,vms:1,blockedVms:1,blockedVmIds:[f.vms[1].id],package:'other',activeWork:[{vmId:f.vms[0].id,kind:'VM_JOB'}]});
      await expect(changeProxyCredentials(f.scope,{...input,key:randomUUID()},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      const r=await changeProxyCredentials(f.scope,{...input,key:randomUUID(),force:true},db);
      expect(r).toMatchObject({endpoints:2,vms:1,blockedVms:1});
      expect(await f.creds(b.id)).toEqual({username:'ou',password:'op'});
      const after1=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[1].id},include:{operation:true}});
      expect(after1.desiredConfigurationId).toBe(cfg1);
      const after0=await f.vm(0);expect(pendingApply(after0)).toBe(after0.desiredConfigurationId);
    }finally{await db.vmJob.deleteMany({where:{projectId:f.projectId}});await f.cleanup();}
  });
  it('follows the package of the new credentials, refuses empty / invalid credentials and a partial package move',async()=>{
    const f=await setup();try{
      const a=await f.proxy(f.net+'5',7001),b=await f.proxy(f.net+'6',7002);
      for(const bad of [{username:'',password:'x'},{username:'a b',password:'x'},{username:'a',password:'x:y'},{username:'a',password:''}])
        await expect(changeProxyCredentials(f.scope,{key:randomUUID(),endpointIds:[a.id],...bad},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
      expect(await changeProxyCredentials(f.scope,{key:randomUUID(),endpointIds:[a.id],username:'zz',password:'yy',updatePackageCredentials:true,preview:true},db)).toMatchObject({refusal:expect.stringMatching(/còn 1 proxy/)});
      const r=await changeProxyCredentials(f.scope,{key:randomUUID(),endpointIds:[a.id],username:'ou',password:'op'},db);
      expect(r).toMatchObject({endpoints:1,package:'other'});
      expect((await db.proxyIP.findUniqueOrThrow({where:{id:a.id}})).packageCode).toBe('other');
      expect((await db.proxyIP.findUniqueOrThrow({where:{id:b.id}})).packageCode).toBe('231243');
    }finally{await f.cleanup();}
  });
});
