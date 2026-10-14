import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {appRouter} from '@/server/routers/_app';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
it('real tRPC caller refreshes membership and denies viewer writes/copy, foreign IDs and module-less moderators',async()=>{
  const projectId=randomUUID(),userId=randomUUID();
  try{
    await db.project.create({data:{id:projectId,code:projectId,name:'Fixture',settings:{businessMode:'PROXY_VM'}}});await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});await db.projectMember.create({data:{projectId,userId,role:'VIEWER',allowedModules:['INFRASTRUCTURE']}});
    const caller=appRouter.createCaller({prisma:db,session:{user:{id:userId,memberships:[{projectId,role:'ADMIN',capabilities:['COPY_CREDENTIALS']}]},expires:'2099-01-01'} as any});
    expect((await caller.proxyManagement.list({projectId,view:'CURRENT',limit:50})).rows).toEqual([]);
    await expect(caller.proxyManagement.preview({projectId,kind:'BLOCKED',text:'192.0.2.94',idempotencyKey:randomUUID()})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(caller.proxyManagement.exportBlocked({projectId})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(caller.proxyManagement.saveCatalog({projectId,code:'fake',label:'Fake',username:'fake',password:'fake'})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(caller.proxy.autoAssign({projectId})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(caller.proxyManagement.list({projectId:randomUUID(),view:'CURRENT',limit:50})).rejects.toMatchObject({code:'FORBIDDEN'});
    await db.projectMember.update({where:{userId_projectId:{userId,projectId}},data:{role:'MODERATOR',allowedModules:[]}});
    await expect(caller.proxyManagement.preview({projectId,kind:'NEW',text:'192.0.2.94:80:fake:fake',idempotencyKey:randomUUID()})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(await db.proxyBatch.count({where:{projectId}})).toBe(0);
  }finally{await db.proxyProviderAccount.deleteMany({where:{projectId}});await db.projectMember.deleteMany({where:{projectId}});await db.project.deleteMany({where:{id:projectId}});await db.user.deleteMany({where:{id:userId}});}
});
