import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {businessDB as db,businessFixture} from '../proxy-management/business-fixture';
import {encrypt} from '@/lib/encryption';
import {maskSdk} from '@/lib/sdk-mask';
import {commitStockImport} from '@/server/account-store/inventory';
import {applyLinks} from '@/server/account-store/links';
import {addManagedVMs} from '@/server/vm-management/metadata';
import {changeVmProxy} from '@/server/vm-management/proxy-command';
import {pendingApply} from '@/server/vm-management/proxy-change';
import {saveVmSdk} from '@/server/vm-management/sdk-store';
import {addVmSdk} from '@/server/vm-management/sdk-list';
import {setVmStatus} from '@/server/vm-ops/ops';
import {claimVmJob,type OpsCaller} from '@/server/vm-ops/jobs';
import {createOpsToken,hashToken} from '@/server/ops-api/tokens';
import {runWithOpsAuth} from '@/server/ops-api/context';
import {ProxyDomainError} from '@/server/proxy-management/types';
import {assignAiProxy,assignAiSdk,linkAiSdk,listAiProxies} from '@/server/ops-api/ai-inventory';
afterAll(()=>db.$disconnect());
// Proxy and SDK stock for an AI operator (design 23/10/2026 sections B and C). The machine is SIMULATED: these tests check what
// MoneyToHome hands out, records and refuses, through the same services as the web (assignProxyToVm, placeVmSdk, linkVmSdk).
// Synthetic proxies (100.66.x test IPs, example.invalid), test database only. No credential or full SDK code ever leaves a service.
// Own setup (not ops-fixture: that one imports the HTTP layer, which is being wired separately).
const octet=()=>1+Math.floor(Math.random()*250);
async function setup(){
  const f=await businessFixture(),x=randomUUID().slice(0,6),P=f.scope.projectId,today=new Date(Date.now()+7*3600000).toISOString().slice(0,10),net='100.66.'+octet()+'.';let n=0;
  await db.project.update({where:{id:P},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
  const vms=[f.vm];for(let i=2;i<=5;i++)vms.push(await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_00'+i,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}}));
  // VM_001 holds a Gmail login (an open EarnApp account), the others have none.
  await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:`inv1-${x}@example.invalid|Secret-pw-${x}`,batch:{purchasedAt:today,priceMode:'NONE'},key:randomUUID()},db);
  const login=await db.gmailAccount.findFirstOrThrow({where:{projectId:P}});
  await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:f.vm.id,expectedRevision:(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).revision,login:login.id}]},db);
  await db.proxyProviderAccount.create({data:{projectId:P,code:'pkg',label:'pkg',credentialCipher:encrypt(JSON.stringify({username:'u',password:'p'}))}});
  await db.proxyProviderAccount.create({data:{projectId:P,code:'pkg2',label:'pkg2',credentialCipher:encrypt(JSON.stringify({username:'u',password:'p'}))}});
  const ai=randomUUID();await db.user.create({data:{id:ai,email:ai+'@fixture.invalid',username:'ops-'+ai.slice(0,8),password:await bcrypt.hash('Local-pw-'+x,4),pin:await bcrypt.hash('246810',4)}});
  await db.projectMember.create({data:{projectId:P,userId:ai,role:'USER',allowedModules:['INFRASTRUCTURE'],capabilities:['VM_PROXY_FOR_OPS']}});
  type ProxyOpts={owner?:'SELF'|'GENJY';subgroup?:'PC_CHUNG'|null;state?:'NEW'|'BLOCKED'|'LIVE';pkg?:string};
  const proxy=async(o:ProxyOpts={})=>{const ip=net+(++n),identity=await db.proxyIdentity.upsert({where:{ip},update:{},create:{ip,owner:o.owner??'SELF',subgroup:o.subgroup??null,ownerDecidedAt:new Date()}});
    return db.proxyIP.create({data:{projectId:P,identityId:identity.id,address:ip+':8080',host:ip,port:8080,credentialCipher:encrypt(JSON.stringify({username:'user-'+n,password:'secret-pass-'+n})),packageCode:o.pkg??'pkg',inventoryState:o.state??'NEW',inventoryKey:identity.id}});};
  const tok=async(name='SERVER-01 · AI')=>{const made=await createOpsToken(f.scope.userId,{projectId:P,userId:ai,name,scopes:['READ','VM_OPS','PROXY_CREDENTIALS'],expiresInDays:30,pin:'123456'},db);
    const row=await db.opsToken.findFirstOrThrow({where:{tokenHash:hashToken(made.token!)}});return {id:row.id,caller:{tokenId:row.id,tokenLabel:name+' ('+row.prefix+')'} as OpsCaller};};
  const t1=await tok(),scope={...f.scope,userId:ai,role:'USER' as const,capabilities:[] as string[]};
  const asAi=<T>(fn:()=>Promise<T>,tokenId=t1.id)=>runWithOpsAuth({tokenId,userId:ai,operation:'VM_OPS'},fn);
  const vmRow=(id:string)=>db.virtualMachine.findUniqueOrThrow({where:{id},include:{operation:true,desiredConfiguration:true,allocations:{where:{releasedAt:null}}}});
  const claim=async(vmId:string,kind:'PREPARE'|'PROXY_APPLY'|'CHECK'='CHECK',caller=t1.caller)=>{const v=await vmRow(vmId);return (await asAi(()=>claimVmJob(scope,{key:randomUUID(),vmId,expectedCycle:v.operation?.cycle??1,kind},db,caller),caller.tokenId!)).job;};
  const change=async(vmId:string,endpointId:string)=>{const v=await vmRow(vmId);return changeVmProxy(f.scope,{key:randomUUID(),vmId,expectedVmRevision:v.revision,expectedCycle:v.operation?.cycle??1,endpointId},db);};
  const ownerStatus=async(vmId:string,status:'OK'|'PROXY_BLOCKED')=>{const v=await vmRow(vmId);return setVmStatus(f.scope,{key:randomUUID(),items:[{vmId,status,expectedCycle:v.operation?.cycle??1}]},db);};
  const newVm=async(code:string)=>{await addManagedVMs(f.scope,f.server.id,[code],db);return db.virtualMachine.findFirstOrThrow({where:{serverId:f.server.id,code}});};
  /** The AI's assign request for a VM as it is now (round + revision read first, like a careful client). */
  const assign=async(vmId:string,jobId:string,pick:{proxyId?:string;pick?:{group:'TUT'|'SHARED';packageCode?:string|null}},o:{key?:string;cycle?:number;revision?:number;caller?:OpsCaller}={})=>{const v=await vmRow(vmId);
    return asAi(()=>assignAiProxy(scope,{key:o.key??randomUUID(),vmId,expectedCycle:o.cycle??v.operation?.cycle??1,expectedVmRevision:o.revision??v.revision,jobId,...pick},db,o.caller??t1.caller),(o.caller??t1.caller).tokenId!);};
  const sdk=(code:string,data:Record<string,unknown>={})=>db.sdkRecord.create({data:{projectId:P,code,linkState:'UNLINKED',createdById:f.scope.userId,...data}});
  const code=(s:string)=>'INV'+x+s.padStart(6,'0');
  const cleanup=async()=>{
    await db.vmJob.deleteMany({where:{projectId:P}});await db.vMSdkHistory.deleteMany({where:{projectId:P}});await db.vMTask.deleteMany({where:{vm:{server:{projectId:P}}}});await db.vMProxyAllocation.deleteMany({where:{projectId:P}});
    await db.virtualMachine.updateMany({where:{server:{projectId:P}},data:{proxyId:null,desiredConfigurationId:null,installedConfigurationId:null}});await db.vMConfiguration.deleteMany({where:{projectId:P}});
    await db.proxyStatusEvent.deleteMany({where:{projectId:P}});const ids=(await db.proxyIP.findMany({where:{projectId:P},select:{identityId:true}})).map(p=>p.identityId!).filter(Boolean);
    await db.proxyIP.deleteMany({where:{projectId:P}});await db.proxyIdentity.deleteMany({where:{id:{in:ids}}});await db.proxyProviderAccount.deleteMany({where:{projectId:P}});
    await db.operationJournal.deleteMany({where:{projectId:P}});await db.vmOpsEvent.deleteMany({where:{projectId:P}});await db.opsToken.deleteMany({where:{userId:ai}});await db.opsAudit.deleteMany({where:{userId:ai}});
    await db.projectMember.deleteMany({where:{userId:ai}});await f.cleanup();await db.auditLog.deleteMany({where:{userId:ai}});await db.user.deleteMany({where:{id:ai}});
  };
  return {...f,x,P,vms,ai,t1,tok,scope,asAi,proxy,vmRow,claim,change,ownerStatus,newVm,assign,sdk,code,cleanup};
}
const refused=async(p:Promise<unknown>,code:string,reason?:string,message?:RegExp)=>{
  const e=await p.then(()=>null,x=>x as ProxyDomainError);
  expect(e,'expected a refusal').toBeInstanceOf(ProxyDomainError);expect(e!.code).toBe(code);if(reason)expect(e!.reason).toBe(reason);if(message)expect(e!.message).toMatch(message);
};
const SECRETS=/secret-pass|user-\d|credentialCipher|username|password/;

