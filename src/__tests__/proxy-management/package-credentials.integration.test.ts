import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt,decrypt} from '@/lib/encryption';
import {businessDB as db,businessFixture} from './business-fixture';
import {changeVmProxy} from '@/server/vm-management/proxy-command';
import {renamePackage} from '@/server/proxy-management/package-credentials';
import {listPackages} from '@/server/proxy-management/catalog-management';
import {queryRegistry} from '@/server/proxy-management/history';
import {packageReminders} from '@/server/proxy-management/reminders';
import {undoOperation} from '@/server/operation-history/undo';
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
