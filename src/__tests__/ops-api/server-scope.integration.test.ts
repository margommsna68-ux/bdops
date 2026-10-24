import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {api,db,setup} from './ops-fixture';
import {createOpsToken} from '@/server/ops-api/tokens';
import {runWithOpsAuth} from '@/server/ops-api/context';
import {addVmOpsNote,proxyForJob} from '@/server/vm-ops/jobs';
import {encrypt} from '@/lib/encryption';

afterAll(()=>db.$disconnect());

async function scoped(){
 const f=await setup();
 const other=await db.server.create({data:{projectId:f.projectId,code:'aaa-hidden',managed:true}});
 await db.virtualMachine.update({where:{id:f.vms[1].id},data:{serverId:other.id}});
 await db.projectMember.update({where:{userId_projectId:{userId:f.ai,projectId:f.projectId}},data:{capabilities:['EARN_BALANCE','VM_PROXY_FOR_OPS','EARN_PAYOUT','PAYPAL_RECEIPT_RECORD']}});
 const token=(await createOpsToken(f.scope.userId,{projectId:f.projectId,userId:f.ai,name:'scoped',scopes:['READ','VM_OPS','BALANCE_WRITE','PROXY_CREDENTIALS','PAYOUT','RECEIPT','ACCOUNT_OPS'],expiresInDays:30,pin:'123456'},db)).token!;
 await db.projectMember.update({where:{userId_projectId:{userId:f.ai,projectId:f.projectId}},data:{serverScope:'SELECTED',allowedServerIds:[f.server.id]}});
 const get=(path:string)=>api('GET',path+(path.includes('?')?'&':'?')+'projectId='+f.projectId,{token});
 const post=(path:string,body:Record<string,unknown>={},key=randomUUID())=>api('POST',path,{token,key,body:{projectId:f.projectId,...body},autoApprove:false});
 const cleanup=async()=>{await db.vmJob.deleteMany({where:{projectId:f.projectId}});await db.vMSdkHistory.deleteMany({where:{projectId:f.projectId}});await db.opsApproval.deleteMany({where:{projectId:f.projectId}});await f.cleanup();};
 return {...f,other,token,get,post,cleanup};
}

it('filters before paging and resolving and conceals inaccessible VM details',async()=>{
 const f=await scoped();try{
  const servers=await f.get('servers?limit=1');expect(servers.status).toBe(200);expect(servers.json.data.items.map((x:any)=>x.id)).toEqual([f.server.id]);expect(servers.json.data.nextCursor).toBeNull();
  const vms=await f.get('vms?limit=1');expect(vms.json.data.items[0].serverId).toBe(f.server.id);
  expect((await f.get('vms?serverId='+f.other.id)).json.data.items).toEqual([]);
  expect((await f.get('vms/'+f.vms[1].id)).status).toBe(404);
  expect((await f.get('vms/resolve?server=aaa-hidden&vm='+f.vms[1].code)).status).toBe(404);
  const me=await api('GET','me',{token:f.token});expect(me.json.data.projects.find((x:any)=>x.projectId===f.projectId).serverIds).toEqual([f.server.id]);
 }finally{await f.cleanup();}
});

it('denies stock, financial, batch and global approvals before creating summaries or records',async()=>{
 const f=await scoped();try{
  for(const path of ['proxies','withdrawals','withdrawals/unknown','paypal/suggest','earnapp-accounts','approvals/unknown'])expect((await f.get(path)).status).toBe(403);
  for(const path of ['vms/'+f.vm.id+'/proxy-assign','vms/'+f.vm.id+'/sdk-assign','batch','approvals/unknown/confirm','withdrawals/prepare','withdrawals/unknown/status','withdrawals/unknown/receipts','earnapp-accounts/hold','earnapp-accounts/unknown/credentials','earnapp-accounts/unknown/used','earnapp-accounts/unknown/release'])expect((await f.post(path)).status).toBe(403);
  expect(await db.opsApproval.count({where:{projectId:f.projectId}})).toBe(0);
  expect(await db.opsBatchKey.count({where:{projectId:f.projectId}})).toBe(0);
 }finally{await f.cleanup();}
});

