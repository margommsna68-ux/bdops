import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {businessDB as db,businessFixture} from './business-fixture';
import {createProxyBatchService} from '@/server/proxy-management/batches';
import {persistSourceSnapshot} from '@/server/proxy-management/sources';
import {applySdkUpdate} from '@/server/vm-management/sdk';
import {destroyProject} from '@/server/project-lifecycle/destroy';
import {appRouter} from '@/server/routers/_app';
import type {Context} from '@/server/trpc';
afterAll(()=>db.$disconnect());
function randomIp(){return '10.'+[0,0,0].map(()=>Math.floor(Math.random()*254)+1).join('.');}
async function richFixture(ip=randomIp()){
  const f=await businessFixture(),projectId=f.scope.projectId;
  await db.proxyProviderAccount.create({data:{projectId,code:'fixture',label:'Fixture',credentialCipher:encrypt(JSON.stringify({username:'u',password:'secret'}))}});
  const service=createProxyBatchService(db,{refreshSource:async()=>persistSourceSnapshot(projectId,{id:randomUUID(),sourceKey:'GENJY',hash:'empty-'+projectId,fetchedAt:new Date().toISOString(),scanSucceeded:true,evidence:[]},db)});
  const key=randomUUID(),preview=await service.preview(f.scope,{kind:'NEW',text:ip+':80:u:secret',owner:'SELF',idempotencyKey:key});await service.commit(f.scope,preview.token,key);
  const endpoint=await db.proxyIP.findFirstOrThrow({where:{projectId}});
  await applySdkUpdate(f.scope,{key:randomUUID(),items:[{vmId:f.vm.id,sdk:'sdk-destroy-'+projectId.replace(/-/g,'').slice(0,20),expectedRevision:(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).revision}]},db);
  const gmail=await db.gmailAccount.create({data:{projectId,email:projectId+'@gmail.invalid'}});
  const configuration=await db.vMConfiguration.create({data:{projectId,vmId:f.vm.id,version:1,endpointId:endpoint.id,snapshotCipher:'x',configurationHash:'h',createdById:f.scope.userId}});
  await db.virtualMachine.update({where:{id:f.vm.id},data:{gmailId:gmail.id,proxyId:endpoint.id,desiredConfigurationId:configuration.id,installedConfigurationId:configuration.id}});
  await db.vMProxyAllocation.create({data:{projectId,vmId:f.vm.id,endpointId:endpoint.id,configurationId:configuration.id,allocationKey:endpoint.inventoryKey!,createdById:f.scope.userId}});
  await db.vMTask.create({data:{vmId:f.vm.id,configurationId:configuration.id,type:'INSTALL',title:'t',scheduledAt:new Date()}});
  await db.proxyAssignmentHistory.create({data:{proxyId:endpoint.id,vmId:f.vm.id}});
  await db.costRecord.create({data:{projectId,date:new Date(),total:1,amount:1}});
  await db.businessWorkItem.create({data:{projectId,title:'w',createdById:f.scope.userId,vmId:f.vm.id,serverId:f.server.id}});
  await db.auditLog.create({data:{projectId,userId:f.scope.userId,action:'X',entity:'Project',entityId:projectId}});
  // Payout simplification (28/10/2026): a voided request snapshot and an AI approval session belong to the project too.
  await db.earnPayoutRequestVoid.create({data:{projectId,requestId:'void-'+projectId,vmId:f.vm.id,cycle:1,earnAppId:'ea-'+projectId,paypalEmailId:'em-'+projectId,snapshot:{},reason:'r',voidedById:f.scope.userId}});
  await db.opsApprovalSession.create({data:{projectId,tokenId:'tok-'+projectId,approvedById:f.scope.userId,via:'WEB',expiresAt:new Date(Date.now()+60000)}});
  const identityId=endpoint.identityId!;
  return {...f,projectId,identityId};
}
it('destroyProject removes every row of a PROXY_VM project, including proxies, journal, configurations and SDK history, and leaves other projects untouched',async()=>{
  const a=await richFixture(),b=await richFixture();
  try{
    const result=await destroyProject(db,a.projectId);
    expect(result.deleted).toBe(true);
    expect(await db.project.findUnique({where:{id:a.projectId}})).toBeNull();
    const where={projectId:a.projectId},counts:[string,()=>Promise<number>][]=[['projectMember',()=>db.projectMember.count({where})],['server',()=>db.server.count({where})],['proxyIP',()=>db.proxyIP.count({where})],['proxyProviderAccount',()=>db.proxyProviderAccount.count({where})],['proxySourceSnapshot',()=>db.proxySourceSnapshot.count({where})],['proxyBatch',()=>db.proxyBatch.count({where})],['proxyStatusEvent',()=>db.proxyStatusEvent.count({where})],['operationJournal',()=>db.operationJournal.count({where})],['gmailAccount',()=>db.gmailAccount.count({where})],['costRecord',()=>db.costRecord.count({where})],['vMSdkHistory',()=>db.vMSdkHistory.count({where})],['vMConfiguration',()=>db.vMConfiguration.count({where})],['vMProxyAllocation',()=>db.vMProxyAllocation.count({where})],['auditLog',()=>db.auditLog.count({where})],['businessWorkItem',()=>db.businessWorkItem.count({where})],['earnPayoutRequestVoid',()=>db.earnPayoutRequestVoid.count({where})],['opsApprovalSession',()=>db.opsApprovalSession.count({where})]];
    for(const [table,count] of counts) expect([table,await count()]).toEqual([table,0]);
    expect(await db.virtualMachine.count({where:{id:a.vm.id}})).toBe(0);
    expect(await db.proxyIdentity.findUnique({where:{id:a.identityId}})).toBeNull();
    expect(await db.proxyIP.count({where:{projectId:b.projectId}})).toBe(1);
    expect(await db.proxyIdentity.findUnique({where:{id:b.identityId}})).not.toBeNull();
    expect(await db.vMSdkHistory.count({where:{projectId:b.projectId}})).toBe(1);
  }finally{await destroyProject(db,b.projectId);await db.user.deleteMany({where:{id:{in:[a.scope.userId,a.worker.userId,b.scope.userId,b.worker.userId]}}});}
});
it('deleteProject lets an ADMIN remove an orphan project with no members but not a project administered by others',async()=>{
  const admin=await businessFixture(),orphan=await businessFixture(),other=await businessFixture();
  try{
    await db.projectMember.deleteMany({where:{projectId:orphan.scope.projectId}});
    const api=appRouter.createCaller({prisma:db,session:{user:{id:admin.scope.userId},expires:'2099-01-01'}} as unknown as Context);
    await expect(api.project.deleteProject({projectId:other.scope.projectId})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(await db.project.count({where:{id:other.scope.projectId}})).toBe(1);
    await expect(api.project.deleteProject({projectId:orphan.scope.projectId})).resolves.toMatchObject({deleted:true});
    expect(await db.project.count({where:{id:orphan.scope.projectId}})).toBe(0);
    await expect(api.project.deleteProject({projectId:admin.scope.projectId})).resolves.toMatchObject({deleted:true});
    expect(await db.server.count({where:{projectId:admin.scope.projectId}})).toBe(0);
  }finally{await other.cleanup();await db.user.deleteMany({where:{id:{in:[admin.scope.userId,admin.worker.userId,orphan.scope.userId,orphan.worker.userId]}}});}
});
