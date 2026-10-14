import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {appRouter} from '@/server/routers/_app';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
it('blocks legacy proxy/VM writers in the personal workspace before any write',async()=>{
  const projectId=randomUUID(),userId=randomUUID();
  try{
    await db.project.create({data:{id:projectId,code:projectId,name:'Fixture',settings:{businessMode:'PROXY_VM'}}});await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});await db.projectMember.create({data:{projectId,userId,role:'ADMIN'}});
    const caller=appRouter.createCaller({prisma:db,session:{user:{id:userId},expires:'2099-01-01'} as any});
    for(const fn of [()=>caller.proxy.update({projectId,id:'not-real',address:'192.0.2.1'}),()=>caller.proxy.autoAssign({projectId}),()=>caller.proxy.bulkDelete({projectId,ids:['foreign']}),()=>caller.vm.assignProxy({projectId,vmId:'foreign',proxyId:'foreign'}),()=>caller.vm.autoFill({projectId,vmId:'foreign'})]) await expect(fn()).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
    expect(await db.proxyIP.count({where:{projectId}})).toBe(0);
  }finally{await db.auditLog.deleteMany({where:{projectId}});await db.projectMember.deleteMany({where:{projectId}});await db.project.deleteMany({where:{id:projectId}});await db.user.deleteMany({where:{id:userId}});}
});
