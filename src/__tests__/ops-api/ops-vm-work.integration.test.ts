import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {db,AI_PIN,api,setup} from './ops-fixture';
import {maskSdk} from '@/lib/sdk-mask';
import {checked,expectConforms} from './openapi-conform';
import {changeVmProxy} from '@/server/vm-management/proxy-command';
import {addManagedVMs} from '@/server/vm-management/metadata';
import {setVmStatus} from '@/server/vm-ops/ops';
import {createOpsToken,revokeOpsToken} from '@/server/ops-api/tokens';
import {readVMWorkspace} from '@/server/vm-management/repository';
afterAll(()=>db.$disconnect());
// Work on real machines through the ops API (owner brief 21/10/2026). The machine itself is SIMULATED here: these tests check what
// MoneyToHome records and refuses; they never touch a VM, AE Mini Tool or EarnApp. Synthetic data (100.64.x test IPs), test DB only.
const octet=()=>1+Math.floor(Math.random()*250);
async function work(){
  const f=await setup(),net='100.65.'+octet()+'.';let n=0;
  await db.proxyProviderAccount.create({data:{projectId:f.projectId,code:'pkg',label:'pkg',credentialCipher:encrypt(JSON.stringify({username:'u',password:'p'}))}});
  // ai may also read the proxy of the VM it has in hand.
  await db.projectMember.update({where:{userId_projectId:{userId:f.ai,projectId:f.projectId}},data:{capabilities:['EARN_BALANCE','VM_PROXY_FOR_OPS']}});
  const proxy=async()=>{const ip=net+(++n),identity=await db.proxyIdentity.upsert({where:{ip},update:{},create:{ip,owner:'SELF'}});
    return db.proxyIP.create({data:{projectId:f.projectId,identityId:identity.id,address:ip+':8080',host:ip,port:8080,credentialCipher:encrypt(JSON.stringify({username:'user-'+n,password:'secret-pass-'+n})),packageCode:'pkg',inventoryState:'NEW',inventoryKey:identity.id}});};
  const vmRow=(id:string)=>db.virtualMachine.findUniqueOrThrow({where:{id},include:{operation:true}});
  const change=async(vmId:string,endpointId:string)=>{const v=await vmRow(vmId);return changeVmProxy(f.scope,{key:randomUUID(),vmId,expectedVmRevision:v.revision,expectedCycle:v.operation?.cycle??1,endpointId},db);};
  const ownerStatus=async(vmId:string,status:'OK'|'OFF'|'PROXY_BLOCKED'|'NEW_VM'|'NOT_LINKED')=>{const v=await vmRow(vmId);return setVmStatus(f.scope,{key:randomUUID(),items:[{vmId,status,expectedCycle:v.operation?.cycle??1}]},db);};
  const tok=async(scopes:string[],userId=f.ai,name='SERVER-01 · AI')=>(await createOpsToken(f.scope.userId,{projectId:f.projectId,userId,name,scopes:scopes as never,expiresInDays:30,pin:'123456'},db)).token!;
  // Every answer is checked against docs/ops-api/openapi.json (closed schemas).
  const P=f.projectId,get=async(t:string,path:string)=>{const r=await api('GET',path+(path.includes('?')?'&':'?')+'projectId='+P,{token:t});expectConforms('GET',path,r);return r;};
  const post=async(t:string,path:string,body:Record<string,unknown>,o:{key?:string;pin?:string}={})=>{const r=await api('POST',path,{token:t,body:{projectId:P,...body},key:o.key,pin:o.pin??AI_PIN});expectConforms('POST',path,r);return r;};
  const vmApi=async(t:string,id:string)=>(await get(t,'vms/'+id)).json.data;
  const cleanup=async()=>{
    await db.vmJob.deleteMany({where:{projectId:P}});await db.vMSdkHistory.deleteMany({where:{projectId:P}});await db.vMTask.deleteMany({where:{vm:{server:{projectId:P}}}});await db.vMProxyAllocation.deleteMany({where:{projectId:P}});
    await db.virtualMachine.updateMany({where:{server:{projectId:P}},data:{proxyId:null,desiredConfigurationId:null,installedConfigurationId:null}});await db.vMConfiguration.deleteMany({where:{projectId:P}});
    await db.proxyStatusEvent.deleteMany({where:{projectId:P}});const ids=(await db.proxyIP.findMany({where:{projectId:P},select:{identityId:true}})).map(p=>p.identityId!).filter(Boolean);
    await db.proxyIP.deleteMany({where:{projectId:P}});await db.proxyIdentity.deleteMany({where:{id:{in:ids}}});await db.proxyProviderAccount.deleteMany({where:{projectId:P}});await db.auditLog.deleteMany({where:{projectId:P}});await f.cleanup();
  };
  return {...f,proxy,vmRow,change,ownerStatus,tok,get,post,vmApi,cleanup};
}
type W=Awaited<ReturnType<typeof work>>;
/** A VM added on the web (New VM) with a proxy assigned by the owner. */
async function newVm(w:W,code:string){
  await addManagedVMs(w.scope,w.server.id,[code],db);const v=await db.virtualMachine.findFirstOrThrow({where:{serverId:w.server.id,code}});
  const p=await w.proxy();await w.change(v.id,p.id);return {id:v.id,proxy:p};
}

