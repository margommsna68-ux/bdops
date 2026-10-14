import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {appRouter} from '@/server/routers/_app';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
it('legacy bulk delete cannot unassign another projects VM before checking proxy ownership',async()=>{
  const own=randomUUID(),other=randomUUID(),userId=randomUUID();let serverId:string|undefined;
  try{
    await db.project.createMany({data:[{id:own,code:own,name:'Own'},{id:other,code:other,name:'Other'}]});await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});await db.projectMember.create({data:{userId,projectId:own,role:'ADMIN'}});
    const server=await db.server.create({data:{projectId:other,code:'fixture-server'}});serverId=server.id;
    const proxy=await db.proxyIP.create({data:{projectId:other,address:'192.0.2.95:80'}});const vm=await db.virtualMachine.create({data:{serverId,code:'VM_001',proxyId:proxy.id}});
    const caller=appRouter.createCaller({prisma:db,session:{user:{id:userId},expires:'2099-01-01'} as any});
    await expect(caller.proxy.bulkDelete({projectId:own,ids:[proxy.id]})).rejects.toMatchObject({code:'BAD_REQUEST'});
    expect((await db.virtualMachine.findUniqueOrThrow({where:{id:vm.id}})).proxyId).toBe(proxy.id);
  }finally{await db.auditLog.deleteMany({where:{projectId:{in:[own,other]}}});if(serverId) await db.virtualMachine.deleteMany({where:{serverId}});await db.proxyIP.deleteMany({where:{projectId:other}});await db.server.deleteMany({where:{projectId:other}});await db.projectMember.deleteMany({where:{projectId:own}});await db.project.deleteMany({where:{id:{in:[own,other]}}});await db.user.deleteMany({where:{id:userId}});}
});