it('returns only the assigned proxy for an owned active job and refreshes its narrow permission',async()=>{
 const f=await scoped();try{
  const endpoint=await db.proxyIP.create({data:{projectId:f.projectId,inventoryKey:randomUUID(),address:'192.0.2.42:8080',host:'192.0.2.42',port:8080,credentialCipher:encrypt(JSON.stringify({username:'fixture-user',password:'fixture-secret'}))}});
  const config=await db.vMConfiguration.create({data:{projectId:f.projectId,vmId:f.vm.id,version:1,endpointId:endpoint.id,snapshotCipher:encrypt('{}'),configurationHash:'fixture',createdById:f.scope.userId}});
  await db.virtualMachine.update({where:{id:f.vm.id},data:{desiredConfigurationId:config.id}});
  await db.vMProxyAllocation.create({data:{projectId:f.projectId,vmId:f.vm.id,endpointId:endpoint.id,configurationId:config.id,allocationKey:endpoint.inventoryKey!,createdById:f.scope.userId}});
  const claim=await f.post('vms/'+f.vm.id+'/claim',{expectedCycle:1,kind:'CHECK'});expect(claim.status).toBe(200);const jobId=claim.json.data.recorded.job.id;
  const read=()=>f.post('vms/'+f.vm.id+'/proxy-credentials',{jobId,expectedCycle:1});
  const result=await read();expect(result.status).toBe(200);expect(result.json.data.proxy.password).toBe('fixture-secret');
  await db.projectMember.update({where:{userId_projectId:{userId:f.ai,projectId:f.projectId}},data:{capabilities:['EARN_BALANCE']}});
  expect((await read()).status).toBe(403);
  expect(await db.opsApproval.count({where:{projectId:f.projectId}})).toBe(0);
 }finally{
  await db.vMProxyAllocation.deleteMany({where:{projectId:f.projectId}});
  await db.virtualMachine.updateMany({where:{server:{projectId:f.projectId}},data:{desiredConfigurationId:null,installedConfigurationId:null}});
  await db.vMConfiguration.deleteMany({where:{projectId:f.projectId}});
  await db.proxyIP.deleteMany({where:{projectId:f.projectId}});
  await f.cleanup();
 }
});

it('authorizes direct bound SDK reads and hides stock, other servers and historical money',async()=>{
 const f=await scoped();try{
  const hidden=await db.sdkRecord.create({data:{projectId:f.projectId,code:'HIDDEN-'+f.x,holderVmId:f.vms[1].id,createdById:f.scope.userId}});
  const own=await db.sdkRecord.create({data:{projectId:f.projectId,code:'OWN-SDK-'+f.x,holderVmId:f.vm.id,createdById:f.scope.userId,amount:'19.25',amountVmId:f.vms[1].id,amountCycle:1}});
  await db.sdkRecord.create({data:{projectId:f.projectId,code:'STOCK-'+f.x,createdById:f.scope.userId}});
  const list=await f.get('sdks?limit=1');expect(list.json.data.items.map((x:any)=>x.sdkId)).toEqual([own.id]);expect(list.json.data.items[0].amount).toBeNull();expect(list.json.data.items[0].observedVmId).toBeNull();expect(list.json.data.nextCursor).toBeNull();
  expect((await f.get('sdks?code='+hidden.code)).json.data.items[0].found).toBe(false);
  expect((await f.post('sdks/'+hidden.id+'/reveal')).status).toBe(404);
  expect(await db.opsApproval.count({where:{projectId:f.projectId}})).toBe(0);
  const direct=await f.post('sdks/'+own.id+'/reveal');expect(direct.status).toBe(200);expect(direct.json.data.code).toBe(own.code);expect(await db.opsApproval.count({where:{projectId:f.projectId}})).toBe(0);
  const detail=await f.get('vms/'+f.vm.id);expect(detail.json.data.sdk.items[0].stored).toBeNull();
 }finally{await f.cleanup();}
});

