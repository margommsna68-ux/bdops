import {afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from '../proxy-management/business-fixture';
import {createFleetCommand,claimFleetCommand,stepFleetCommand,completeFleetCommand,readFleetControl} from '@/server/fleet-commands/service';

afterAll(()=>db.$disconnect());
// Operational actions (28/10/2026): server-level enrollment, evidence detail, per-action preconditions.
async function fixture(){
 const f=await businessFixture(),machineUuid=randomUUID(),serverUuid=randomUUID(),workerId=randomUUID();
 const old={ready:process.env.FLEET_CONTROL_M1_READY,canary:process.env.FLEET_CONTROL_CANARY,servers:process.env.FLEET_CONTROL_SERVERS};
 const vm=await db.virtualMachine.update({where:{id:f.vm.id},data:{notes:'UUID máy: '+machineUuid}});
 await db.user.updateMany({where:{id:{in:[f.scope.userId,f.worker.userId]}},data:{password:'fixture-only-no-login'}});
 process.env.FLEET_CONTROL_M1_READY='1';delete process.env.FLEET_CONTROL_CANARY;
 process.env.FLEET_CONTROL_SERVERS=JSON.stringify([{projectId:f.scope.projectId,serverId:f.server.id,serverUuid}]);
 const input=(action:string)=>({projectId:f.scope.projectId,operationId:randomUUID(),serverId:f.server.id,vmId:f.vm.id,machineUuid,expectedCycle:1,expectedVmRevision:vm.revision,configurationId:null,action,ttlSeconds:300});
 const claim=()=>claimFleetCommand(f.worker,{projectId:f.scope.projectId,serverId:f.server.id,workerId},db);
 const dispatch=async(operationId:string)=>{const c=await claim();const r=await stepFleetCommand(f.worker,{projectId:f.scope.projectId,operationId,workerId,leaseEpoch:c.command!.leaseEpoch,stepId:randomUUID(),phase:'DISPATCH'},db);return {leaseEpoch:c.command!.leaseEpoch,permit:r.permit};};
 const completion=(operationId:string,leaseEpoch:number,evidence:Record<string,unknown>,outcome='SUCCEEDED')=>({projectId:f.scope.projectId,operationId,workerId,leaseEpoch,completionId:randomUUID(),outcome,evidence:{operationId,aeOperationId:operationId,machineUuid,verified:true,observedAt:new Date().toISOString(),vmState:'RUNNING',...evidence}});
 const cleanup=async()=>{
  await db.fleetCommandEvent.deleteMany({where:{command:{projectId:f.scope.projectId}}});await db.fleetCommand.deleteMany({where:{projectId:f.scope.projectId}});
  for(const [key,value] of Object.entries({FLEET_CONTROL_M1_READY:old.ready,FLEET_CONTROL_CANARY:old.canary,FLEET_CONTROL_SERVERS:old.servers})){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await f.cleanup();
 };
 return {...f,vmRow:vm,machineUuid,serverUuid,workerId,input,claim,dispatch,completion,cleanup};
}

it('server-level enrollment admits any verified VM of the server and refuses foreign servers / missing UUID',async()=>{
 const f=await fixture();try{
  const b=f.input('CHECK_HEALTH');
  expect(await createFleetCommand(f.worker,b,db)).toMatchObject({state:'QUEUED',serverUuid:f.serverUuid,vmCode:f.vm.code});
  process.env.FLEET_CONTROL_SERVERS=JSON.stringify([{projectId:f.scope.projectId,serverId:'other-server',serverUuid:f.serverUuid}]);
  await expect(createFleetCommand(f.worker,{...f.input('CHECK_HEALTH')},db)).rejects.toMatchObject({code:'FORBIDDEN'});
  process.env.FLEET_CONTROL_SERVERS=JSON.stringify([{projectId:f.scope.projectId,serverId:f.server.id,serverUuid:f.serverUuid}]);
  await db.virtualMachine.update({where:{id:f.vm.id},data:{notes:'no uuid here'}});
  await expect(createFleetCommand(f.worker,{...f.input('CHECK_HEALTH'),operationId:randomUUID()},db)).rejects.toBeTruthy();
 }finally{await f.cleanup();}
});

it('READ_SDK completes only with a DONE detail carrying the SDK tail, never the code',async()=>{
 const f=await fixture();try{
  const b=f.input('READ_SDK');await createFleetCommand(f.worker,b,db);
  const {leaseEpoch,permit}=await f.dispatch(b.operationId);expect(permit?.action).toBe('READ_SDK');
  await expect(completeFleetCommand(f.worker,f.completion(b.operationId,leaseEpoch,{}),db)).rejects.toMatchObject({code:'INVALID_INPUT'});
  await expect(completeFleetCommand(f.worker,f.completion(b.operationId,leaseEpoch,{detail:{code:'DONE',message:'ok',sdkTail:'0123456789abcdef0123456789abcdef'}}),db)).rejects.toBeTruthy();
  const r=await completeFleetCommand(f.worker,f.completion(b.operationId,leaseEpoch,{detail:{code:'DONE',message:'Lấy SDK: 1 ok',sdkTail:'ad3f'}}),db);
  expect(r.state).toBe('SUCCEEDED');expect(r.result).toMatchObject({evidence:{detail:{code:'DONE',sdkTail:'ad3f'}}});
 }finally{await f.cleanup();}
});

it('REPLACE_PROXY needs the web "Chờ áp dụng proxy" mark; RECREATE_VM needs the recreate rule; control lists only allowed actions',async()=>{
 const f=await fixture();try{
  await expect(createFleetCommand(f.scope,f.input('REPLACE_PROXY'),db)).rejects.toMatchObject({code:'INVALID_INPUT'});
  await expect(createFleetCommand(f.scope,f.input('RECREATE_VM'),db)).rejects.toMatchObject({code:'INVALID_INPUT'});
  const control=await readFleetControl(f.scope,{projectId:f.scope.projectId,serverId:f.server.id,vmId:f.vm.id},db);
  expect(control.capability?.actions).toEqual(expect.arrayContaining(['START_VM','CHECK_HEALTH','READ_SDK']));
  expect(control.capability?.actions).not.toContain('REPLACE_PROXY');expect(control.capability?.actions).not.toContain('RECREATE_VM');
  // worker (USER without MANAGE) may only read-type actions
  const w=await readFleetControl(f.worker,{projectId:f.scope.projectId,serverId:f.server.id,vmId:f.vm.id},db);
  expect(w.capability?.actions).toEqual(expect.arrayContaining(['CHECK_HEALTH','READ_SDK']));expect(w.capability?.actions).not.toContain('START_VM');
 }finally{await f.cleanup();}
});

it('RECREATE_VM success needs RECREATED + a different new machine UUID',async()=>{
 const f=await fixture();try{
  await db.vmOperation.create({data:{projectId:f.scope.projectId,vmId:f.vm.id,cycle:1,status:'SUSPENDED',statusAt:new Date(),statusById:f.scope.userId}});
  const b=f.input('RECREATE_VM');await createFleetCommand(f.scope,b,db);
  const {leaseEpoch}=await f.dispatch(b.operationId);
  await expect(completeFleetCommand(f.worker,f.completion(b.operationId,leaseEpoch,{detail:{code:'RECREATED',message:'x',newMachineUuid:f.machineUuid}}),db)).rejects.toMatchObject({code:'INVALID_INPUT'});
  const fresh=randomUUID(),r=await completeFleetCommand(f.worker,f.completion(b.operationId,leaseEpoch,{vmState:'POWERED_OFF',detail:{code:'RECREATED',message:'Tạo lại xong',newMachineUuid:fresh}}),db);
  expect(r.state).toBe('SUCCEEDED');expect(r.result).toMatchObject({evidence:{detail:{newMachineUuid:fresh}}});
 }finally{await f.cleanup();}
});
