import {afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {readOverview} from '@/server/dashboard/overview';
import {recordGen2Scan,machineUuid,type ScanInput} from '@/server/dashboard/scan';
import {createOpsToken,revokeOpsToken} from '@/server/ops-api/tokens';
import {api} from '../ops-api/ops-fixture';
import {expectConforms} from '../ops-api/openapi-conform';
import bcrypt from 'bcryptjs';
import {updateSdkInfo} from '@/server/vm-management/sdk-store';
afterAll(()=>db.$disconnect());
async function fixture(){
 const f=await businessFixture(),uuid=randomUUID(),base=new Date(Date.now()-2*3600e3),code='sdk-'+randomUUID();
 const updatedVm=await db.virtualMachine.update({where:{id:f.vm.id},data:{notes:'UUID máy: '+uuid,createdAt:base,sdkId:code}});
 const sdk=await db.sdkRecord.create({data:{projectId:f.scope.projectId,code,vmId:f.vm.id,holderVmId:f.vm.id,placedAt:base}});
 const body=(more:Partial<ScanInput>={}):ScanInput=>({key:randomUUID(),vmId:f.vm.id,projectId:f.scope.projectId,expectedCycle:1,expectedVmRevision:updatedVm.revision,machineUuid:uuid,configurationId:null,observedAt:new Date(Date.now()-60000).toISOString(),earning:true,problem:null,...more});
 return {...f,uuid,sdk,base,body,cleanup:async()=>{await db.opsAudit.deleteMany({where:{projectId:f.scope.projectId}});await db.opsToken.deleteMany({where:{userId:{in:[f.scope.userId,f.worker.userId]}}});await db.operationJournal.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();}};
}
describe('GEN2 cache observations and authorized dashboard',()=>{
 it('does not hide a manual decrease between two GEN2 readings',async()=>{
  const f=await fixture();try{
   const first=new Date(Date.now()-10000).toISOString();
   await recordGen2Scan(f.scope,f.body({money:{sdkId:f.sdk.id,expectedSdkRevision:0,capturedAt:first,observedAt:first,amount:'10'}}),db);
   await updateSdkInfo(f.scope,{key:randomUUID(),sdkId:f.sdk.id,expectedRevision:1,amount:'0'},db);
   const last=new Date().toISOString();
   await recordGen2Scan(f.scope,f.body({money:{sdkId:f.sdk.id,expectedSdkRevision:2,capturedAt:first,observedAt:last,amount:'12'}}),db);
   const p=(await readOverview(f.scope,{month:'2026-10',part:'operations'},db)).operations!.pulse;
   expect(p.growth).toMatchObject({decreased:1,covered:0,amount:null});
  }finally{await f.cleanup();}
 });
 it('does not present a scan from another machine UUID or a manual fault as healthy',async()=>{
  const f=await fixture();try{
   await recordGen2Scan(f.scope,f.body(),db);
   await db.vmOperation.create({data:{projectId:f.scope.projectId,vmId:f.vm.id,status:'EARN_ERROR'}});
   let p=(await readOverview(f.scope,{month:'2026-10',part:'operations'},db)).operations!.pulse;
   expect(p.health.good).toBe(0);expect(p.rows[0].recordedIssue).toBeTruthy();
   await db.vmOperation.update({where:{vmId:f.vm.id},data:{status:'OK'}});
   await db.virtualMachine.update({where:{id:f.vm.id},data:{notes:'UUID máy: '+randomUUID()}});
   p=(await readOverview(f.scope,{month:'2026-10',part:'operations'},db)).operations!.pulse;
   expect(p.health.good).toBe(0);expect(p.rows[0].checkedAt).toBeNull();
  }finally{await f.cleanup();}
 });
 it('lets assigned-server tokens read and observe only their own VMs',async()=>{
  const f=await fixture();try{
   await db.user.update({where:{id:f.worker.userId},data:{password:await bcrypt.hash('Synthetic-only-password',4)}});
   await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.worker.userId},data:{serverScope:'SELECTED',allowedServerIds:[f.server.id]}});
   const other=await db.server.create({data:{projectId:f.scope.projectId,code:'other',managed:true}});
   const vm=await db.virtualMachine.create({data:{serverId:other.id,code:'VM_001',managed:true}});
   const token=await createOpsToken(f.scope.userId,{projectId:f.scope.projectId,userId:f.worker.userId,name:'GEN2 scoped fixture',scopes:['READ','VM_OPS'],expiresInDays:30,pin:'123456'},db);
   const targets=await api('GET','gen2-targets?projectId='+f.scope.projectId,{token:token.token});
   expect(targets.status).toBe(200);expect(targets.json.data.items.map((r:{id:string})=>r.id)).toEqual([f.vm.id]);
   const {key,vmId,...body}=f.body();
   expect((await api('POST','vms/'+vmId+'/scan-observations',{token:token.token,body,key})).status).toBe(200);
   expect((await api('POST','vms/'+vm.id+'/scan-observations',{token:token.token,body})).status).toBeGreaterThanOrEqual(400);
   expect(await db.vmOpsEvent.count({where:{vmId:vm.id}})).toBe(0);
  }finally{await f.cleanup();}
 });
 it('keeps a scan as evidence without changing status; replay is exact and normal reads see it',async()=>{
  const f=await fixture();try{
   const b=f.body(),r=await recordGen2Scan(f.scope,b,db);expect(await recordGen2Scan(f.scope,b,db)).toMatchObject({...r,replay:true});
   const o=await readOverview(f.scope,{month:'2026-10',part:'operations'},db);expect(o.operations!.pulse.health).toMatchObject({good:1,total:1});
   expect(await db.vmOperation.count({where:{projectId:f.scope.projectId}})).toBe(0);expect(await db.vmOpsEvent.count({where:{projectId:f.scope.projectId}})).toBe(1);
  }finally{await f.cleanup();}
 });
 it('rejects wrong machine, changed cycle/revision and money read before capture atomically',async()=>{
  const f=await fixture();try{
   for(const more of [{machineUuid:randomUUID()},{expectedCycle:2},{expectedVmRevision:100},{observedAt:new Date(f.base.getTime()-1000).toISOString()}])await expect(recordGen2Scan(f.scope,f.body(more),db)).rejects.toBeTruthy();
   await expect(recordGen2Scan(f.scope,f.body({money:{sdkId:f.sdk.id,expectedSdkRevision:0,capturedAt:new Date().toISOString(),observedAt:new Date(Date.now()-60000).toISOString(),amount:'12'}}),db)).rejects.toBeTruthy();
   expect(await db.vmOpsEvent.count({where:{projectId:f.scope.projectId}})).toBe(0);expect((await db.sdkRecord.findUniqueOrThrow({where:{id:f.sdk.id}})).amount).toBeNull();
  }finally{await f.cleanup();}
 });
 it('records current SDK money via the same service, hides it without rights, counts exact today growth',async()=>{
  const f=await fixture();try{
   const t=Date.now()-30000,capturedAt=new Date(t-10000).toISOString();
   for(const [i,amount] of ['9.9','10.1'].entries())await recordGen2Scan(f.scope,f.body({observedAt:new Date(t+i*1000).toISOString(),money:{sdkId:f.sdk.id,expectedSdkRevision:i,capturedAt,observedAt:new Date(t+i*1000).toISOString(),amount}}),db);
   const p=(await readOverview(f.scope,{month:'2026-10',part:'operations'},db)).operations!.pulse;
   expect(p.growth).toMatchObject({amount:'0.2',increasing:1});expect(p.withdrawal).toMatchObject({enough:1,amount:'10.1'});
   const hidden=(await readOverview(f.worker,{month:'2026-10',part:'operations'},db)).operations!.pulse;expect(hidden.growth).toBeNull();expect(hidden.rows[0].amount).toBeNull();
   await expect(recordGen2Scan(f.worker,f.body({money:{sdkId:f.sdk.id,expectedSdkRevision:2,capturedAt,observedAt:new Date(t+2000).toISOString(),amount:'11'}}),db)).rejects.toMatchObject({code:'FORBIDDEN'});
   expect(await db.fundTransaction.count({where:{projectId:f.scope.projectId}})).toBe(0);
  }finally{await f.cleanup();}
 });
 it('does not inherit previous cycle health or daily money, nor old unbound events',async()=>{
  const f=await fixture();try{
   await recordGen2Scan(f.scope,f.body(),db);
   await db.sdkRecord.update({where:{id:f.sdk.id},data:{amount:12,amountVmId:f.vm.id,amountCycle:1,amountObservedAt:new Date()}});
   await db.sdkEvent.create({data:{projectId:f.scope.projectId,sdkId:f.sdk.id,kind:'AMOUNT',actorId:f.scope.userId,detail:{to:'5',observedAt:new Date(Date.now()-1000).toISOString()}}});
   await db.vmOperation.create({data:{projectId:f.scope.projectId,vmId:f.vm.id,cycle:2}});
   const p=(await readOverview(f.scope,{month:'2026-10',part:'operations'},db)).operations!.pulse;expect(p.health.good).toBe(0);expect(p.rows[0].amount).toBeNull();expect(p.growth?.covered).toBe(0);
  }finally{await f.cleanup();}
 });
 it('checks token scopes and revocation through HTTP, never grants another project',async()=>{
  const f=await fixture();try{
   await db.user.update({where:{id:f.worker.userId},data:{password:await bcrypt.hash('Synthetic-only-password',4)}});
   const token=await createOpsToken(f.scope.userId,{projectId:f.scope.projectId,userId:f.worker.userId,name:'GEN2 fixture',scopes:['READ','VM_OPS'],expiresInDays:30,pin:'123456'},db);
   const targets=await api('GET','gen2-targets?projectId='+f.scope.projectId,{token:token.token});expect(targets.status).toBe(200);expect(targets.json.data.items[0].machineUuid).toBe(f.uuid);expectConforms('GET','gen2-targets',targets);
   const {key,vmId,...body}=f.body();const path='vms/'+vmId+'/scan-observations';
   const result=await api('POST',path,{token:token.token,body,key});expect(result.status).toBe(200);expectConforms('POST',path,result);
   expect((await api('POST',path,{token:token.token,body:{...body,money:{sdkId:f.sdk.id,expectedSdkRevision:0,capturedAt:body.observedAt,observedAt:body.observedAt,amount:'10'}}})).status).toBe(403);
   await revokeOpsToken(f.scope.userId,{projectId:f.scope.projectId,tokenId:token.id},db);
   expect((await api('POST',path,{token:token.token,body,key})).status).toBe(401);
  }finally{await f.cleanup();}
 });
 it('reminders use stable due-date keys and never expose prices to an operations-only token',async()=>{
  const f=await fixture();try{
   await db.user.update({where:{id:f.worker.userId},data:{password:await bcrypt.hash('Synthetic-only-password',4)}});
   const token=await createOpsToken(f.scope.userId,{projectId:f.scope.projectId,userId:f.worker.userId,name:'GEN2 reminder',scopes:['READ'],expiresInDays:30,pin:'123456'},db);
   const pkg=await db.proxyProviderAccount.create({data:{projectId:f.scope.projectId,code:'DUE',label:'Due fixture',credentialCipher:'synthetic-not-a-credential',nextDueDate:new Date(),price:731.25,priceCurrency:'USD_PAYPAL'}});
   try{const result=await api('GET','gen2-reminders?projectId='+f.scope.projectId,{token:token.token});expectConforms('GET','gen2-reminders',result);expect(result.json.data.items[0]).toMatchObject({packageCode:'DUE',amount:null,currency:null});expect(result.text).not.toContain('731.25');}
   finally{await db.proxyProviderAccount.delete({where:{id:pkg.id}});}
  }finally{await f.cleanup();}
 });
 it('limits every dashboard VM and money total to assigned servers',async()=>{
  const f=await fixture();try{
   const other=await db.server.create({data:{projectId:f.scope.projectId,code:'other',managed:true}});
   await db.virtualMachine.create({data:{serverId:other.id,code:'VM_001',managed:true}});
   await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.worker.userId},data:{serverScope:'SELECTED',allowedServerIds:[f.server.id],capabilities:['EARN_BALANCE']}});
   const o=await readOverview(f.worker,{month:'2026-10',part:'operations'},db);
   expect(o.operations!.pulse.rows.map(r=>r.id)).toEqual([f.vm.id]);expect(o.operations!.stock.ready).toEqual({autofill:0,sharedManual:0});expect(o.operations!.packages).toEqual([]);
  }finally{await f.cleanup();}
 });
 it('only accepts an explicit unique UUID note',()=>{expect(machineUuid('random '+randomUUID())).toBeNull();expect(machineUuid('UUID máy: '+randomUUID()+'\nUUID: '+randomUUID())).toBeNull();});
});