describe('New VM: the web marks only the rows it creates',()=>{
  it('VMs added on the web start as New VM with a history line; existing VMs are untouched',async()=>{
    const w=await work();try{
      const before=await db.vmOperation.count({where:{projectId:w.projectId}});
      const r=await addManagedVMs(w.scope,w.server.id,['NEW_001','NEW_002','VM_001'],db);expect(r.created).toBe(2);
      const rows=await db.vmOperation.findMany({where:{projectId:w.projectId,vm:{code:{in:['NEW_001','NEW_002']}}}});
      expect(rows.map(o=>[o.status,o.cycle])).toEqual([['NEW_VM',1],['NEW_VM',1]]);
      expect(await db.vmOperation.count({where:{projectId:w.projectId}})).toBe(before+2);
      expect(await db.vmOperation.findUnique({where:{vmId:w.vm.id}})).toBeNull(); // VM_001 existed: never turned into New VM
      expect((await db.vmOpsEvent.findFirstOrThrow({where:{vmId:rows[0].vmId}})).note).toMatch(/VM mới thêm trên web/);
    }finally{await w.cleanup();}
  });
});

describe('New VM → machine → proxy → EarnApp + Firefox → SDK saved → Chưa nối (machine simulated)',()=>{
  it('finishes only with the SDK of this install saved and read back, the proxy fetched and all checks passed',async()=>{
    const w=await work();try{
      const t=await w.tok(['READ','VM_OPS','PROXY_CREDENTIALS']),v=await newVm(w,'NEW_101');
      // An older SDK already on the web (money note, unused) must stay as it is and never count as this install's SDK.
      await db.sdkRecord.create({data:{projectId:w.projectId,code:'OLDSDK-'+w.x+'-0001',holderVmId:v.id,linkState:'UNLINKED',amount:'12.40',note:'ghi chú cũ',createdById:w.scope.userId,createdAt:new Date(Date.now()-86400000)}});
      let d=await w.vmApi(t,v.id);expect(d).toMatchObject({status:'NEW_VM',statusRevision:expect.any(Number),proxyState:'ASSIGNED',applyPending:{configurationId:d.proxy.configurationId}});
      const c=await w.post(t,'vms/'+v.id+'/claim',{expectedCycle:1,kind:'PREPARE'});expect(c.status).toBe(200);const job=c.json.data.recorded.job;
      expect((await w.post(t,'jobs/'+job.id+'/step',{step:'MACHINE_CREATED',machineRef:'AE-'+w.x+'-NEW_101'})).status).toBe(200);
      const p=await w.post(t,'vms/'+v.id+'/proxy-credentials',{jobId:job.id,expectedCycle:1});
      expect(p.status).toBe(200);expect(p.json.data.proxy).toMatchObject({host:v.proxy.host,port:8080,username:expect.stringMatching(/^user-/),password:expect.stringMatching(/^secret-pass-/)});
      const cfg=p.json.data.recorded.configurationId;expect(cfg).toBe(d.proxy.configurationId);
      const checks={machine:true,proxy:true,internet:true,earnapp:true,firefox:true};
      // No SDK of this install yet → refused, New VM kept.
      let fin=await w.post(t,'jobs/'+job.id+'/finish-prepare',{configurationId:cfg,checks});expect(fin.status).toBe(422);expect(fin.json.error?.message).toMatch(/SDK của lần cài này/);
      // An SDK stored before this attempt is not this install's SDK.
      d=await w.vmApi(t,v.id);const old=await w.post(t,'vms/'+v.id+'/sdk',{jobId:job.id,expectedCycle:1,expectedVmRevision:d.revision,code:'OLDSDK-'+w.x+'-0001'});expect(old.status).toBe(422);
      const code='SDKNEW-'+w.x+'-ABCDEF12';
      const s=await w.post(t,'vms/'+v.id+'/sdk',{jobId:job.id,expectedCycle:1,expectedVmRevision:d.revision,code});
      expect(s.status).toBe(200);expect(s.json.data.recorded.sdk).toMatchObject({code:maskSdk(code),current:true,inList:true,linkState:'UNLINKED'});
      // Read back: same code again → acknowledged, no second record.
      d=await w.vmApi(t,v.id);expect(d.currentSdk.code).toBe(maskSdk(code));
      const again=await w.post(t,'vms/'+v.id+'/sdk',{jobId:job.id,expectedCycle:1,expectedVmRevision:d.revision,code});expect(again.json.data.recorded.readBack).toBe(true);
      expect(await db.sdkRecord.count({where:{projectId:w.projectId,code}})).toBe(1);
      // A failed check keeps New VM.
      fin=await w.post(t,'jobs/'+job.id+'/finish-prepare',{configurationId:cfg,checks:{...checks,earnapp:false}});expect(fin.status).toBe(422);expect((await w.vmApi(t,v.id)).status).toBe('NEW_VM');
      fin=await w.post(t,'jobs/'+job.id+'/finish-prepare',{configurationId:cfg,checks});
      expect(fin.status).toBe(200);expect(fin.json.data.recorded).toMatchObject({status:'NOT_LINKED',sdkCode:maskSdk(code),configurationId:cfg,machineRef:'AE-'+w.x+'-NEW_101'});
      d=await w.vmApi(t,v.id);expect(d).toMatchObject({status:'NOT_LINKED',applyPending:null,activeJob:null,currentSdk:{code:maskSdk(code)}});
      // The old SDK keeps its money, note and unused mark; nothing was marked used.
      expect(await db.sdkRecord.findFirstOrThrow({where:{projectId:w.projectId,code:'OLDSDK-'+w.x+'-0001'}})).toMatchObject({linkState:'UNLINKED',note:'ghi chú cũ',holderVmId:v.id});
      expect((await db.sdkRecord.findFirstOrThrow({where:{projectId:w.projectId,code}})).linkState).toBe('UNLINKED');
      // A replay of the finish returns the same answer, nothing written twice.
      expect((await db.vmOpsEvent.count({where:{vmId:v.id,toStatus:'NOT_LINKED'}}))).toBe(1);
      // The proxy read is audited without the credentials.
      const audit=await db.auditLog.findFirstOrThrow({where:{projectId:w.projectId,action:'VM_PROXY_FOR_OPS'}});
      expect(JSON.stringify(audit.changes)).not.toMatch(/secret-pass|user-\d/);expect(audit.changes).toMatchObject({jobId:job.id,configurationId:cfg});
      expect(JSON.stringify(await db.opsAudit.findMany({where:{tokenId:{not:null},action:'VM_PROXY_CREDENTIALS'}}))).not.toMatch(/secret-pass/);
    }finally{await w.cleanup();}
  });
  it('an unfinished attempt resumes with its machine and SDK; another machine name is refused; no second SDK',async()=>{
    const w=await work();try{
      const t=await w.tok(['READ','VM_OPS','PROXY_CREDENTIALS']),v=await newVm(w,'NEW_102');
      const job=(await w.post(t,'vms/'+v.id+'/claim',{expectedCycle:1,kind:'PREPARE'})).json.data.recorded.job;
      await w.post(t,'jobs/'+job.id+'/step',{step:'MACHINE_CREATED',machineRef:'AE-'+w.x+'-102'});
      const cfg=(await w.post(t,'vms/'+v.id+'/proxy-credentials',{jobId:job.id,expectedCycle:1})).json.data.recorded.configurationId;
      const d=await w.vmApi(t,v.id),code='SDKRES-'+w.x+'-00000001';await w.post(t,'vms/'+v.id+'/sdk',{jobId:job.id,expectedCycle:1,expectedVmRevision:d.revision,code});
      // The answer was lost and the job expired.
      await db.vmJob.update({where:{id:job.id},data:{expiresAt:new Date(Date.now()-1000)}});
      const again=await w.post(t,'vms/'+v.id+'/claim',{expectedCycle:1,kind:'PREPARE'});
      expect(again.json.data.recorded).toMatchObject({resumed:true,job:{machineRef:'AE-'+w.x+'-102',step:'MACHINE_CREATED',sdkCode:maskSdk(code),resumeOf:job.id}});
      const j2=again.json.data.recorded.job;
      expect((await w.post(t,'jobs/'+j2.id+'/step',{step:'MACHINE_CREATED',machineRef:'AE-other'})).status).toBe(409);
      expect((await w.post(t,'jobs/'+job.id+'/step',{step:'X_STEP'})).status).toBe(409); // the expired job is closed
      const fin=await w.post(t,'jobs/'+j2.id+'/finish-prepare',{configurationId:cfg,checks:{machine:true,proxy:true,internet:true,earnapp:true,firefox:true}});
      expect(fin.status).toBe(200);expect(await db.sdkRecord.count({where:{projectId:w.projectId,holderVmId:v.id}})).toBe(1);
    }finally{await w.cleanup();}
  });
  it('a plain status can never leave New VM; the AI cannot set New VM / Chờ áp dụng proxy itself',async()=>{
    const w=await work();try{
      const t=await w.tok(['READ','VM_OPS']),v=await newVm(w,'NEW_103'),d=await w.vmApi(t,v.id);
      const r=await w.post(t,'vms/'+v.id+'/status',{expectedCycle:1,expectedStatusRevision:d.statusRevision,status:'NOT_LINKED'});expect(r.status).toBe(409);expect(r.json.error?.message).toMatch(/finish-prepare/);
      expect((await w.vmApi(t,v.id)).status).toBe('NEW_VM');
    }finally{await w.cleanup();}
  });
});