describe('GET proxies for the AI: FREE = what the web may hand out, never credentials',()=>{
  it('FREE excludes held, BLOCKED, LIVE and Genjy riêng; ASSIGNED carries the VM; group / package / state filters; cursor pages',async()=>{
    const f=await setup();try{
      const a=await f.proxy(),b=await f.proxy({pkg:'pkg2'}),s=await f.proxy({owner:'GENJY',subgroup:'PC_CHUNG'}),g=await f.proxy({owner:'GENJY'}),bl=await f.proxy({state:'BLOCKED'}),live=await f.proxy({state:'LIVE'}),held=await f.proxy();
      await f.change(f.vms[0].id,held.id);
      const free=await listAiProxies(db,f.P,{state:'FREE',limit:50});
      expect(free.items.map(i=>i.id).sort()).toEqual([a.id,b.id,s.id].sort());
      expect(free.items.find(i=>i.id===s.id)).toMatchObject({group:'SHARED',state:'FREE',inventoryState:'NEW',vm:null,packageCode:'pkg',port:8080,host:s.host});
      expect(JSON.stringify(free)).not.toMatch(SECRETS);
      const all=await listAiProxies(db,f.P,{limit:50});
      expect(JSON.stringify(all)).not.toMatch(SECRETS);
      const by=(id:string)=>all.items.find(i=>i.id===id)!;
      expect(by(held.id)).toMatchObject({state:'ASSIGNED',inventoryState:'LIVE',vm:{vmId:f.vms[0].id,serverCode:f.server.code,vmCode:'VM_001'}});
      expect(by(bl.id)).toMatchObject({state:'BLOCKED',inventoryState:'BLOCKED',vm:null});
      expect(by(g.id)).toMatchObject({group:'GENJY',state:'OTHER'});
      expect(by(live.id)).toMatchObject({group:'TUT',state:'OTHER',inventoryState:'LIVE'});
      expect((await listAiProxies(db,f.P,{state:'FREE',group:'TUT',limit:50})).items.map(i=>i.id).sort()).toEqual([a.id,b.id].sort());
      expect((await listAiProxies(db,f.P,{state:'FREE',group:'SHARED',limit:50})).items.map(i=>i.id)).toEqual([s.id]);
      expect((await listAiProxies(db,f.P,{state:'FREE',packageCode:'pkg2',limit:50})).items.map(i=>i.id)).toEqual([b.id]);
      expect((await listAiProxies(db,f.P,{state:'BLOCKED',limit:50})).items.map(i=>i.id)).toEqual([bl.id]);
      expect((await listAiProxies(db,f.P,{state:'ASSIGNED',limit:50})).items.map(i=>i.id)).toEqual([held.id]);
      // Pages: a stable order, the cursor = last id of the page.
      const p1=await listAiProxies(db,f.P,{state:'FREE',limit:2});expect(p1.items).toHaveLength(2);expect(p1.nextCursor).toBe(p1.items[1].id);
      const p2=await listAiProxies(db,f.P,{state:'FREE',limit:2,cursor:p1.nextCursor});expect(p2.items).toHaveLength(1);expect(p2.nextCursor).toBeNull();
      expect([...p1.items,...p2.items].map(i=>i.id).sort()).toEqual([a.id,b.id,s.id].sort());
      await expect(listAiProxies(db,f.P,{limit:0})).rejects.toMatchObject({code:'INVALID_INPUT'});
    }finally{await f.cleanup();}
  });
});

