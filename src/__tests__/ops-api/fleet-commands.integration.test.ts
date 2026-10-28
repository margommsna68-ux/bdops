import {afterAll,it,expect,vi} from 'vitest';
import type {Prisma} from '@prisma/client';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {businessDB as db,businessFixture} from '../proxy-management/business-fixture';
import {createFleetCommand,claimFleetCommand,stepFleetCommand,renewFleetCommand,completeFleetCommand,cancelFleetCommand,readFleetCommand,readFleetControl,readFleetServers,authorizeNativeFleetCommand,nativeCommandHash} from '@/server/fleet-commands/service';
import {createTelegramFleetHandler} from '@/server/fleet-commands/telegram';
import {telegramBindingHash,telegramOwner} from '@/server/fleet-commands/telegram-binding';
import {hashToken} from '@/server/ops-api/tokens';
import {api} from './ops-fixture';
import {fleetCommandsRouter} from '@/server/routers/fleetCommands';
import {assertServerWebRequest} from '@/server/permissions/server-web-policy';
import {router} from '@/server/trpc';
import {runWithOpsAuth} from '@/server/ops-api/context';

afterAll(()=>db.$disconnect());
async function fixture(){
 const f=await businessFixture(),machineUuid=randomUUID(),serverUuid=randomUUID(),workerId=randomUUID();
 const old={ready:process.env.FLEET_CONTROL_M1_READY,canary:process.env.FLEET_CONTROL_CANARY};
 const vm=await db.virtualMachine.update({where:{id:f.vm.id},data:{notes:'UUID máy: '+machineUuid}});
 await db.user.updateMany({where:{id:{in:[f.scope.userId,f.worker.userId]}},data:{password:'fixture-only-no-login'}});
 const enrollment={projectId:f.scope.projectId,serverId:f.server.id,serverUuid,vmId:f.vm.id,machineUuid,expectedCycle:1,configurationId:null};
 process.env.FLEET_CONTROL_M1_READY='1';process.env.FLEET_CONTROL_CANARY=JSON.stringify([enrollment]);
 const input=()=>({projectId:f.scope.projectId,operationId:randomUUID(),serverId:f.server.id,vmId:f.vm.id,machineUuid,expectedCycle:1,expectedVmRevision:vm.revision,configurationId:null,action:'START_VM' as const,ttlSeconds:300});
 const claim=()=>claimFleetCommand(f.worker,{projectId:f.scope.projectId,serverId:f.server.id,workerId},db);
 const step=(operationId:string,leaseEpoch:number,phase:'DISPATCH'|'PROGRESS'='DISPATCH',stepId=randomUUID())=>stepFleetCommand(f.worker,{projectId:f.scope.projectId,operationId,workerId,leaseEpoch,stepId,phase},db);
 const cleanup=async()=>{
  await db.fleetCommandEvent.deleteMany({where:{command:{projectId:f.scope.projectId}}});await db.fleetCommand.deleteMany({where:{projectId:f.scope.projectId}});
  await db.opsToken.deleteMany({where:{userId:{in:[f.scope.userId,f.worker.userId]}}});
  for(const [key,value] of Object.entries({FLEET_CONTROL_M1_READY:old.ready,FLEET_CONTROL_CANARY:old.canary})){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await f.cleanup();
 };
 return {...f,machineUuid,serverUuid,workerId,enrollment,input,claim,step,cleanup};
}

it('fails closed before M1 or without exact enrollment; refuses arbitrary actions and caller server identity',async()=>{
 const f=await fixture();try{
  delete process.env.FLEET_CONTROL_M1_READY;await expect(createFleetCommand(f.scope,f.input(),db)).rejects.toBeTruthy();
  process.env.FLEET_CONTROL_M1_READY='1';process.env.FLEET_CONTROL_CANARY='[]';await expect(createFleetCommand(f.scope,f.input(),db)).rejects.toBeTruthy();
  process.env.FLEET_CONTROL_CANARY=JSON.stringify([f.enrollment]);
  for(const extra of [{action:'RESET_VM'},{machineUuid:randomUUID()},{serverId:'other'},{expectedCycle:2},{configurationId:'other'},{command:'powershell'}])await expect(createFleetCommand(f.scope,{...f.input(),...extra},db)).rejects.toBeTruthy();
  expect(await db.fleetCommand.count({where:{projectId:f.scope.projectId}})).toBe(0);
 }finally{await f.cleanup();}
});

it('stores immutable operation identity, exact binding and no financial/lifecycle writes; power needs MANAGE',async()=>{
 const f=await fixture();try{
  const b=f.input(),first=await createFleetCommand(f.scope,b,db),again=await createFleetCommand(f.scope,b,db);
  expect(first).toMatchObject({operationId:b.operationId,state:'QUEUED',serverUuid:f.serverUuid,vmCode:f.vm.code,machineUuid:f.machineUuid});
  expect(again).toEqual(first);
  await expect(createFleetCommand(f.scope,{...b,action:'POWER_OFF_VM'},db)).rejects.toMatchObject({code:'KEY_PAYLOAD_MISMATCH'});
  await expect(createFleetCommand(f.worker,f.input(),db)).rejects.toMatchObject({code:'FORBIDDEN'});
  expect(await db.vmOperation.count({where:{projectId:f.scope.projectId}})).toBe(0);
  expect(await db.fundTransaction.count({where:{projectId:f.scope.projectId}})).toBe(0);
 }finally{await f.cleanup();}
});

it('fences a dead pre-dispatch lease, returns a dispatch permit once, never reissues it on lost ACK',async()=>{
 const f=await fixture();try{
  const b=f.input();await createFleetCommand(f.scope,b,db);const a=await f.claim();expect(a.command?.state).toBe('CLAIMED');
  await db.fleetCommand.update({where:{operationId:b.operationId},data:{leaseUntil:new Date(Date.now()-1000)}});
  const c=await f.claim();expect(c.command!.leaseEpoch).toBe(a.command!.leaseEpoch+1);
  await expect(f.step(b.operationId,a.command!.leaseEpoch)).rejects.toBeTruthy();
  const stepId=randomUUID(),r=await f.step(b.operationId,c.command!.leaseEpoch,'DISPATCH',stepId);
  expect(r.permit).toMatchObject({operationId:b.operationId,leaseEpoch:c.command!.leaseEpoch,machineUuid:f.machineUuid});
  expect((await f.step(b.operationId,c.command!.leaseEpoch,'DISPATCH',stepId)).permit).toBeNull();
  await expect(f.step(b.operationId,c.command!.leaseEpoch,'PROGRESS',stepId)).rejects.toMatchObject({code:'KEY_PAYLOAD_MISMATCH'});
 }finally{await f.cleanup();}
});

it('rechecks requester token/member rights, canary and cycle before the dispatch boundary',async()=>{
 const f=await fixture();try{
  const token=await db.opsToken.create({data:{userId:f.scope.userId,name:'fixture-command',prefix:randomUUID(),tokenHash:hashToken(randomUUID()),projectIds:[f.scope.projectId],scopes:['VM_OPS'],expiresAt:new Date(Date.now()+3600000),createdById:f.scope.userId}});
  const b=f.input();await createFleetCommand(f.scope,b,db,{tokenId:token.id,source:'OPS'});const c=await f.claim();
  await db.opsToken.update({where:{id:token.id},data:{revokedAt:new Date()}});
  await expect(f.step(b.operationId,c.command!.leaseEpoch)).rejects.toMatchObject({reason:'TOKEN_REVOKED'});
  expect((await readFleetCommand(f.scope,{projectId:f.scope.projectId,operationId:b.operationId},db)).dispatchedAt).toBeNull();
  await db.opsToken.update({where:{id:token.id},data:{revokedAt:null}});
  await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.scope.userId},data:{role:'VIEWER',allowedModules:['INFRASTRUCTURE']}});
  await expect(f.step(b.operationId,c.command!.leaseEpoch)).rejects.toMatchObject({code:'FORBIDDEN'});
  await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.scope.userId},data:{role:'ADMIN'}});
  process.env.FLEET_CONTROL_CANARY='[]';await expect(f.step(b.operationId,c.command!.leaseEpoch)).rejects.toBeTruthy();
  process.env.FLEET_CONTROL_CANARY=JSON.stringify([f.enrollment]);
  await db.vmOperation.create({data:{projectId:f.scope.projectId,vmId:f.vm.id,cycle:2}});
  await expect(f.step(b.operationId,c.command!.leaseEpoch)).rejects.toBeTruthy();
 }finally{await f.cleanup();}
});

