import {afterAll,beforeAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {testClient,freeTestNet} from './db-fixture';
import {queryRegistry,loadRegistryRows,copyProxyRows,exportBlocked,getProxyTimeline} from '@/server/proxy-management/history';
import {createProxyBatchService} from '@/server/proxy-management/batches';
import {createProxyEditService,listVmTargets} from '@/server/proxy-management/edits';
import {createVMService} from '@/server/vm-management/allocation';
import {checkVmProxyChange,changeVmProxy} from '@/server/vm-management/proxy-command';
import {assignProxyToVm,markVmBlocked,markUsersBlocked} from '@/server/vm-management/proxy-change';
import {copyVmConfigurations,startInstall,confirmInstalled,reportInstallFailure} from '@/server/vm-management/installation';
import {assertScopedEndpointIds} from '@/server/permissions/server-scope';
import {vmHash} from '@/server/vm-management/types';
import type {ActorScope} from '@/server/proxy-management/types';
const db=testClient(),projectId=randomUUID(),userId=randomUUID(),identities:string[]=[];
const scope:ActorScope={projectId,userId,role:'ADMIN',capabilities:[],serverIds:null}; // deliberately stale caller
let allowed:string,foreign:string,ownVm:string,otherVm:string,sharedVm:string;
let own:string,other:string,shared:string,stock:string,history:string,ownConfig:string,otherConfig:string,net:string;
const images={remember:async()=>{}};
const ctx=()=>({projectId,actorId:userId,now:new Date(),via:'scope fixture'});
const grant=(ids:string[])=>db.projectMember.update({where:{userId_projectId:{projectId,userId}},data:{serverScope:'SELECTED',allowedServerIds:ids}});
beforeAll(async()=>{
 net=await freeTestNet(db,'203.6.');
 await db.project.create({data:{id:projectId,code:projectId,name:'Server scope proxy fixture',settings:{businessMode:'PROXY_VM'}}});
 await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});
 await db.projectMember.create({data:{projectId,userId,role:'USER',allowedModules:['INFRASTRUCTURE'],capabilities:['COPY_CREDENTIALS','PROXY_IMPORT','PROXY_REPLACE']}});
 allowed=(await db.server.create({data:{projectId,code:'allowed',managed:true}})).id;
 foreign=(await db.server.create({data:{projectId,code:'secret-other-server',managed:true}})).id;
 const vm=async(serverId:string,code:string)=>(await db.virtualMachine.create({data:{serverId,code,managed:true}})).id;
 ownVm=await vm(allowed,'VM_OWN');otherVm=await vm(foreign,'VM_OTHER');sharedVm=await vm(allowed,'VM_SHARED');
 const endpoint=async(n:number,pkg:string,state:'BLOCKED'|'REPLACED'='BLOCKED')=>{const i=await db.proxyIdentity.create({data:{ip:net+n,owner:'SELF'}});identities.push(i.id);return (await db.proxyIP.create({data:{projectId,identityId:i.id,host:i.ip,port:80,address:i.ip+':80',credentialCipher:encrypt(JSON.stringify({username:'u',password:'password-'+n})),packageCode:pkg,inventoryKey:i.id,inventoryState:state}})).id;};
 own=await endpoint(1,'OWN');other=await endpoint(2,'HIDDEN');shared=await endpoint(3,'SHARED');stock=await endpoint(4,'STOCK');history=await endpoint(5,'HISTORY','REPLACED');
 const config=async(vmId:string,endpointId:string,version:number)=>{const ep=await db.proxyIP.findUniqueOrThrow({where:{id:endpointId}});const snapshot={proxy:{format:'FULL',ip:ep.host!,port:80,username:'u',password:'password-'+ep.host!.split('.').pop()},packageCode:ep.packageCode,identityId:ep.identityId!,endpointRevision:ep.revision,server:vmId===otherVm?'secret-other-server':'allowed',vm:vmId};return db.vMConfiguration.create({data:{projectId,vmId,endpointId,version,snapshotCipher:encrypt(JSON.stringify(snapshot)),configurationHash:vmHash(snapshot),createdById:userId}});};
 const hold=async(vmId:string,endpointId:string,version:number)=>{const c=await config(vmId,endpointId,version);const ep=await db.proxyIP.findUniqueOrThrow({where:{id:endpointId}});await db.vMProxyAllocation.create({data:{projectId,vmId,endpointId,configurationId:c.id,allocationKey:ep.inventoryKey!,role:'DESIRED',createdById:userId}});await db.virtualMachine.update({where:{id:vmId},data:{desiredConfigurationId:c.id}});return c.id;};
 ownConfig=await hold(ownVm,own,1);otherConfig=await hold(otherVm,other,1);await hold(sharedVm,shared,1);
 await db.virtualMachine.update({where:{id:otherVm},data:{proxyId:shared}}); // readable here, mutation affects foreign server
 await config(ownVm,history,2); // historical configuration alone is not an active binding
 const snap=await db.proxySourceSnapshot.create({data:{projectId,sourceKey:'GENJY',hash:'fixture',scanSucceeded:true}});
 await db.proxySourceReference.create({data:{snapshotId:snap.id,identityId:identities[0],sourceRef:'secret-other-server!A1',format:'BARE',owner:'SELF',hasFullCredentials:false,hasManualMetadata:false}});
 await grant([allowed]);
});
afterAll(async()=>{
 await db.virtualMachine.updateMany({where:{server:{projectId}},data:{proxyId:null,desiredConfigurationId:null,installedConfigurationId:null}});
 await db.vmOpsEvent.deleteMany({where:{projectId}});await db.vmOperation.deleteMany({where:{projectId}});
 await db.vMProxyAllocation.deleteMany({where:{projectId}});await db.vMConfiguration.deleteMany({where:{projectId}});
 await db.proxyBatch.deleteMany({where:{projectId}});await db.virtualMachine.deleteMany({where:{server:{projectId}}});await db.server.deleteMany({where:{projectId}});
 await db.auditLog.deleteMany({where:{projectId}});await db.proxySourceReference.deleteMany({where:{snapshot:{projectId}}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});
 await db.proxyIP.deleteMany({where:{projectId}});await db.proxyIdentity.deleteMany({where:{id:{in:identities}}});await db.projectMember.deleteMany({where:{projectId}});await db.project.deleteMany({where:{id:projectId}});await db.user.deleteMany({where:{id:userId}});await db.$disconnect();
});
it('filters before counts, facets, search and pagination; redacts foreign locations/source refs',async()=>{
 const page=await queryRegistry(scope,{view:'ALL',limit:1},db);expect(page.total).toBe(2);expect(page.counts.current).toBe(2);expect(page.counts.historical).toBe(0);expect(page.packageCounts).toEqual({OWN:1,SHARED:1});expect(page.servers).toEqual(['allowed']);
 expect(JSON.stringify(page)).not.toContain('secret-other-server');
 const all=await loadRegistryRows(scope,{view:'ALL'},db);expect(all.rows.map(r=>r.endpointId).sort()).toEqual([own,shared].sort());expect(all.rows.every(r=>r.sourceRefs.length===0&&r.locations.every(l=>l.serverId===allowed))).toBe(true);
 expect((await queryRegistry(scope,{view:'ALL',limit:10,search:'secret-other-server'},db)).total).toBe(0);
 expect((await queryRegistry(scope,{view:'ALL',limit:10,servers:['__UNASSIGNED__']},db)).total).toBe(0);
 const next=await queryRegistry(scope,{view:'ALL',limit:1,cursor:page.nextCursor!},db);expect(next.rows[0].endpointId).not.toBe(page.rows[0].endpointId);
});
it('copies only visible bound proxies, including shared reads, and denies global timeline',async()=>{
 expect((await copyProxyRows(scope,{filter:{view:'ALL'}},db)).copied).toBe(2);
 expect((await exportBlocked(scope,db))).toHaveLength(2);
 expect((await copyProxyRows(scope,{endpointIds:[shared]},db)).copied).toBe(1);
 for(const endpointId of [other,stock,history])await expect(copyProxyRows(scope,{endpointIds:[own,endpointId]},db)).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(getProxyTimeline(scope,identities[0],db)).rejects.toMatchObject({code:'FORBIDDEN'});
});
it('empty selected-server grants expose no stock even with a stale ADMIN caller',async()=>{
 await grant([]);try{const page=await queryRegistry(scope,{view:'ALL',limit:10},db);expect(page.total).toBe(0);expect(page.counts.current).toBe(0);expect(page.servers).toEqual([]);expect(await exportBlocked(scope,db)).toEqual([]);}finally{await grant([allowed]);}
});
it('lists only permitted VM targets and validates configuration copy VM ids in DB',async()=>{
 expect((await listVmTargets(scope,db)).map(v=>v.id).sort()).toEqual([ownVm,sharedVm].sort());
 expect((await copyVmConfigurations(scope,{vmIds:[ownVm],which:'DESIRED'},db)).items).toHaveLength(1);
 await expect(copyVmConfigurations(scope,{vmIds:[ownVm,otherVm],which:'DESIRED'},db)).rejects.toMatchObject({code:'NOT_FOUND'});
});
it('denies global provider/import/edit/allocation previews and APPLIED replays before exposing stored rows',async()=>{
 const services=[{kind:'NEW',preview:()=>createProxyBatchService(db).preview(scope,{kind:'NEW',idempotencyKey:randomUUID(),text:'x'}),commit:(token:string,key:string)=>createProxyBatchService(db).commit(scope,token,key)},
 {kind:'PROXY_EDIT',preview:()=>createProxyEditService(db).preview(scope,{idempotencyKey:randomUUID(),items:[]}),commit:(token:string,key:string)=>createProxyEditService(db).commit(scope,token,key)},
 {kind:'VM_ALLOCATION',preview:()=>createVMService(db).preview(scope,{mode:'AUTO',idempotencyKey:randomUUID(),vmIds:[ownVm]}),commit:(token:string,key:string)=>createVMService(db).commit(scope,token,key)}];
 for(const svc of services){await expect(svc.preview()).rejects.toMatchObject({code:'FORBIDDEN'});const key=randomUUID(),token=randomUUID();await db.proxyBatch.create({data:{projectId,actorId:userId,kind:svc.kind,idempotencyKey:key,payloadHash:'h',token,encryptedPlan:encrypt('{}'),sourceHash:'x',revisionFacts:{},previewRows:[{secret:'foreign'}],expiresAt:new Date(Date.now()+60000),status:'APPLIED',result:{secret:'foreign'}}});await expect(svc.commit(token,key)).rejects.toMatchObject({code:'FORBIDDEN'});}
});
it('guards direct VM proxy check, change and shared assign entry points',async()=>{
 await expect(checkVmProxyChange(scope,{vmId:otherVm,endpointId:own},db)).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(checkVmProxyChange(scope,{vmId:ownVm,endpointId:stock},db)).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(checkVmProxyChange(scope,{vmId:ownVm,text:net+'2'},db)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(changeVmProxy(scope,{key:randomUUID(),vmId:ownVm,endpointId:shared,expectedCycle:1,expectedVmRevision:0},db)).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(db.$transaction(tx=>assignProxyToVm(tx,images,ctx(),ownVm,stock))).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(db.$transaction(tx=>assignProxyToVm(tx,images,ctx(),ownVm,shared))).rejects.toMatchObject({code:'NOT_FOUND'});
 expect((await db.$transaction(tx=>assignProxyToVm(tx,images,ctx(),ownVm,own))).changed).toBe(false);
});
it('allows BLOCKED for the own exclusive proxy and refuses cross-server mutation',async()=>{
 await expect(db.$transaction(tx=>markVmBlocked(tx,images,ctx(),sharedVm,own,'wrong current proxy'))).rejects.toMatchObject({code:'NOT_FOUND'});
 expect(await db.$transaction(tx=>markVmBlocked(tx,images,ctx(),ownVm,own,'fixture blocked'))).toBe('MARKED');
 await expect(db.$transaction(tx=>markUsersBlocked(tx,images,ctx(),shared,'blocked'))).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(db.$transaction(tx=>markVmBlocked(tx,images,ctx(),otherVm,other,'blocked'))).rejects.toMatchObject({code:'NOT_FOUND'});
 expect(await db.vmOperation.findUnique({where:{vmId:otherVm}})).toBeNull();
});
it('guards installation and confirmation replay entry points before source refresh or mutation',async()=>{
 await expect(startInstall(scope,otherConfig,db)).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(reportInstallFailure(scope,otherConfig,'failure',db)).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(confirmInstalled(scope,{configurationId:otherConfig,configurationHash:'h',expectedVmRevision:0},db,{refreshSource:async()=>{throw new Error('must not refresh');}})).rejects.toMatchObject({code:'NOT_FOUND'});
 expect((await db.vMConfiguration.findUniqueOrThrow({where:{id:ownConfig}})).startedAt).toBeNull();
});

it('current desired/installed pointers alone grant read access; historical configurations do not',async()=>{
 await db.vMProxyAllocation.updateMany({where:{projectId,vmId:ownVm},data:{releasedAt:new Date()}});
 try{
  for(const which of ['desiredConfigurationId','installedConfigurationId'] as const){
   await db.virtualMachine.update({where:{id:ownVm},data:{desiredConfigurationId:null,installedConfigurationId:null,[which]:ownConfig}});
   const rows=(await queryRegistry(scope,{view:'ALL',limit:20},db)).rows;
   expect(rows.find(r=>r.endpointId===own)?.locations).toEqual([{serverId:allowed,serverCode:'allowed',vmId:ownVm,vmCode:'VM_OWN',role:null}]);
   await expect(assertScopedEndpointIds(db,scope,[own],{write:true})).resolves.toBeUndefined();
   expect((await copyProxyRows(scope,{endpointIds:[own]},db)).copied).toBe(1);
  }
  await db.virtualMachine.update({where:{id:ownVm},data:{desiredConfigurationId:null,installedConfigurationId:null}});
  expect((await queryRegistry(scope,{view:'ALL',limit:20},db)).rows.some(r=>r.endpointId===own)).toBe(false);
  await expect(assertScopedEndpointIds(db,scope,[own],{write:true})).rejects.toMatchObject({code:'NOT_FOUND'});
 }finally{
  await db.virtualMachine.update({where:{id:ownVm},data:{desiredConfigurationId:ownConfig,installedConfigurationId:null}});
  await db.vMProxyAllocation.updateMany({where:{projectId,vmId:ownVm},data:{releasedAt:null}});
 }
});
it('shared proxy writes inspect every current configuration VM, but ignore historical configurations',async()=>{
 const c=await db.vMConfiguration.create({data:{projectId,vmId:otherVm,endpointId:own,version:3,snapshotCipher:encrypt('{}'),configurationHash:'history-only',createdById:userId}});
 try{
  await expect(assertScopedEndpointIds(db,scope,[own],{write:true})).resolves.toBeUndefined();
  for(const which of ['desiredConfigurationId','installedConfigurationId'] as const){
   await db.virtualMachine.update({where:{id:otherVm},data:{desiredConfigurationId:otherConfig,installedConfigurationId:null,[which]:c.id}});
   await expect(assertScopedEndpointIds(db,scope,[own])).resolves.toBeUndefined();
   await expect(assertScopedEndpointIds(db,scope,[own],{write:true})).rejects.toMatchObject({code:'NOT_FOUND'});
   await expect(db.$transaction(tx=>markVmBlocked(tx,images,ctx(),ownVm,own,'cross-server current config'))).rejects.toMatchObject({code:'NOT_FOUND'});
  }
 }finally{await db.virtualMachine.update({where:{id:otherVm},data:{desiredConfigurationId:otherConfig,installedConfigurationId:null}});await db.vMConfiguration.delete({where:{id:c.id}});}
});
