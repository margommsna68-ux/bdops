import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {appRouter} from '@/server/routers/_app';
import {encrypt} from '@/lib/encryption';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
async function fixture(){
  const own=randomUUID(),other=randomUUID(),userId=randomUUID(),workerId=randomUUID();
  await db.project.createMany({data:[{id:own,code:own,name:'Legacy'},{id:other,code:other,name:'Managed',settings:{businessMode:'PROXY_VM'}}]});
  await db.user.createMany({data:[{id:userId,email:userId+'@fixture.invalid'},{id:workerId,email:workerId+'@fixture.invalid'}]});
  await db.projectMember.createMany({data:[{userId,projectId:own,role:'ADMIN'},{userId:workerId,projectId:other,role:'USER',allowedModules:['INFRASTRUCTURE']}]});
  const a=await db.server.create({data:{projectId:own,code:'legacy'}}),b=await db.server.create({data:{projectId:other,code:'managed',credentials:encrypt(JSON.stringify({password:'server-secret'}))}});
  const av=await db.virtualMachine.create({data:{serverId:a.id,code:'VM_001'}}),bv=await db.virtualMachine.create({data:{serverId:b.id,code:'VM_001'}});
  const identity=await db.proxyIdentity.create({data:{ip:'192.0.2.171',owner:'GENJY'}});
  const proxy=await db.proxyIP.create({data:{projectId:other,identityId:identity.id,address:'192.0.2.171:80',host:'192.0.2.171',port:80,status:'RESERVED',inventoryState:'BLOCKED',inventoryKey:identity.id}});
  await db.proxyStatusEvent.create({data:{projectId:other,identityId:identity.id,endpointId:proxy.id,ip:identity.ip,kind:'BLOCKED',occurredAt:null}});
  const caller=(id=userId)=>appRouter.createCaller({prisma:db,session:{user:{id},expires:'2099-01-01'} as any});
  const cleanup=async()=>{
    await db.deleteRequest.deleteMany({where:{projectId:{in:[own,other]}}});await db.auditLog.deleteMany({where:{projectId:{in:[own,other]}}});await db.vMTask.deleteMany({where:{vm:{server:{projectId:{in:[own,other]}}}}});await db.vmOpsEvent.deleteMany({where:{projectId:{in:[own,other]}}});await db.vmOperation.deleteMany({where:{projectId:{in:[own,other]}}});await db.virtualMachine.deleteMany({where:{server:{projectId:{in:[own,other]}}}});await db.proxyStatusEvent.deleteMany({where:{projectId:other}});await db.proxyIP.deleteMany({where:{projectId:{in:[own,other]}}});await db.proxyIdentity.deleteMany({where:{id:identity.id}});await db.server.deleteMany({where:{projectId:{in:[own,other]}}});await db.projectMember.deleteMany({where:{projectId:{in:[own,other]}}});await db.project.deleteMany({where:{id:{in:[own,other]}}});await db.user.deleteMany({where:{id:{in:[userId,workerId]}}});
  };
  return {own,other,userId,workerId,a,b,av,bv,proxy,caller,cleanup};
}
it('legacy routes cannot assign a foreign managed proxy or mutate a foreign server VM',async()=>{
  const f=await fixture();try{
    await expect(f.caller().vm.bulkAssignSelected({projectId:f.own,vmIds:[f.av.id],field:'proxy',itemIds:[f.proxy.id]})).rejects.toMatchObject({code:'BAD_REQUEST'});
    expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.av.id}})).proxyId).toBeNull();expect((await db.proxyIP.findUniqueOrThrow({where:{id:f.proxy.id}})).status).toBe('RESERVED');
    const legacy=await db.proxyIP.create({data:{projectId:f.own,address:'192.0.2.172:80'}});
    await expect(f.caller().vm.bulkPaste({projectId:f.own,serverId:f.b.id,field:'proxy',values:['192.0.2.172']})).rejects.toMatchObject({code:'BAD_REQUEST'});
    expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.bv.id}})).proxyId).toBeNull();expect((await db.proxyIP.findUniqueOrThrow({where:{id:legacy.id}})).status).toBe('AVAILABLE');
  }finally{await f.cleanup();}
});
it('foreign infrastructure delete requests are rejected both on create and on approval',async()=>{
  const f=await fixture();try{
    await expect(f.caller().deleteRequest.create({projectId:f.own,entity:'Server',entityId:f.b.id})).rejects.toMatchObject({code:'BAD_REQUEST'});
    const request=await db.deleteRequest.create({data:{projectId:f.own,requestedById:f.userId,entity:'VirtualMachine',entityId:f.bv.id}});
    await expect(f.caller().deleteRequest.approve({projectId:f.own,id:request.id})).rejects.toMatchObject({code:'BAD_REQUEST'});
    expect((await db.deleteRequest.findUniqueOrThrow({where:{id:request.id}})).status).toBe('PENDING');expect(await db.virtualMachine.findUnique({where:{id:f.bv.id}})).not.toBeNull();
  }finally{await f.cleanup();}
});
it('managed project wipe rejects before any data is removed; full deletion needs its ADMIN and then removes every related row',async()=>{
  const f=await fixture();try{
    await db.projectMember.create({data:{projectId:f.other,userId:f.userId,role:'ADMIN'}});
    await expect(f.caller().project.wipeProjectData({projectId:f.other})).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
    expect(await db.virtualMachine.findUnique({where:{id:f.bv.id}})).not.toBeNull();
    await expect(f.caller(f.workerId).project.deleteProject({projectId:f.other})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(await db.virtualMachine.findUnique({where:{id:f.bv.id}})).not.toBeNull();expect(await db.proxyStatusEvent.count({where:{projectId:f.other}})).toBe(1);
    await expect(f.caller().project.deleteProject({projectId:f.other})).resolves.toMatchObject({deleted:true,name:'Managed'});
    expect(await db.virtualMachine.findUnique({where:{id:f.bv.id}})).toBeNull();expect(await db.proxyStatusEvent.count({where:{projectId:f.other}})).toBe(0);expect(await db.proxyIP.count({where:{projectId:f.other}})).toBe(0);expect(await db.project.findUnique({where:{id:f.other}})).toBeNull();
    expect(await db.virtualMachine.findUnique({where:{id:f.av.id}})).not.toBeNull();
  }finally{await f.cleanup();}
});
it('project administrators can grant/revoke proxy capabilities without editing foreign memberships',async()=>{
  const f=await fixture();try{
    await db.projectMember.create({data:{projectId:f.other,userId:f.userId,role:'ADMIN'}});
    const member=await db.projectMember.findUniqueOrThrow({where:{userId_projectId:{userId:f.workerId,projectId:f.other}}});
    await db.projectMember.update({where:{id:member.id},data:{allowedModules:[]}});
    await f.caller().proxyManagement.setCapabilities({projectId:f.other,memberId:member.id,capabilities:['COPY_CREDENTIALS','PROXY_IMPORT','PROXY_REPLACE'],allowInfrastructure:true});
    expect((await f.caller(f.workerId).proxyManagement.access({projectId:f.other})).canCopy).toBe(true);
    await expect(f.caller(f.workerId).proxyManagement.setCapabilities({projectId:f.other,memberId:member.id,capabilities:[]})).rejects.toMatchObject({code:'FORBIDDEN'});
    await f.caller().proxyManagement.setCapabilities({projectId:f.other,memberId:member.id,capabilities:[]});
    expect((await f.caller(f.workerId).proxyManagement.access({projectId:f.other})).canImport).toBe(false);
    await expect(f.caller().project.updateMember({projectId:f.own,memberId:member.id,role:'ADMIN'})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(f.caller().proxyManagement.setCapabilities({projectId:f.own,memberId:member.id,capabilities:['COPY_CREDENTIALS']})).rejects.toMatchObject({code:'FORBIDDEN'});
  }finally{await f.cleanup();}
});
it('VIEWER cannot fetch server credentials through the old server route',async()=>{
  const f=await fixture();try{
    await db.projectMember.update({where:{userId_projectId:{userId:f.workerId,projectId:f.other}},data:{role:'VIEWER'}});
    await expect(f.caller(f.workerId).server.getCredentials({projectId:f.other,id:f.b.id})).rejects.toMatchObject({code:'FORBIDDEN'});
  }finally{await f.cleanup();}
});