describe('POST vms/{id}/proxy-assign: by id and by pick, through assignProxyToVm',()=>{
  it('assigns a FREE proxy to the New VM in hand (hold, configuration, LIVE, apply mark, New VM kept); same key replays; same proxy again = no change',async()=>{
    const f=await setup();try{
      const a=await f.proxy(),v=await f.newVm('NEW_101'),job=await f.claim(v.id,'PREPARE'),key=randomUUID(),rev0=(await f.vmRow(v.id)).revision;
      const r=await f.assign(v.id,job.id,{proxyId:a.id},{key,revision:rev0});
      const row=await f.vmRow(v.id);
      expect(r).toMatchObject({replay:false,changed:true,endpointId:a.id,host:a.host,port:8080,packageCode:'pkg',group:'TUT',from:[],configurationId:row.desiredConfigurationId});
      expect(JSON.stringify(r)).not.toMatch(SECRETS);
      expect(row.allocations).toEqual([expect.objectContaining({endpointId:a.id,role:'DESIRED'})]);
      expect((await db.proxyIP.findUniqueOrThrow({where:{id:a.id}})).inventoryState).toBe('LIVE');
      expect(row.operation).toMatchObject({status:'NEW_VM',proxyPendingConfigId:row.desiredConfigurationId});
      expect(pendingApply({desiredConfigurationId:row.desiredConfigurationId,operation:row.operation})).toBe(row.desiredConfigurationId);
      expect((await db.vmOpsEvent.findMany({where:{vmId:v.id,kind:'JOB'}})).map(e=>e.note)).toEqual(expect.arrayContaining([expect.stringContaining('Gán proxy từ kho')]));
      expect(await db.proxyStatusEvent.count({where:{endpointId:a.id,kind:'ASSIGNED'}})).toBe(1);
      // Replay: the same answer, nothing written twice (the revision check would otherwise refuse the stale revision).
      const again=await f.assign(v.id,job.id,{proxyId:a.id},{key,revision:rev0});
      expect(again).toMatchObject({...r,replay:true});
      expect(await db.vMConfiguration.count({where:{vmId:v.id}})).toBe(1);
      // The proxy already on the VM: no change, the current configuration named.
      const same=await f.assign(v.id,job.id,{proxyId:a.id});
      expect(same).toMatchObject({changed:false,endpointId:a.id,configurationId:row.desiredConfigurationId});
      expect(await db.vMConfiguration.count({where:{vmId:v.id}})).toBe(1);
      // No FREE proxy for an impossible package: nothing written.
      await refused(f.assign(v.id,job.id,{pick:{group:'TUT',packageCode:'nope'}}),'INVALID_INPUT',undefined,/không còn proxy/i);
    }finally{await f.cleanup();}
  });
  it('pick takes the next FREE proxy of the group / package, never Chung for TUT, never Genjy riêng, never a held one',async()=>{
    const f=await setup();try{
      const s=await f.proxy({owner:'GENJY',subgroup:'PC_CHUNG'});await f.proxy({owner:'GENJY'});await f.proxy({state:'BLOCKED'});
      const held=await f.proxy();await f.change(f.vms[4].id,held.id);
      const b2=await f.proxy({pkg:'pkg2'}),a=await f.proxy();
      const j1=await f.claim(f.vms[1].id),j2=await f.claim(f.vms[2].id),j3=await f.claim(f.vms[3].id);
      const r1=await f.assign(f.vms[1].id,j1.id,{pick:{group:'TUT',packageCode:'pkg2'}});expect(r1).toMatchObject({changed:true,endpointId:b2.id,packageCode:'pkg2',group:'TUT'});
      const r2=await f.assign(f.vms[2].id,j2.id,{pick:{group:'TUT'}});expect(r2).toMatchObject({changed:true,endpointId:a.id,group:'TUT'});
      const r3=await f.assign(f.vms[3].id,j3.id,{pick:{group:'SHARED'}});expect(r3).toMatchObject({changed:true,endpointId:s.id,group:'SHARED'});
      // The stock has no FREE TUT proxy left (Genjy riêng, BLOCKED and the held one never count).
      const j4=await f.claim(f.vms[4].id);
      await refused(f.assign(f.vms[4].id,j4.id,{pick:{group:'TUT'}}),'INVALID_INPUT',undefined,/không còn proxy/i);
      expect((await listAiProxies(db,f.P,{state:'FREE',limit:50})).items).toEqual([]);
    }finally{await f.cleanup();}
  });
  it('Blocked → AI replaces: the VM becomes Chờ áp dụng proxy exactly like the web path; a working status is kept with the apply mark',async()=>{
    const f=await setup();try{
      const a=await f.proxy(),b=await f.proxy(),c=await f.proxy(),d=await f.proxy(),vmAi=f.vms[1].id,vmWeb=f.vms[2].id;
      for(const [vm,p] of [[vmAi,a],[vmWeb,c]] as const){await f.change(vm,p.id);await f.ownerStatus(vm,'OK');await f.ownerStatus(vm,'PROXY_BLOCKED');expect((await f.vmRow(vm)).operation!.status).toBe('PROXY_BLOCKED');}
      expect((await db.proxyIP.findUniqueOrThrow({where:{id:a.id}})).inventoryState).toBe('BLOCKED');
      const job=await f.claim(vmAi);
      const r=await f.assign(vmAi,job.id,{proxyId:b.id});expect(r).toMatchObject({changed:true,from:[a.id]});
      await f.change(vmWeb,d.id);
      const [ai,web]=await Promise.all([f.vmRow(vmAi),f.vmRow(vmWeb)]);
      const shape=(v:typeof ai)=>({status:v.operation!.status,blockedEndpointId:v.operation!.blockedEndpointId,blockedCycle:v.operation!.blockedCycle,pending:pendingApply({desiredConfigurationId:v.desiredConfigurationId,operation:v.operation})===v.desiredConfigurationId,holds:v.allocations.map(h=>h.role)});
      expect(shape(ai)).toEqual(shape(web));expect(shape(ai)).toMatchObject({status:'PROXY_PENDING',blockedEndpointId:null,pending:true,holds:['DESIRED']});
      const ev=await db.vmOpsEvent.findFirstOrThrow({where:{vmId:vmAi,kind:'STATUS',toStatus:'PROXY_PENDING'}});
      expect(ev.note).toMatch(/Đã thay proxy \(AI · SERVER-01/);expect(ev.note).toMatch(/chờ áp dụng trên máy thật/);expect(ev.note).toMatch(/trước Blocked: OK/);
      // The old proxy stays BLOCKED for the provider; the new one is LIVE.
      expect((await db.proxyIP.findUniqueOrThrow({where:{id:a.id}})).inventoryState).toBe('BLOCKED');expect((await db.proxyIP.findUniqueOrThrow({where:{id:b.id}})).inventoryState).toBe('LIVE');
      // A working status (OK) is never changed by an assignment; only the apply mark is set.
      const e=await f.proxy(),vmOk=f.vms[3].id;await f.change(vmOk,await f.proxy().then(p=>p.id));await f.ownerStatus(vmOk,'OK');
      const j2=await f.claim(vmOk);await f.assign(vmOk,j2.id,{proxyId:e.id});
      const ok=await f.vmRow(vmOk);expect(ok.operation).toMatchObject({status:'OK',proxyPendingConfigId:ok.desiredConfigurationId});
    }finally{await f.cleanup();}
  });
  it('two parallel picks get two different proxies; two parallel assigns of ONE proxy to two VMs leave exactly one winner',async()=>{
    const f=await setup();try{
      await f.proxy();await f.proxy();
      const [j1,j2]=[await f.claim(f.vms[1].id),await f.claim(f.vms[2].id)];
      const rs=await Promise.all([f.assign(f.vms[1].id,j1.id,{pick:{group:'TUT'}}),f.assign(f.vms[2].id,j2.id,{pick:{group:'TUT'}})]);
      expect(rs.map(r=>r.changed)).toEqual([true,true]);expect(rs[0].endpointId).not.toBe(rs[1].endpointId);
      const x=await f.proxy(),[j3,j4]=[await f.claim(f.vms[3].id),await f.claim(f.vms[4].id)];
      const out=await Promise.allSettled([f.assign(f.vms[3].id,j3.id,{proxyId:x.id}),f.assign(f.vms[4].id,j4.id,{proxyId:x.id})]);
      expect(out.map(o=>o.status).sort()).toEqual(['fulfilled','rejected']);
      const lost=out.find(o=>o.status==='rejected') as PromiseRejectedResult;expect(lost.reason).toBeInstanceOf(ProxyDomainError);expect((lost.reason as ProxyDomainError).code).toBe('INVALID_INPUT');
      const holds=await db.vMProxyAllocation.findMany({where:{endpointId:x.id,releasedAt:null}});expect(holds).toHaveLength(1);
      const winner=holds[0].vmId,loser=[f.vms[3].id,f.vms[4].id].find(id=>id!==winner)!;
      const l=await f.vmRow(loser);expect(l.allocations).toEqual([]);expect(l.desiredConfigurationId).toBeNull();expect(await db.vMConfiguration.count({where:{vmId:loser}})).toBe(0);
      expect(await db.vMConfiguration.count({where:{endpointId:x.id}})).toBe(1);
      expect((await db.proxyIP.findUniqueOrThrow({where:{id:x.id}})).inventoryState).toBe('LIVE');
    }finally{await f.cleanup();}
  });
  it('refused: job of another token / another VM, old round, stale VM revision, BLOCKED proxy, Genjy riêng, a held proxy, an unknown id; nothing written',async()=>{
    const f=await setup();try{
      const a=await f.proxy(),bl=await f.proxy({state:'BLOCKED'}),g=await f.proxy({owner:'GENJY'}),held=await f.proxy();await f.change(f.vms[4].id,held.id);
      const t2=await f.tok('SERVER-02 · AI'),vm=f.vms[1].id,job=await f.claim(vm),other=await f.claim(f.vms[2].id,'CHECK',t2.caller);
      const before=async()=>JSON.stringify([await db.vMProxyAllocation.findMany({where:{projectId:f.P},orderBy:{id:'asc'}}),await db.vMConfiguration.count({where:{projectId:f.P}}),await db.proxyIP.findMany({where:{projectId:f.P},select:{id:true,inventoryState:true,revision:true},orderBy:{id:'asc'}})]);
      const snap=await before();
      await refused(f.assign(vm,job.id,{proxyId:a.id},{caller:t2.caller}),'FORBIDDEN');
      await refused(f.assign(vm,other.id,{proxyId:a.id},{caller:t2.caller}),'INVALID_INPUT',undefined,/VM khác/);
      await refused(f.assign(vm,job.id,{proxyId:a.id},{cycle:2}),'STALE_PREVIEW','CYCLE_CHANGED');
      await refused(f.assign(vm,job.id,{proxyId:a.id},{revision:(await f.vmRow(vm)).revision+1}),'STALE_PREVIEW','REVISION_CONFLICT');
      await refused(f.assign(vm,job.id,{proxyId:bl.id}),'INVALID_INPUT',undefined,/BLOCKED/);
      await refused(f.assign(vm,job.id,{proxyId:g.id}),'OWNER_CONFLICT',undefined,/Genjy riêng/);
      await refused(f.assign(vm,job.id,{proxyId:held.id}),'INVALID_INPUT',undefined,/đang dùng ở/);
      await refused(f.assign(vm,job.id,{proxyId:'nope-'+f.x}),'NOT_FOUND');
      await refused(f.assign(vm,job.id,{}),'INVALID_INPUT');
      await refused(f.assign(vm,job.id,{proxyId:a.id,pick:{group:'TUT'}}),'INVALID_INPUT');
      expect(await before()).toBe(snap);
      expect((await f.vmRow(vm)).allocations).toEqual([]);
    }finally{await f.cleanup();}
  });
});

describe('POST vms/{id}/sdk-assign and sdk-linked: store codes through placeVmSdk / linkVmSdk',()=>{
  it('an UNLINKED store code becomes the current SDK; the previous unlinked current stays in the list; replay; a code of the own list too',async()=>{
    const f=await setup();try{
      const vm=f.vms[1].id,c0=f.code('0'),s1=f.code('1'),own=f.code('2');
      let v=await f.vmRow(vm);await saveVmSdk(f.scope,{key:randomUUID(),vmId:vm,expectedVmRevision:v.revision,expectedCycle:1,code:c0},db);
      const store=await f.sdk(s1),job=await f.claim(vm),key=randomUUID();
      v=await f.vmRow(vm);
      const r=await f.asAi(()=>assignAiSdk(f.scope,{key,vmId:vm,expectedCycle:1,expectedVmRevision:v.revision,jobId:job.id,sdkId:store.id,expectedSdkRevision:store.revision},db,f.t1.caller));
      expect(r).toMatchObject({replay:false,changed:true,maskedCode:maskSdk(s1),sdk:{id:store.id,linkState:'UNLINKED'}});
      expect(r.sdk.revision).toBeGreaterThan(store.revision);
      expect(JSON.stringify(r)).not.toContain(s1);expect(JSON.stringify(r)).not.toContain(c0);
      const [cur,prev]=await Promise.all([db.sdkRecord.findUniqueOrThrow({where:{id:store.id}}),db.sdkRecord.findFirstOrThrow({where:{projectId:f.P,code:c0}})]);
      expect(cur).toMatchObject({vmId:vm,holderVmId:vm,linkState:'UNLINKED'});expect(prev).toMatchObject({vmId:null,holderVmId:vm,linkState:'UNLINKED'});
      expect((await db.virtualMachine.findUniqueOrThrow({where:{id:vm}})).sdkId).toBe(s1);
      // Same key → the first answer; the record is untouched.
      const again=await f.asAi(()=>assignAiSdk(f.scope,{key,vmId:vm,expectedCycle:1,expectedVmRevision:v.revision,jobId:job.id,sdkId:store.id,expectedSdkRevision:store.revision},db,f.t1.caller));
      expect(again).toMatchObject({...r,replay:true});expect((await db.sdkRecord.findUniqueOrThrow({where:{id:store.id}})).revision).toBe(cur.revision);
      // A code already in this VM's list (unused) may become current too.
      await addVmSdk(f.scope,{key:randomUUID(),vmId:vm,expectedCycle:1,code:own},db);const o=await db.sdkRecord.findFirstOrThrow({where:{projectId:f.P,code:own}});
      v=await f.vmRow(vm);
      const r2=await f.asAi(()=>assignAiSdk(f.scope,{key:randomUUID(),vmId:vm,expectedCycle:1,expectedVmRevision:v.revision,jobId:job.id,sdkId:o.id,expectedSdkRevision:o.revision},db,f.t1.caller));
      expect(r2).toMatchObject({changed:true,maskedCode:maskSdk(own)});
      expect((await db.sdkRecord.findMany({where:{holderVmId:vm},select:{code:true,vmId:true}})).sort((a,b)=>a.code.localeCompare(b.code))).toEqual([{code:c0,vmId:null},{code:s1,vmId:null},{code:own,vmId:vm}]);
      // Choosing the current code again: no change.
      v=await f.vmRow(vm);const o2=await db.sdkRecord.findUniqueOrThrow({where:{id:o.id}});
      expect((await f.asAi(()=>assignAiSdk(f.scope,{key:randomUUID(),vmId:vm,expectedCycle:1,expectedVmRevision:v.revision,jobId:job.id,sdkId:o.id,expectedSdkRevision:o2.revision},db,f.t1.caller))).changed).toBe(false);
    }finally{await f.cleanup();}
  });
  it('refused: UNCONFIRMED, LINKED, a code of another VM, a stale SDK revision, an unknown id, no own job, old round / stale VM revision; nothing moves',async()=>{
    const f=await setup();try{
      const vm=f.vms[1].id,job=await f.claim(vm);
      const unc=await f.sdk(f.code('3'),{linkState:'UNCONFIRMED'}),used=await f.sdk(f.code('4'),{linkState:'LINKED'}),free=await f.sdk(f.code('6'));
      await addVmSdk(f.scope,{key:randomUUID(),vmId:f.vms[2].id,expectedCycle:1,code:f.code('5')},db);const elsewhere=await db.sdkRecord.findFirstOrThrow({where:{projectId:f.P,code:f.code('5')}});
      const v=await f.vmRow(vm),go=(sdkId:string,rev:number,o:Record<string,unknown>={})=>f.asAi(()=>assignAiSdk(f.scope,{key:randomUUID(),vmId:vm,expectedCycle:1,expectedVmRevision:v.revision,jobId:job.id,sdkId,expectedSdkRevision:rev,...o},db,f.t1.caller));
      await refused(go(unc.id,unc.revision),'OWNER_CONFLICT',undefined,/chưa xác nhận/);
      await refused(go(used.id,used.revision),'OWNER_CONFLICT',undefined,/đã nối EarnApp/);
      await refused(go(elsewhere.id,elsewhere.revision),'OWNER_CONFLICT',undefined,/VM_003/);
      await refused(go(free.id,free.revision+1),'STALE_PREVIEW','REVISION_CONFLICT');
      await refused(go('nope-'+f.x,0),'NOT_FOUND');
      await refused(go(free.id,free.revision,{expectedCycle:2}),'STALE_PREVIEW','CYCLE_CHANGED');
      await refused(go(free.id,free.revision,{expectedVmRevision:v.revision+1}),'STALE_PREVIEW','REVISION_CONFLICT');
      const t2=await f.tok('SERVER-02 · AI');
      await refused(f.asAi(()=>assignAiSdk(f.scope,{key:randomUUID(),vmId:vm,expectedCycle:1,expectedVmRevision:v.revision,jobId:job.id,sdkId:free.id,expectedSdkRevision:free.revision},db,t2.caller),t2.id),'FORBIDDEN');
      expect(await db.sdkRecord.findMany({where:{projectId:f.P},select:{id:true,vmId:true,holderVmId:true,linkState:true,revision:true},orderBy:{code:'asc'}})).toEqual([
        expect.objectContaining({id:unc.id,vmId:null,holderVmId:null,revision:unc.revision}),expect.objectContaining({id:used.id,vmId:null,holderVmId:null}),expect.objectContaining({id:elsewhere.id,vmId:null,holderVmId:f.vms[2].id}),expect.objectContaining({id:free.id,vmId:null,holderVmId:null,revision:free.revision})]);
      expect((await db.virtualMachine.findUniqueOrThrow({where:{id:vm}})).sdkId).toBeNull();
    }finally{await f.cleanup();}
  });
  it('sdk-linked marks LINKED once with the evidence in the VM history; replay; the account must be the VM\'s current one; linked is final',async()=>{
    const f=await setup();try{
      const vm=f.vms[0].id,earn=await db.earnAppAccount.findFirstOrThrow({where:{vmId:vm,closedAt:null}}),job=await f.claim(vm),s=await f.sdk(f.code('7'));
      let v=await f.vmRow(vm);
      await f.asAi(()=>assignAiSdk(f.scope,{key:randomUUID(),vmId:vm,expectedCycle:1,expectedVmRevision:v.revision,jobId:job.id,sdkId:s.id,expectedSdkRevision:s.revision},db,f.t1.caller));
      const placed=await db.sdkRecord.findUniqueOrThrow({where:{id:s.id}}),key=randomUUID(),evidence='Đăng nhập EarnApp thành công, SDK thấy trong Devices';
      const link=(o:Record<string,unknown>={})=>f.asAi(()=>linkAiSdk(f.scope,{key,vmId:vm,expectedCycle:1,jobId:job.id,sdkId:s.id,expectedSdkRevision:placed.revision,accountId:earn.id,evidence,...o},db,f.t1.caller));
      await refused(link({accountId:'other-'+f.x,key:randomUUID()}),'STALE_PREVIEW');
      await refused(link({evidence:'   ',key:randomUUID()}),'INVALID_INPUT');
      expect((await db.sdkRecord.findUniqueOrThrow({where:{id:s.id}})).linkState).toBe('UNLINKED');
      const r=await link();
      expect(r).toMatchObject({replay:false,changed:true,maskedCode:maskSdk(f.code('7')),sdk:{id:s.id,linkState:'LINKED'}});
      expect(JSON.stringify(r)).not.toContain(f.code('7'));
      expect(await db.sdkRecord.findUniqueOrThrow({where:{id:s.id}})).toMatchObject({linkState:'LINKED',linkedEarnAppId:earn.id,linkedVmId:vm,linkedCycle:1,linkedById:f.ai});
      const notes=()=>db.vmOpsEvent.findMany({where:{vmId:vm,kind:'NOTE'}});
      expect((await notes()).map(n=>n.note)).toEqual([expect.stringContaining(evidence)]);expect((await notes())[0].detail).toMatchObject({jobId:job.id,sdkId:s.id,token:expect.stringMatching(/^SERVER-01 · AI/)});
      expect(await db.sdkEvent.count({where:{sdkId:s.id,kind:'LINK'}})).toBe(1);
      // Replay: the first answer, one note, one LINK event.
      const again=await link();expect(again).toMatchObject({...r,replay:true});expect(await notes()).toHaveLength(1);expect(await db.sdkEvent.count({where:{sdkId:s.id,kind:'LINK'}})).toBe(1);
      // Linked is final: a new command with the same account = no change (no second note); the code is never usable on another VM.
      const now=await db.sdkRecord.findUniqueOrThrow({where:{id:s.id}});
      expect((await link({key:randomUUID(),expectedSdkRevision:now.revision})).changed).toBe(false);expect(await notes()).toHaveLength(1);
      v=await f.vmRow(f.vms[1].id);const j2=await f.claim(f.vms[1].id);
      await refused(f.asAi(()=>assignAiSdk(f.scope,{key:randomUUID(),vmId:f.vms[1].id,expectedCycle:1,expectedVmRevision:v.revision,jobId:j2.id,sdkId:s.id,expectedSdkRevision:now.revision},db,f.t1.caller)),'OWNER_CONFLICT');
      // A VM without an open EarnApp account cannot link.
      const s2=await f.sdk(f.code('8'));v=await f.vmRow(f.vms[1].id);
      await f.asAi(()=>assignAiSdk(f.scope,{key:randomUUID(),vmId:f.vms[1].id,expectedCycle:1,expectedVmRevision:v.revision,jobId:j2.id,sdkId:s2.id,expectedSdkRevision:s2.revision},db,f.t1.caller));
      const p2=await db.sdkRecord.findUniqueOrThrow({where:{id:s2.id}});
      await refused(f.asAi(()=>linkAiSdk(f.scope,{key:randomUUID(),vmId:f.vms[1].id,expectedCycle:1,jobId:j2.id,sdkId:s2.id,expectedSdkRevision:p2.revision,accountId:earn.id,evidence},db,f.t1.caller)),'INVALID_INPUT',undefined,/chưa có tài khoản EarnApp/);
    }finally{await f.cleanup();}
  });
});