it('revokes job reads, writes and command replay immediately when a server grant is removed',async()=>{
 const f=await scoped();try{
  const key=randomUUID(),body={expectedCycle:1,kind:'CHECK'};
  const claim=await f.post('vms/'+f.vm.id+'/claim',body,key);expect(claim.status).toBe(200);const jobId=claim.json.data.recorded.job.id;
  expect((await f.get('jobs/'+jobId)).status).toBe(200);
  const noteKey=randomUUID();expect((await f.post('vms/'+f.vm.id+'/notes',{expectedCycle:1,note:'own VM'},noteKey)).status).toBe(200);
  await db.projectMember.update({where:{userId_projectId:{userId:f.ai,projectId:f.projectId}},data:{allowedServerIds:[]}});
  for(const path of ['vms/'+f.vm.id,'jobs/'+jobId])expect((await f.get(path)).status).toBe(404);
  expect((await f.post('vms/'+f.vm.id+'/claim',body,key)).status).toBe(404);
  expect((await f.post('vms/'+f.vm.id+'/notes',{expectedCycle:1,note:'own VM'},noteKey)).status).toBe(404);
  expect((await f.post('jobs/'+jobId+'/step',{step:'CHECKING'})).status).toBe(404);
  expect((await f.post('vms/'+f.vm.id+'/proxy-credentials',{jobId,expectedCycle:1})).status).toBe(404);
 }finally{await f.cleanup();}
});

it('checks fresh membership inside the command transaction before replay and direct job secret access',async()=>{
 const f=await scoped();try{
  const token=await db.opsToken.findFirstOrThrow({where:{userId:f.ai,projectIds:{has:f.projectId}}});
  const scope={userId:f.ai,projectId:f.projectId,role:'USER' as const,capabilities:[]};
  const input={key:randomUUID(),vmId:f.vm.id,expectedCycle:1,note:'transaction scope'};
  const run=()=>runWithOpsAuth({tokenId:token.id,userId:f.ai,operation:'VM_OPS',targets:{vmId:f.vm.id}},()=>addVmOpsNote(scope,input,db,{tokenId:token.id}));
  await expect(run()).resolves.toMatchObject({replay:false});
  await expect(run()).resolves.toMatchObject({replay:true});
  const claim=await f.post('vms/'+f.vm.id+'/claim',{kind:'CHECK',expectedCycle:1});expect(claim.status).toBe(200);
  await db.projectMember.update({where:{userId_projectId:{userId:f.ai,projectId:f.projectId}},data:{allowedServerIds:[]}});
  await expect(run()).rejects.toMatchObject({code:'NOT_FOUND'});
  await expect(proxyForJob(scope,{vmId:f.vm.id,jobId:claim.json.data.recorded.job.id,expectedCycle:1},db,{tokenId:token.id})).rejects.toMatchObject({code:'NOT_FOUND'});
  expect(await db.vmOpsEvent.count({where:{projectId:f.projectId,note:'transaction scope'}})).toBe(1);
 }finally{await f.cleanup();}
});

it('allows own VM status, SDK observation, balance and steps but refuses other-server writes without error details',async()=>{
 const f=await scoped();try{
  const v=await f.vmNow(0);
  expect((await f.post('vms/'+v.id+'/status',{expectedCycle:1,expectedStatusRevision:0,status:'OFF'})).status).toBe(200);
  const observed=await f.post('vms/'+v.id+'/sdk-observations',{expectedCycle:1,expectedVmRevision:v.revision,observedAt:new Date().toISOString(),source:'scoped fixture',sdks:[{code:'OBSERVE-'+f.x,expectedSdkRevision:null,amountUsd:'0.21',current:true}]});expect(observed.status).toBe(200);
  const now=await f.vmNow(0);
  expect((await f.post('vms/'+v.id+'/balance-check',{expectedCycle:1,expectedVmRevision:now.revision,earnAppAccountId:now.earnAppId,status:'OK',amount:'0.00',currency:'USD',checkedAt:new Date().toISOString()})).status).toBe(200);
  const claim=await f.post('vms/'+v.id+'/claim',{expectedCycle:1,kind:'CHECK'});expect(claim.status).toBe(200);
  expect((await f.post('jobs/'+claim.json.data.recorded.job.id+'/step',{step:'CHECKING'})).status).toBe(200);
  const denied=await f.post('vms/'+f.vms[1].id+'/status',{expectedCycle:100,expectedStatusRevision:100,status:'OFF'});expect(denied.status).toBe(404);expect(denied.json.error?.details).toBeUndefined();
  const ownerJob=await db.vmJob.create({data:{projectId:f.projectId,vmId:v.id,cycle:1,kind:'CHECK',claimedById:f.scope.userId,state:'RELEASED',expiresAt:new Date()}});
  expect((await f.get('jobs/'+ownerJob.id)).status).toBe(403);
 }finally{await f.cleanup();}
});