it('rechecks worker/server scope and TTL, and cancelled queued work never dispatches',async()=>{
 const f=await fixture();try{
  const b=f.input();await createFleetCommand(f.scope,b,db);const c=await f.claim();
  await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.worker.userId},data:{serverScope:'SELECTED',allowedServerIds:[]}});
  await expect(f.step(b.operationId,c.command!.leaseEpoch)).rejects.toBeTruthy();
  await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.worker.userId},data:{serverScope:'ALL'}});
  await db.fleetCommand.update({where:{operationId:b.operationId},data:{expiresAt:new Date(Date.now()-1000)}});
  await expect(f.step(b.operationId,c.command!.leaseEpoch)).rejects.toBeTruthy();
  const cancelled=await cancelFleetCommand(f.scope,{projectId:f.scope.projectId,operationId:b.operationId},db);expect(['EXPIRED','CANCELLED']).toContain(cancelled.state);
  expect((await f.claim()).command).toBeNull();
 }finally{await f.cleanup();}
});

it('the crash AFTER AE effect but BEFORE completion remains UNKNOWN and only reconciliation may claim it',async()=>{
 const f=await fixture();try{
  const b=f.input();await createFleetCommand(f.scope,b,db);const c=await f.claim();const sent=await f.step(b.operationId,c.command!.leaseEpoch);
  expect(sent.permit).not.toBeNull();let realEffects=0;realEffects++; // isolated AE boundary harness: effect occurs, response is lost
  await db.fleetCommand.update({where:{operationId:b.operationId},data:{leaseUntil:new Date(Date.now()-1000),expiresAt:new Date(Date.now()-1000)}});
  expect((await readFleetCommand(f.scope,{projectId:b.projectId,operationId:b.operationId},db)).state).toBe('UNKNOWN');
  const recovery=await f.claim();expect(recovery).toMatchObject({reconciliationOnly:true,command:{state:'UNKNOWN',operationId:b.operationId}});
  await expect(f.step(b.operationId,recovery.command!.leaseEpoch)).rejects.toBeTruthy();
  expect(realEffects).toBe(1);
  const done={projectId:f.scope.projectId,operationId:b.operationId,workerId:f.workerId,leaseEpoch:recovery.command!.leaseEpoch,completionId:randomUUID(),outcome:'SUCCEEDED' as const,
   evidence:{operationId:b.operationId,aeOperationId:b.operationId,machineUuid:f.machineUuid,verified:true,observedAt:new Date().toISOString(),vmState:'RUNNING' as const}};
  const r=await completeFleetCommand(f.worker,done,db);expect(r.state).toBe('SUCCEEDED');expect(await completeFleetCommand(f.worker,done,db)).toEqual(r);
  await db.fleetCommand.update({where:{operationId:b.operationId},data:{leaseUntil:new Date(Date.now()-1000)}});
  expect(await completeFleetCommand(f.worker,done,db)).toMatchObject({state:'SUCCEEDED',result:r.result});
  await expect(completeFleetCommand(f.worker,{...done,outcome:'FAILED'},db)).rejects.toMatchObject({code:'KEY_PAYLOAD_MISMATCH'});
 }finally{await f.cleanup();}
});

