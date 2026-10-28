import {afterAll,it,expect} from 'vitest';
import {randomUUID,randomBytes} from 'node:crypto';
import {businessDB as db,businessFixture} from '../proxy-management/business-fixture';
import {hashToken} from '@/server/ops-api/tokens';
import {withMachineUuid} from '@/server/ops-api/api';
import {machineUuid} from '@/server/dashboard/scan';
import {api} from './ops-fixture';

afterAll(()=>db.$disconnect());

it('withMachineUuid replaces the UUID máy line and keeps the owner notes',()=>{
 const u=randomUUID();
 expect(withMachineUuid('ghi chú\nUUID máy: '+randomUUID()+'\nthêm',u)).toBe('ghi chú\nthêm\nUUID máy: '+u);
 expect(machineUuid(withMachineUuid(null,u.toUpperCase()))).toBe(u);
});

it('POST vms/{id}/recreated follows the web recreate rule, advances the round once and writes the new UUID',async()=>{
 const f=await businessFixture();
 const token='mth_'+randomBytes(32).toString('base64url');
 try{
  await db.user.updateMany({where:{id:f.scope.userId},data:{password:'fixture-only-no-login'}});
  await db.opsToken.create({data:{userId:f.scope.userId,name:'fixture-recreated',prefix:randomUUID(),tokenHash:hashToken(token),projectIds:[f.scope.projectId],scopes:['READ','VM_OPS'],expiresAt:new Date(Date.now()+3600000),createdById:f.scope.userId}});
  const oldUuid=randomUUID(),newUuid=randomUUID(),path='vms/'+f.vm.id+'/recreated';
  await db.virtualMachine.update({where:{id:f.vm.id},data:{notes:'UUID máy: '+oldUuid}});
  // not allowed yet: no payout received, not SUS
  const refused=await api('POST',path,{token,body:{projectId:f.scope.projectId,expectedCycle:1,machineUuid:newUuid},key:randomUUID()});
  expect(refused.status).toBeGreaterThanOrEqual(400);
  expect(machineUuid((await db.virtualMachine.findUnique({where:{id:f.vm.id}}))!.notes)).toBe(oldUuid);
  await db.vmOperation.create({data:{projectId:f.scope.projectId,vmId:f.vm.id,cycle:1,status:'SUSPENDED',statusAt:new Date(),statusById:f.scope.userId}});
  const key=randomUUID(),ok=await api('POST',path,{token,body:{projectId:f.scope.projectId,expectedCycle:1,machineUuid:newUuid},key});
  expect(ok.status).toBe(200);expect(ok.json.data).toMatchObject({machineUuid:newUuid,uuidWritten:true,cycle:2});
  const vm=await db.virtualMachine.findUnique({where:{id:f.vm.id},include:{operation:true}});
  expect(vm!.operation!.cycle).toBe(2);expect(machineUuid(vm!.notes)).toBe(newUuid);
  // replay: same key → same effect, round stays 2, UUID untouched
  const again=await api('POST',path,{token,body:{projectId:f.scope.projectId,expectedCycle:1,machineUuid:newUuid},key});
  expect(again.status).toBe(200);expect(again.json.data).toMatchObject({machineUuid:newUuid,uuidWritten:false,cycle:2});
 }finally{await db.opsAudit.deleteMany({where:{projectId:f.scope.projectId}});await db.opsToken.deleteMany({where:{userId:f.scope.userId}});await f.cleanup();}
});