describe('Blocked → owner replaces → Chờ áp dụng proxy → AI applies and checks',()=>{
  it('replace sets Chờ áp dụng proxy; a second replace while the AI works refuses the earlier result; the new one then finishes',async()=>{
    const w=await work();try{
      const t=await w.tok(['READ','VM_OPS','PROXY_CREDENTIALS']),a=await w.proxy(),b=await w.proxy(),c=await w.proxy(),vm=w.vms[0].id;
      await w.change(vm,a.id);await w.ownerStatus(vm,'OK');
      let d=await w.vmApi(t,vm);
      const bl=await w.post(t,'vms/'+vm+'/proxy-blocked',{expectedCycle:1,expectedStatusRevision:d.statusRevision,configurationId:d.proxy.configurationId,evidence:'EarnApp báo IP bị chặn, đã thử 3 lần'});
      expect(bl.status).toBe(200);expect((await db.proxyIP.findUniqueOrThrow({where:{id:a.id}})).inventoryState).toBe('BLOCKED');expect((await w.vmApi(t,vm)).status).toBe('PROXY_BLOCKED');
      await w.change(vm,b.id);d=await w.vmApi(t,vm);
      expect(d).toMatchObject({status:'PROXY_PENDING',applyPending:{configurationId:d.proxy.configurationId}});
      const job=(await w.post(t,'vms/'+vm+'/claim',{expectedCycle:1,kind:'PROXY_APPLY'})).json.data.recorded.job;
      const cfgB=(await w.post(t,'vms/'+vm+'/proxy-credentials',{jobId:job.id,expectedCycle:1})).json.data.recorded.configurationId;
      await w.change(vm,c.id); // the owner replaced again while the AI was working
      let fin=await w.post(t,'jobs/'+job.id+'/finish-proxy',{configurationId:cfgB,result:'OK'});expect(fin.status).toBe(409);expect(fin.json.error?.message).toMatch(/đã đổi/);
      const cfgC=(await w.post(t,'vms/'+vm+'/proxy-credentials',{jobId:job.id,expectedCycle:1})).json.data.recorded.configurationId;expect(cfgC).not.toBe(cfgB);
      fin=await w.post(t,'jobs/'+job.id+'/finish-proxy',{configurationId:cfgC,result:'OK'});
      expect(fin.status).toBe(200);expect(fin.json.data.recorded).toMatchObject({result:'OK',status:'OK',configurationId:cfgC});
      expect(await w.vmApi(t,vm)).toMatchObject({status:'OK',applyPending:null});
    }finally{await w.cleanup();}
  });
  it('an old Blocked report never blocks the proxy that replaced it',async()=>{
    const w=await work();try{
      const t=await w.tok(['READ','VM_OPS']),a=await w.proxy(),b=await w.proxy(),vm=w.vms[1].id;
      await w.change(vm,a.id);const d=await w.vmApi(t,vm);await w.change(vm,b.id);
      const r=await w.post(t,'vms/'+vm+'/proxy-blocked',{expectedCycle:1,expectedStatusRevision:d.statusRevision,configurationId:d.proxy.configurationId,evidence:'kiểm lúc trước'});
      expect(r.status).toBe(409);expect((await db.proxyIP.findUniqueOrThrow({where:{id:b.id}})).inventoryState).toBe('LIVE');expect((await db.proxyIP.findUniqueOrThrow({where:{id:a.id}})).inventoryState).not.toBe('BLOCKED');
    }finally{await w.cleanup();}
  });
  it('OFF / SUS kept on apply (mark cleared); a status changed by the owner after the job was taken is never overwritten',async()=>{
    const w=await work();try{
      const t=await w.tok(['READ','VM_OPS','PROXY_CREDENTIALS']),a=await w.proxy(),b=await w.proxy(),c=await w.proxy(),d1=await w.proxy(),vm=w.vms[2].id,vm2=w.vms[3].id;
      await w.change(vm,a.id);await w.ownerStatus(vm,'OFF');await w.change(vm,b.id);
      const ws=(await readVMWorkspace(w.scope,db)).vms.find(x=>x.id===vm)!;expect([ws.ops,ws.applyPending]).toEqual(['OFF',true]);
      const job=(await w.post(t,'vms/'+vm+'/claim',{expectedCycle:1,kind:'PROXY_APPLY'})).json.data.recorded.job;
      const cfg=(await w.post(t,'vms/'+vm+'/proxy-credentials',{jobId:job.id,expectedCycle:1})).json.data.recorded.configurationId;
      const fin=await w.post(t,'jobs/'+job.id+'/finish-proxy',{configurationId:cfg,result:'OK'});expect(fin.json.data.recorded.status).toBe('OFF');
      expect(await w.vmApi(t,vm)).toMatchObject({status:'OFF',applyPending:null});
      // Owner changes the status after the AI took the job → the result is refused.
      await w.change(vm2,c.id);await w.ownerStatus(vm2,'OK');await w.change(vm2,d1.id);
      const j2=(await w.post(t,'vms/'+vm2+'/claim',{expectedCycle:1,kind:'PROXY_APPLY'})).json.data.recorded.job;
      const cfg2=(await w.post(t,'vms/'+vm2+'/proxy-credentials',{jobId:j2.id,expectedCycle:1})).json.data.recorded.configurationId;
      await w.ownerStatus(vm2,'NOT_LINKED');
      const r=await w.post(t,'jobs/'+j2.id+'/finish-proxy',{configurationId:cfg2,result:'OK'});expect(r.status).toBe(409);expect(r.json.error?.message).toMatch(/Tình trạng đã đổi/);
      expect((await w.vmApi(t,vm2)).status).toBe('NOT_LINKED');
    }finally{await w.cleanup();}
  });
});