it.each([
 ['SHUTDOWN_VM','POWERED_OFF'],['POWER_OFF_VM','POWERED_OFF'],['CHECK_HEALTH','PAUSED'],
] as const)('completes only verified compatible evidence for %s without changing VM or money state',async(action,vmState)=>{
 const f=await fixture();try{
  const b={...f.input(),action},requester=action==='CHECK_HEALTH'?f.worker:f.scope;
  await createFleetCommand(requester,b,db);const c=await f.claim();expect((await f.step(b.operationId,c.command!.leaseEpoch)).permit?.action).toBe(action);
  const body={projectId:b.projectId,operationId:b.operationId,workerId:f.workerId,leaseEpoch:c.command!.leaseEpoch,completionId:randomUUID(),outcome:'SUCCEEDED',evidence:{operationId:b.operationId,aeOperationId:b.operationId,machineUuid:f.machineUuid,verified:true,observedAt:new Date().toISOString(),vmState}};
  if(action!=='CHECK_HEALTH')await expect(completeFleetCommand(f.worker,{...body,evidence:{...body.evidence,vmState:'RUNNING'}},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
  expect((await completeFleetCommand(f.worker,body,db)).state).toBe('SUCCEEDED');
  expect(await db.vmOperation.count({where:{projectId:b.projectId}})).toBe(0);expect(await db.fundTransaction.count({where:{projectId:b.projectId}})).toBe(0);
 }finally{await f.cleanup();}
});

it('cancels queued work definitively and cannot accept an invented completion before dispatch',async()=>{
 const f=await fixture();try{
  const b=f.input();await createFleetCommand(f.scope,b,db);
  const result=await cancelFleetCommand(f.scope,{projectId:b.projectId,operationId:b.operationId},db);expect(result.state).toBe('CANCELLED');
  expect(await db.auditLog.findFirst({where:{projectId:b.projectId,action:'FLEET_CANCEL',entityId:b.operationId},select:{userId:true}})).toEqual({userId:f.scope.userId});
  expect((await f.claim()).command).toBeNull();
  await expect(stepFleetCommand(f.worker,{projectId:b.projectId,operationId:b.operationId,workerId:f.workerId,leaseEpoch:1,stepId:randomUUID(),phase:'DISPATCH'},db)).rejects.toBeTruthy();
 }finally{await f.cleanup();}
});

it('exposes bounded progress on detail and serializes competing claims without duplicate permits',async()=>{
 const f=await fixture();try{
  const b=f.input();await createFleetCommand(f.scope,b,db);
  const claims=await Promise.all([f.claim(),f.claim()]);expect(claims.filter(c=>c.command)).toHaveLength(1);
  const command=claims.find(c=>c.command)!.command!;
  const sent=await f.step(b.operationId,command.leaseEpoch);expect(sent.permit).not.toBeNull();
  const detail=await readFleetCommand(f.scope,{projectId:b.projectId,operationId:b.operationId},db);
  expect(detail).toHaveProperty('events');expect((detail as typeof detail&{events:{kind:string}[]}).events.map(e=>e.kind)).toEqual(['DISPATCH']);
 }finally{await f.cleanup();}
});

it('refuses incoherent physical-server enrollment even when one VM entry otherwise matches',async()=>{
 const f=await fixture();try{
  process.env.FLEET_CONTROL_CANARY=JSON.stringify([f.enrollment,{...f.enrollment,vmId:'another-vm',machineUuid:randomUUID(),serverUuid:randomUUID()}]);
  await expect(createFleetCommand(f.scope,f.input(),db)).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();}
});

it('post-dispatch cancellation is only requested; mismatched or unverified success cannot become green',async()=>{
 const f=await fixture();try{
  const b=f.input();await createFleetCommand(f.scope,b,db);const c=await f.claim();await f.step(b.operationId,c.command!.leaseEpoch);
  const cancelled=await cancelFleetCommand(f.scope,{projectId:f.scope.projectId,operationId:b.operationId},db);expect(cancelled.state).toBe('DISPATCHED');expect(cancelled.cancelRequestedAt).toBeTruthy();
  const base={projectId:f.scope.projectId,operationId:b.operationId,workerId:f.workerId,leaseEpoch:c.command!.leaseEpoch,completionId:randomUUID(),outcome:'SUCCEEDED',evidence:{operationId:b.operationId,aeOperationId:b.operationId,machineUuid:f.machineUuid,verified:false,observedAt:new Date().toISOString(),vmState:'RUNNING'}};
  await expect(completeFleetCommand(f.worker,base,db)).rejects.toBeTruthy();
  await expect(completeFleetCommand(f.worker,{...base,evidence:{...base.evidence,verified:true,machineUuid:randomUUID()}},db)).rejects.toBeTruthy();
  await expect(completeFleetCommand(f.worker,{...base,evidence:{...base.evidence,verified:true,vmState:'POWERED_OFF'}},db)).rejects.toBeTruthy();
  await db.user.update({where:{id:f.scope.userId},data:{disabledAt:new Date()}});
  const r=await completeFleetCommand(f.worker,{...base,evidence:{...base.evidence,verified:true}},db);expect(r.state).toBe('SUCCEEDED');
  expect(await db.vmOperation.count({where:{projectId:f.scope.projectId}})).toBe(0);
 }finally{await f.cleanup();}
});

it('renewal is fenced, bounded progress cannot grow forever, and another command cannot overlap UNKNOWN VM work',async()=>{
 const f=await fixture();try{
  const b=f.input();await createFleetCommand(f.scope,b,db);const c=await f.claim();
  const renew={projectId:f.scope.projectId,operationId:b.operationId,workerId:f.workerId,leaseEpoch:c.command!.leaseEpoch};
  expect((await renewFleetCommand(f.worker,renew,db)).leaseEpoch).toBe(c.command!.leaseEpoch);
  await expect(renewFleetCommand(f.worker,{...renew,leaseEpoch:0},db)).rejects.toBeTruthy();
  await f.step(b.operationId,c.command!.leaseEpoch);
  await expect(createFleetCommand(f.scope,f.input(),db)).rejects.toBeTruthy();
  for(let i=0;i<100;i++)await db.fleetCommandEvent.create({data:{operationId:b.operationId,eventId:randomUUID(),kind:'PROGRESS',requestHash:'fixture',detail:{code:'VERIFYING'}}});
  await expect(f.step(b.operationId,c.command!.leaseEpoch,'PROGRESS')).rejects.toBeTruthy();
 }finally{await f.cleanup();}
});

it('wires scoped HTTP create/detail/list/claim/dispatch/cancel to the same durable operation',async()=>{
 const f=await fixture();try{
  const token='mth_'+randomBytes(32).toString('base64url');
  await db.opsToken.create({data:{userId:f.scope.userId,name:'fixture-http',prefix:randomUUID(),tokenHash:hashToken(token),projectIds:[f.scope.projectId],scopes:['READ','VM_OPS'],expiresAt:new Date(Date.now()+3600000),createdById:f.scope.userId}});
  const b=f.input(),base='fleet-commands',path=base+'/'+b.operationId;
  const created=await api('POST',base,{token,body:b,key:b.operationId});expect(created.status).toBe(200);expect(created.json.data.state).toBe('QUEUED');
  expect((await api('GET',path+'?projectId='+b.projectId,{token})).json.data.operationId).toBe(b.operationId);
  expect((await api('GET',base+'?projectId='+b.projectId+'&serverId='+f.server.id,{token})).json.data.items).toHaveLength(1);
  const claim=await api('POST',base+'/claim',{token,body:{projectId:b.projectId,serverId:f.server.id,workerId:f.workerId},key:randomUUID()});expect(claim.status).toBe(200);
  const dispatched=await api('POST',path+'/step',{token,body:{projectId:b.projectId,workerId:f.workerId,leaseEpoch:claim.json.data.command.leaseEpoch,stepId:randomUUID(),phase:'DISPATCH'},key:randomUUID()});
  expect(dispatched.json.data.permit.operationId).toBe(b.operationId);
  const p=dispatched.json.data.permit,authorizationId=randomUUID();
  const nativeBody={projectId:b.projectId,workerId:f.workerId,leaseEpoch:p.leaseEpoch,authorizationId,serverUuid:p.serverUuid,machineUuid:p.machineUuid,action:p.action,expectedCycle:p.expectedCycle,expectedVmRevision:p.expectedVmRevision,configurationId:p.configurationId,requestHash:nativeCommandHash(p)};
  const auth=await api('POST',path+'/authorize-native',{token,body:nativeBody,key:authorizationId});expect(auth.status).toBe(200);expect(auth.json.data.permit).toEqual(p);
  expect((await api('POST',path+'/authorize-native',{token,body:nativeBody,key:authorizationId})).status).toBe(409);
  const cancelled=await api('POST',path+'/cancel',{token,body:{projectId:b.projectId},key:randomUUID()});expect(cancelled.json.data.state).toBe('DISPATCHED');expect(cancelled.json.data.cancelRequestedAt).toBeTruthy();
 }finally{await db.opsAudit.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();}
});

it('bounds repeated UNKNOWN completions while preserving a slot for verified final reconciliation',async()=>{
 const f=await fixture();try{
  const b=f.input();await createFleetCommand(f.scope,b,db);const c=await f.claim();await f.step(b.operationId,c.command!.leaseEpoch);
  for(let i=0;i<100;i++)await db.fleetCommandEvent.create({data:{operationId:b.operationId,eventId:randomUUID(),kind:'PROGRESS',requestHash:'fixture',detail:{code:'RECONCILING'}}});
  const body={projectId:b.projectId,operationId:b.operationId,workerId:f.workerId,leaseEpoch:c.command!.leaseEpoch,completionId:randomUUID(),outcome:'UNKNOWN',evidence:{operationId:b.operationId,aeOperationId:b.operationId,machineUuid:f.machineUuid,verified:false,observedAt:new Date().toISOString(),vmState:'UNKNOWN'}};
  await expect(completeFleetCommand(f.worker,body,db)).rejects.toBeTruthy();
  expect((await completeFleetCommand(f.worker,{...body,completionId:randomUUID(),outcome:'SUCCEEDED',evidence:{...body.evidence,verified:true,vmState:'RUNNING'}},db)).state).toBe('SUCCEEDED');
 }finally{await f.cleanup();}
});

it('control read offers only current authorized exact canary bindings, retains history when disabled and filters by VM',async()=>{
 const f=await fixture();try{
  const q={projectId:f.scope.projectId,serverId:f.server.id,vmId:f.vm.id};
  const initial=await readFleetControl(f.scope,q,db);
  expect(initial.capability).toMatchObject({binding:{...q,machineUuid:f.machineUuid,expectedVmRevision:f.input().expectedVmRevision},actions:['START_VM','SHUTDOWN_VM','POWER_OFF_VM','CHECK_HEALTH','CHECK_PROXY','READ_SDK']});
  expect(initial.userId).toBe(f.scope.userId);
  expect((await readFleetControl(f.worker,q,db)).capability?.actions).toEqual(['CHECK_HEALTH','CHECK_PROXY','READ_SDK']);
  const b=f.input();await createFleetCommand(f.scope,b,db);
  delete process.env.FLEET_CONTROL_M1_READY;
  const disabled=await readFleetControl(f.scope,q,db);expect(disabled.capability).toBeNull();expect(disabled.items).toHaveLength(1);
  const other=await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_002',managed:true}});
  expect((await readFleetControl(f.scope,{...q,vmId:other.id},db)).items).toHaveLength(0);
  await db.projectMember.updateMany({where:{projectId:q.projectId,userId:f.scope.userId},data:{serverScope:'SELECTED',allowedServerIds:[]}});
  await expect(readFleetControl(f.scope,q,db)).rejects.toMatchObject({code:'NOT_FOUND'});
 }finally{await f.cleanup();}
});

it('web scoped control/create/detail/cancel use the same service and hide other servers',async()=>{
 const f=await fixture();try{
  await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.scope.userId},data:{serverScope:'SELECTED',allowedServerIds:[f.server.id],allowedModules:['INFRASTRUCTURE']}});
  const q={projectId:f.scope.projectId,serverId:f.server.id,vmId:f.vm.id};
  await expect(assertServerWebRequest(db,f.scope.userId,'fleetCommands.control',q)).resolves.toBeUndefined();
  const session={user:{id:f.scope.userId,name:'Fixture'},expires:new Date(Date.now()+3600000).toISOString()};
  const caller=router({fleetCommands:fleetCommandsRouter}).createCaller({prisma:db,session}).fleetCommands;
  const control=await caller.control(q);expect(control.capability).not.toBeNull();
  const b=f.input();expect(await caller.create(b)).toMatchObject({operationId:b.operationId});
  expect(await caller.detail({projectId:b.projectId,operationId:b.operationId})).toMatchObject({operationId:b.operationId});
  expect(await caller.cancel({projectId:b.projectId,operationId:b.operationId})).toMatchObject({state:'CANCELLED'});
  await expect(caller.control({...q,serverId:'another-server'})).rejects.toBeTruthy();
 }finally{await f.cleanup();}
});

