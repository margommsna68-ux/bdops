import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {testClient} from './db-fixture';
import {runBusinessCommand} from '@/server/business-management/idempotency';
import {listOperations,inspectOperation} from '@/server/operation-history/journal';
import {undoOperation} from '@/server/operation-history/undo';
import type {ActorScope} from '@/server/proxy-management/types';
const db=testClient();afterAll(()=>db.$disconnect());
it('financial journal is module scoped and commands replay without duplicate money records',async()=>{
  const projectId=randomUUID(),userId=randomUUID(),workerId=randomUUID();await db.project.create({data:{id:projectId,code:projectId,name:'Business journal fixture',settings:{businessMode:'PROXY_VM'}}});await db.user.createMany({data:[{id:userId,email:userId+'@fixture.invalid'},{id:workerId,email:workerId+'@fixture.invalid'}]});await db.projectMember.createMany({data:[{projectId,userId,role:'ADMIN'},{projectId,userId:workerId,role:'USER',allowedModules:['INFRASTRUCTURE']}]});
  const scope:ActorScope={projectId,userId,role:'ADMIN',capabilities:[]},worker={...scope,userId:workerId};
  const key=randomUUID(),cmd={key,payload:{amount:'3.50'},kind:'BUSINESS_COST',module:'COSTS' as const};
  const write=()=>runBusinessCommand(scope,cmd,async(tx,images)=>{const row=await tx.costRecord.create({data:{projectId,date:new Date('2026-10-14T00:00:00+07:00'),amount:'3.50',total:'3.50',businessManaged:true}});await images.remember('COST',row.id,true);return {id:row.id};},db);
  try{
    const first=await write(),replay=await write();expect(replay).toMatchObject({id:first.id,replay:true});expect(await db.costRecord.count({where:{projectId}})).toBe(1);
    const op=(await listOperations(scope,db))[0];expect(op.kind).toBe('BUSINESS_COST');expect(await listOperations(worker,db)).toEqual([]);await expect(inspectOperation(worker,op.id,db)).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(runBusinessCommand(scope,{...cmd,payload:{amount:'4.00'}},async()=>({id:'bad'}),db)).rejects.toMatchObject({code:'KEY_PAYLOAD_MISMATCH'});
    await expect(runBusinessCommand(worker,{...cmd,key:randomUUID()},async()=>({id:'bad'}),db)).rejects.toMatchObject({code:'FORBIDDEN'});
    await undoOperation(scope,op.id,'Entered wrong expense',db);expect((await db.costRecord.findUniqueOrThrow({where:{id:first.id}})).voidedAt).not.toBeNull();expect(await write()).toMatchObject({undone:true});expect(await listOperations(worker,db)).toEqual([]);
  }finally{await db.costRecord.deleteMany({where:{projectId}});await db.auditLog.deleteMany({where:{projectId}});await db.projectMember.deleteMany({where:{projectId}});await db.project.delete({where:{id:projectId}});await db.user.deleteMany({where:{id:{in:[userId,workerId]}}});}
});