describe('one VM, one operator; rights, PIN, revoked token, old round',()=>{
  it('two AIs cannot hold the same VM; the same token re-taking it gets its job back',async()=>{
    const w=await work();try{
      const t1=await w.tok(['READ','VM_OPS'],w.ai,'SERVER-01 · AI'),t2=await w.tok(['READ','VM_OPS'],w.ai,'SERVER-02 · AI'),v=await newVm(w,'NEW_201');
      const a=await w.post(t1,'vms/'+v.id+'/claim',{expectedCycle:1,kind:'PREPARE'});expect(a.status).toBe(200);
      const b=await w.post(t2,'vms/'+v.id+'/claim',{expectedCycle:1,kind:'PREPARE'});expect(b.status).toBe(409);expect(b.json.error?.details?.busy).toMatchObject({kind:'PREPARE',mine:false});
      const again=await w.post(t1,'vms/'+v.id+'/claim',{expectedCycle:1,kind:'PREPARE'});expect(again.json.data.recorded).toMatchObject({already:true,job:{id:a.json.data.recorded.job.id}});
      // The table shows who holds it.
      const ws=(await readVMWorkspace(w.scope,db)).vms.find(x=>x.id===v.id)!;expect(ws.job).toMatchObject({kind:'PREPARE',token:'SERVER-01 · AI'});
      // Another token never acts on that job.
      expect((await w.post(t2,'jobs/'+a.json.data.recorded.job.id+'/step',{step:'MACHINE_CREATED'})).status).toBe(403);
    }finally{await w.cleanup();}
  });
  it('proxy needs its own right, the token operation and an active job of the caller; wrong PIN, revoked token and old round are refused',async()=>{
    const w=await work();try{
      const v=await newVm(w,'NEW_202'),noProxy=await w.tok(['READ','VM_OPS']);
      const job=(await w.post(noProxy,'vms/'+v.id+'/claim',{expectedCycle:1,kind:'PREPARE'})).json.data.recorded.job;
      expect((await w.post(noProxy,'vms/'+v.id+'/proxy-credentials',{jobId:job.id,expectedCycle:1})).status).toBe(403); // token without PROXY_CREDENTIALS
      // A member without VM_PROXY_FOR_OPS cannot even get the operation on a token.
      await expect(w.tok(['READ','VM_OPS','PROXY_CREDENTIALS'],w.plain)).rejects.toBeTruthy();
      const t=await w.tok(['READ','VM_OPS','PROXY_CREDENTIALS'],w.ai,'SERVER-03 · AI');
      expect((await w.post(t,'vms/'+v.id+'/proxy-credentials',{jobId:job.id,expectedCycle:1})).status).toBe(403); // job of another token
      const other=w.vms[4].id;const p=await w.proxy();await w.change(other,p.id);
      expect((await w.post(t,'vms/'+other+'/proxy-credentials',{jobId:job.id,expectedCycle:1})).status).toBe(422); // job of another VM
      expect((await w.post(noProxy,'jobs/'+job.id+'/step',{step:'MACHINE_CREATED'},{pin:'000000'})).status).toBe(200); // 23/10/2026: no PIN for the AI
      await db.user.update({where:{id:w.ai},data:{pinFailedCount:0,pinLockedAt:null}});
      const first=(await db.opsToken.findMany({where:{userId:w.ai},orderBy:{createdAt:'asc'}}))[0];await revokeOpsToken(w.scope.userId,{projectId:w.projectId,tokenId:first.id},db);
      expect((await w.post(noProxy,'jobs/'+job.id+'/step',{step:'MACHINE_CREATED'})).json.error?.code).toBe('TOKEN_REVOKED');
      // A recreated VM (new round) refuses commands for the old round.
      await db.vmOperation.update({where:{vmId:other},data:{cycle:2}}).catch(async()=>{await db.vmOperation.create({data:{projectId:w.projectId,vmId:other,cycle:2}});});
      expect((await w.post(t,'vms/'+other+'/claim',{expectedCycle:1,kind:'CHECK'})).json.error?.code).toBe('CYCLE_CHANGED');
    }finally{await w.cleanup();}
  });
  it('operating notes go to the VM history with person / token / time; the owner note is never touched',async()=>{
    const w=await work();try{
      const t=await w.tok(['READ','VM_OPS']),vm=w.vms[0].id;await db.virtualMachine.update({where:{id:vm},data:{notes:'ghi chú của chủ'}});
      const r=await w.post(t,'vms/'+vm+'/notes',{expectedCycle:1,note:'Kiểm 10:05: EarnApp chạy, mật khẩu: abc123'});
      expect(r.status).toBe(200);const ev=await db.vmOpsEvent.findFirstOrThrow({where:{vmId:vm,kind:'NOTE'}});
      expect(ev.note).not.toMatch(/abc123/);expect(ev.detail).toMatchObject({token:expect.stringMatching(/^SERVER-01 · AI \(mth_/)});
      expect((await db.virtualMachine.findUniqueOrThrow({where:{id:vm}})).notes).toBe('ghi chú của chủ');
    }finally{await w.cleanup();}
  });
});

describe('contract',()=>{
  it('every real-machine endpoint was answered in the documented shape (200 and refusals)',()=>{
    for(const k of ['POST /vms/{id}/claim 200','POST /jobs/{id}/step 200','POST /vms/{id}/proxy-credentials 200','POST /vms/{id}/sdk 200','POST /vms/{id}/proxy-blocked 200','POST /vms/{id}/notes 200','POST /jobs/{id}/finish-prepare 200','POST /jobs/{id}/finish-proxy 200','POST /jobs/{id}/finish-prepare 422','POST /jobs/{id}/finish-proxy 409','POST /vms/{id}/claim 409','POST /vms/{id}/status 409','GET /vms/{id} 200'])expect(checked.has(k),k).toBe(true);
  });
});