it('Telegram authenticates sender through trusted bridge mapping, rejects caller identities and shares command/cancel/history',async()=>{
 const f=await fixture(),oldOwner=process.env.FLEET_TELEGRAM_OWNER;try{
  const token=await db.opsToken.create({data:{userId:f.worker.userId,name:'fixture-telegram',prefix:randomUUID(),tokenHash:hashToken(randomUUID()),projectIds:[f.scope.projectId],scopes:['VM_OPS'],expiresAt:new Date(Date.now()+3600000),createdById:f.scope.userId}});
  process.env.FLEET_TELEGRAM_OWNER=JSON.stringify({bindingId:randomUUID(),bridgeId:'fixture',chatId:'-123',senderId:'456',bridgeUserId:f.worker.userId,ownerUserId:f.scope.userId,projectId:f.scope.projectId,tokenId:token.id});
  let accepted=true;
  const verifiedBindingHash=telegramBindingHash(telegramOwner());
  const verified=createTelegramFleetHandler({authenticateAndResolve:async(envelope:unknown)=>accepted&&envelope==='verified-bridge-envelope'?{userId:f.worker.userId,projectId:f.scope.projectId,tokenId:token.id,verifiedBindingHash}:null},db);
  const handler=(envelope:unknown,body:unknown)=>runWithOpsAuth({tokenId:token.id,userId:f.worker.userId,operation:'VM_OPS'},()=>verified(envelope,body));
  const {projectId:_,...command}=f.input();
  await expect(handler('spoofed',{kind:'create',command})).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(handler('verified-bridge-envelope',{kind:'create',command:{...command,role:'ADMIN'}})).rejects.toBeTruthy();
  await expect(handler('verified-bridge-envelope',{kind:'create',command:{...command,projectId:randomUUID()}})).rejects.toBeTruthy();
  const created=await handler('verified-bridge-envelope',{kind:'create',command});expect(created).toMatchObject({operationId:command.operationId,state:'QUEUED'});
  expect(await db.fleetCommand.findUnique({where:{operationId:command.operationId},select:{source:true,requesterId:true}})).toEqual({source:'TELEGRAM',requesterId:f.scope.userId});
  expect(await handler('verified-bridge-envelope',{kind:'detail',operationId:command.operationId})).toMatchObject({operationId:command.operationId});
  expect(await handler('verified-bridge-envelope',{kind:'cancel',operationId:command.operationId})).toMatchObject({state:'CANCELLED'});
  accepted=false;await expect(handler('verified-bridge-envelope',{kind:'list'})).rejects.toMatchObject({code:'FORBIDDEN'});
  accepted=true;await db.user.update({where:{id:f.scope.userId},data:{disabledAt:new Date()}});
  await expect(handler('verified-bridge-envelope',{kind:'create',command})).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{if(oldOwner===undefined)delete process.env.FLEET_TELEGRAM_OWNER;else process.env.FLEET_TELEGRAM_OWNER=oldOwner;await f.cleanup();}
});

async function nativeFixture(){
 const f=await fixture(),b=f.input();
 const requesterToken=await db.opsToken.create({data:{userId:f.scope.userId,name:'fixture-requester',prefix:randomUUID(),tokenHash:hashToken(randomUUID()),projectIds:[b.projectId],scopes:['VM_OPS'],expiresAt:new Date(Date.now()+3600000),createdById:f.scope.userId}});
 await createFleetCommand(f.scope,b,db,{tokenId:requesterToken.id,source:'OPS'});
 const claim=await f.claim(),sent=await f.step(b.operationId,claim.command!.leaseEpoch);
 const token=await db.opsToken.create({data:{userId:f.worker.userId,name:'fixture-native',prefix:randomUUID(),tokenHash:hashToken(randomUUID()),projectIds:[b.projectId],scopes:['VM_OPS'],expiresAt:new Date(Date.now()+3600000),createdById:f.scope.userId}});
 const p=sent.permit!;
 const body={projectId:b.projectId,operationId:b.operationId,workerId:f.workerId,leaseEpoch:p.leaseEpoch,authorizationId:randomUUID(),serverUuid:p.serverUuid,machineUuid:p.machineUuid,action:p.action,expectedCycle:p.expectedCycle,expectedVmRevision:p.expectedVmRevision,configurationId:p.configurationId,requestHash:nativeCommandHash(p)};
 const authorize=(input:unknown=body)=>runWithOpsAuth({tokenId:token.id,userId:f.worker.userId,operation:'VM_OPS'},()=>authorizeNativeFleetCommand(f.worker,input,db));
 return {...f,b,token,requesterToken,body,authorize};
}
it('native authorization requires actual token auth, returns exact two-second one-use proof and refuses every replay',async()=>{
 const f=await nativeFixture();try{
  await expect(authorizeNativeFleetCommand(f.worker,f.body,db)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(f.authorize({...f.body,requestHash:'0'.repeat(64)})).rejects.toBeTruthy();
  const a=await f.authorize();expect(a).toMatchObject({authorizationId:f.body.authorizationId,requestHash:f.body.requestHash,permit:{operationId:f.b.operationId,machineUuid:f.machineUuid}});
  expect(Date.parse(a.validUntil)-Date.parse(a.authorizedAt)).toBeGreaterThan(0);expect(Date.parse(a.validUntil)-Date.parse(a.authorizedAt)).toBeLessThanOrEqual(2000);
  await expect(f.authorize()).rejects.toBeTruthy();await expect(f.authorize({...f.body,authorizationId:randomUUID()})).rejects.toBeTruthy();
  expect(await db.fleetCommandEvent.count({where:{operationId:f.b.operationId,kind:'NATIVE_AUTH'}})).toBe(1);
 }finally{await f.cleanup();}
});
it.each(['requester','requester-role','requester-token','requester-token-scope','worker-token','worker-scope','lease','epoch','ttl','cancel','canary','binding'] as const)('native authorization rechecks %s after DISPATCH, inside current transaction',async(changed)=>{
 const f=await nativeFixture();try{
  if(changed==='requester')await db.user.update({where:{id:f.scope.userId},data:{disabledAt:new Date()}});
  if(changed==='requester-role')await db.projectMember.updateMany({where:{userId:f.scope.userId,projectId:f.b.projectId},data:{role:'USER',allowedModules:['INFRASTRUCTURE']}});
  if(changed==='requester-token')await db.opsToken.update({where:{id:f.requesterToken.id},data:{revokedAt:new Date()}});
  if(changed==='requester-token-scope')await db.opsToken.update({where:{id:f.requesterToken.id},data:{scopes:['READ']}});
  if(changed==='worker-token')await db.opsToken.update({where:{id:f.token.id},data:{revokedAt:new Date()}});
  if(changed==='worker-scope')await db.projectMember.updateMany({where:{userId:f.worker.userId,projectId:f.b.projectId},data:{serverScope:'SELECTED',allowedServerIds:[]}});
  if(changed==='lease')await db.fleetCommand.update({where:{operationId:f.b.operationId},data:{leaseUntil:new Date(Date.now()-1)}});
  if(changed==='epoch')await db.fleetCommand.update({where:{operationId:f.b.operationId},data:{leaseEpoch:{increment:1}}});
  if(changed==='ttl')await db.fleetCommand.update({where:{operationId:f.b.operationId},data:{expiresAt:new Date(Date.now()-1)}});
  if(changed==='cancel')await cancelFleetCommand(f.scope,{projectId:f.b.projectId,operationId:f.b.operationId},db);
  if(changed==='canary')delete process.env.FLEET_CONTROL_M1_READY;
  if(changed==='binding')await db.virtualMachine.update({where:{id:f.vm.id},data:{notes:'UUID máy: '+randomUUID()}});
  await expect(f.authorize()).rejects.toBeTruthy();
  expect(await db.fleetCommandEvent.count({where:{operationId:f.b.operationId,kind:'NATIVE_AUTH'}})).toBe(0);
 }finally{await f.cleanup();}
});

it('native request hash uses ordinal compact immutable permit keys and excludes lease changes',()=>{
 const p={...bindingExample(),leaseEpoch:2,leaseUntil:'2026-10-26T00:01:00.000Z'};
 const canonical='{"action":"START_VM","configurationId":null,"expectedCycle":1,"expectedVmRevision":3,"expiresAt":"2026-10-26T00:05:00.000Z","machineUuid":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","operationId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","projectId":"p","serverId":"s","serverUuid":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","vmCode":"VM_001","vmId":"v"}';
 expect(nativeCommandHash(p)).toBe(createHash('sha256').update(canonical).digest('hex'));
 const reclaimed={...p,leaseEpoch:9,leaseUntil:'2026-10-26T00:02:00.000Z'};expect(nativeCommandHash(reclaimed)).toBe(nativeCommandHash(p));
});
function bindingExample(){return {operationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',projectId:'p',serverId:'s',serverUuid:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',vmId:'v',vmCode:'VM_001',machineUuid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',expectedCycle:1,expectedVmRevision:3,configurationId:null,action:'START_VM',expiresAt:'2026-10-26T00:05:00.000Z'};}

// Keep real PostgreSQL transactions/queries; only pause at the selected boundary or
// advance the wall clock while a query is in flight. No fabricated service results.
function boundaryDB(afterBinding:()=>void=()=>undefined,timeoutBeforeCommit=false){
 return new Proxy(db,{get(target,key,receiver){
  if(key==='$transaction')return (fn:(tx:Prisma.TransactionClient)=>Promise<unknown>,options?:{maxWait?:number;timeout?:number;isolationLevel?:Prisma.TransactionIsolationLevel})=>target.$transaction(async tx=>{
   const wrapped=new Proxy(tx,{get(inner,property,owner){
    if(property==='virtualMachine')return new Proxy(inner.virtualMachine,{get(delegate,method){if(method==='findFirst')return async(...args:Parameters<typeof delegate.findFirst>)=>{const vm=await delegate.findFirst(...args);afterBinding();return vm;};return Reflect.get(delegate,method);}});
    if(property==='fleetCommandEvent'&&timeoutBeforeCommit)return new Proxy(inner.fleetCommandEvent,{get(delegate,method){if(method==='create')return async()=>{await tx.$queryRaw`SELECT pg_sleep(0.15)`;throw new Error('timeout expected');};return Reflect.get(delegate,method);}});
    return Reflect.get(inner,property,owner);
   }});
   return fn(wrapped);
  },{...options,...(timeoutBeforeCommit?{timeout:60}:{})});
  const value=Reflect.get(target,key,receiver);return typeof value==='function'?value.bind(target):value;
 }});
}

it.each(['requester','worker'] as const)('native authorization refuses %s token expiring during binding checks',async(who)=>{
 const f=await nativeFixture();try{
  const start=Date.now(),tokenId=who==='requester'?f.requesterToken.id:f.token.id;
  await db.opsToken.update({where:{id:tokenId},data:{expiresAt:new Date(start+500)}});
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(start);
  const delayed=boundaryDB(()=>vi.setSystemTime(start+1000));
  await expect(runWithOpsAuth({tokenId:f.token.id,userId:f.worker.userId,operation:'VM_OPS'},()=>authorizeNativeFleetCommand(f.worker,f.body,delayed))).rejects.toMatchObject({reason:'TOKEN_EXPIRED'});
  expect(await db.fleetCommandEvent.count({where:{operationId:f.b.operationId,kind:'NATIVE_AUTH'}})).toBe(0);
 }finally{vi.useRealTimers();await f.cleanup();}
});
it.each(['requester','worker'] as const)('native authorization proof cannot outlive %s token expiry',async(who)=>{
 const f=await nativeFixture();try{
  const start=Date.now(),expiry=start+1000;
  await db.opsToken.update({where:{id:who==='requester'?f.requesterToken.id:f.token.id},data:{expiresAt:new Date(expiry)}});
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(start);
  const a=await f.authorize();expect(Date.parse(a.validUntil)).toBeLessThanOrEqual(expiry);
 }finally{vi.useRealTimers();await f.cleanup();}
});
it('a lease that expires while binding reads run cannot produce a native proof',async()=>{
 const f=await nativeFixture();try{
  const start=Date.now();await db.fleetCommand.update({where:{operationId:f.b.operationId},data:{leaseUntil:new Date(start+500)}});
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(start);
  await expect(runWithOpsAuth({tokenId:f.token.id,userId:f.worker.userId,operation:'VM_OPS'},()=>authorizeNativeFleetCommand(f.worker,f.body,boundaryDB(()=>vi.setSystemTime(start+1000))))).rejects.toMatchObject({reason:'REVISION_CONFLICT'});
  expect(await db.fleetCommandEvent.count({where:{operationId:f.b.operationId,kind:'NATIVE_AUTH'}})).toBe(0);
 }finally{vi.useRealTimers();await f.cleanup();}
});
it('authorization timeout before commit rolls back proof; response loss AFTER commit never issues another proof even after its deadline',async()=>{
 const f=await nativeFixture();try{
  await expect(runWithOpsAuth({tokenId:f.token.id,userId:f.worker.userId,operation:'VM_OPS'},()=>authorizeNativeFleetCommand(f.worker,f.body,boundaryDB(undefined,true)))).rejects.toBeTruthy();
  expect(await db.fleetCommandEvent.count({where:{operationId:f.b.operationId,kind:'NATIVE_AUTH'}})).toBe(0);
  const lost=await f.authorize(); // actual committed result is discarded by the transport
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.parse(lost.validUntil)+1);
  await expect(f.authorize()).rejects.toMatchObject({reason:'REVISION_CONFLICT'});
  await expect(f.authorize({...f.body,authorizationId:randomUUID()})).rejects.toMatchObject({reason:'REVISION_CONFLICT'});
  expect(await db.fleetCommandEvent.count({where:{operationId:f.b.operationId,kind:'NATIVE_AUTH'}})).toBe(1);
  expect((await db.fleetCommand.findUniqueOrThrow({where:{operationId:f.b.operationId}})).dispatchedAt).not.toBeNull();
 }finally{vi.useRealTimers();await f.cleanup();}
});
it('web control exposes exact enrolled VM only and cannot enable the M1 gate through request fields',async()=>{
 const f=await fixture();try{
  const q={projectId:f.scope.projectId,serverId:f.server.id,vmId:f.vm.id};
  const session={user:{id:f.scope.userId,name:'Fixture'},expires:new Date(Date.now()+3600000).toISOString()};
  const caller=router({fleetCommands:fleetCommandsRouter}).createCaller({prisma:db,session}).fleetCommands;
  const other=await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_002',managed:true,notes:'UUID máy: '+randomUUID()}});
  expect((await caller.control({...q,vmId:other.id})).capability).toBeNull();
  delete process.env.FLEET_CONTROL_M1_READY;expect((await caller.control(q)).capability).toBeNull();
  await expect(caller.create(f.input())).rejects.toBeTruthy();
  await expect(caller.create({...f.input(),enabled:true,m1Ready:true} as ReturnType<typeof f.input>)).rejects.toBeTruthy();
  expect(process.env.FLEET_CONTROL_M1_READY).toBeUndefined();expect(await db.fleetCommand.count({where:{projectId:q.projectId}})).toBe(0);
 }finally{await f.cleanup();}
});

it('enrolled server ids for bulk recreate: only enrolled AND within a server-scoped reader servers; nothing before M1',async()=>{
 const f=await fixture(),old=process.env.FLEET_CONTROL_SERVERS;try{
  const s2=await db.server.create({data:{projectId:f.scope.projectId,code:'fleet-s2',managed:true}}),s3=await db.server.create({data:{projectId:f.scope.projectId,code:'fleet-s3',managed:true}});
  process.env.FLEET_CONTROL_SERVERS=JSON.stringify([{projectId:f.scope.projectId,serverId:f.server.id,serverUuid:randomUUID()},{projectId:f.scope.projectId,serverId:s2.id,serverUuid:randomUUID()}]);
  expect((await readFleetServers(f.scope,{projectId:f.scope.projectId},db)).serverIds.sort()).toEqual([f.server.id,s2.id].sort());
  await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.worker.userId},data:{serverScope:'SELECTED',allowedServerIds:[f.server.id,s3.id]}});
  expect((await readFleetServers(f.worker,{projectId:f.scope.projectId},db)).serverIds).toEqual([f.server.id]);
  await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.worker.userId},data:{allowedServerIds:[s3.id]}});
  expect((await readFleetServers(f.worker,{projectId:f.scope.projectId},db)).serverIds).toEqual([]);
  delete process.env.FLEET_CONTROL_M1_READY;expect((await readFleetServers(f.scope,{projectId:f.scope.projectId},db)).serverIds).toEqual([]);
 }finally{if(old===undefined)delete process.env.FLEET_CONTROL_SERVERS;else process.env.FLEET_CONTROL_SERVERS=old;await f.cleanup();}
});
