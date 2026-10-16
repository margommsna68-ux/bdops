import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {queryRegistry,copyProxyRows,copyProxyEndpoint} from '@/server/proxy-management/history';
import {UNASSIGNED_SERVER,type ActorScope} from '@/server/proxy-management/types';
import {appRouter} from '@/server/routers/_app';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
// Fixture: proxies spread over moon2 / moon10 / An-01 plus one unassigned, one bare (no credentials) and one Genjy reserved IP.
async function fixture(){
  const projectId=randomUUID(),userId=randomUUID(),ids:string[]=[],net='198.51.'+(1+Math.floor(Math.random()*250))+'.';
  await db.project.create({data:{id:projectId,code:projectId,name:'Registry fixture',settings:{businessMode:'PROXY_VM'}}});await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});
  await db.projectMember.create({data:{projectId,userId,role:'USER',allowedModules:['INFRASTRUCTURE'],capabilities:['COPY_CREDENTIALS']}});
  const servers:Record<string,{id:string}>={};for(const code of ['moon10','moon2','An-01']) servers[code]=await db.server.create({data:{projectId,code,managed:true}});
  const vm=async(server:string,code:string)=>db.virtualMachine.create({data:{serverId:servers[server].id,code,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}});
  const vms={moon10_2:await vm('moon10','VM_002'),moon10_10:await vm('moon10','VM_010'),moon2_1:await vm('moon2','VM_001'),an_1:await vm('An-01','VM_001')};
  const endpoint=async(ip:string,o:{packageCode?:string|null;full?:boolean;state?:'NEW'|'LIVE'|'BLOCKED'}={})=>{
    const identity=await db.proxyIdentity.create({data:{ip,owner:'SELF'}});ids.push(identity.id);
    return db.proxyIP.create({data:{projectId,identityId:identity.id,address:ip+':80',host:ip,port:80,credentialCipher:o.full===false?null:encrypt(JSON.stringify({username:'u'+ip.split('.')[3],password:'secret-'+ip.split('.')[3]})),packageCode:o.packageCode===undefined?'231243':o.packageCode,inventoryState:o.state||'LIVE',inventoryKey:identity.id,statusAt:new Date('2026-10-14T00:00:00Z')}});
  };
  const hold=async(endpointId:string,vmId:string,role:'DESIRED'|'INSTALLED'|'UNCERTAIN')=>{
    const config=await db.vMConfiguration.create({data:{projectId,vmId,version:1,endpointId,snapshotCipher:encrypt('{}'),configurationHash:'h-'+randomUUID(),createdById:userId}});
    const ep=await db.proxyIP.findUniqueOrThrow({where:{id:endpointId}});await db.vMProxyAllocation.create({data:{projectId,vmId,endpointId,configurationId:config.id,allocationKey:ep.inventoryKey!,role,createdById:userId}});
  };
  const e=[await endpoint(net+'1'),await endpoint(net+'2',{packageCode:'240292'}),await endpoint(net+'3'),await endpoint(net+'4',{packageCode:null}),await endpoint(net+'5',{full:false,packageCode:'240292'})];
  await hold(e[0].id,vms.moon2_1.id,'UNCERTAIN');await db.virtualMachine.update({where:{id:vms.moon10_10.id},data:{proxyId:e[0].id}}); // two valid positions: a hold and the VM link recorded from the Sheet
  await hold(e[1].id,vms.moon10_2.id,'DESIRED');await hold(e[2].id,vms.an_1.id,'INSTALLED');
  const genjy=await db.proxyIdentity.create({data:{ip:net+'9',owner:'GENJY'}});ids.push(genjy.id);
  const snapshot=await db.proxySourceSnapshot.create({data:{projectId,sourceKey:'GENJY',hash:'registry-fixture',scanSucceeded:true}});
  await db.proxySourceReference.create({data:{snapshotId:snapshot.id,identityId:genjy.id,sourceRef:'Genjy!A1',owner:'GENJY',format:'BARE',hasFullCredentials:false,hasManualMetadata:false}});
  const scope:ActorScope={projectId,userId,role:'USER',capabilities:[]};
  const cleanup=async()=>{await db.vMProxyAllocation.deleteMany({where:{projectId}});await db.vMConfiguration.deleteMany({where:{projectId}});await db.virtualMachine.updateMany({where:{server:{projectId}},data:{proxyId:null}});await db.virtualMachine.deleteMany({where:{server:{projectId}}});await db.server.deleteMany({where:{projectId}});await db.auditLog.deleteMany({where:{projectId}});await db.proxySourceReference.deleteMany({where:{snapshot:{projectId}}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});await db.proxyIP.deleteMany({where:{projectId}});await db.proxyIdentity.deleteMany({where:{id:{in:ids}}});await db.projectMember.deleteMany({where:{projectId}});await db.project.deleteMany({where:{id:projectId}});await db.user.deleteMany({where:{id:userId}});};
  return {projectId,userId,scope,e,net,cleanup};
}
it('registry returns structured locations (all positions), server facet, total and server filters combined with package filter',async()=>{
  const f=await fixture();try{
    const page=await queryRegistry(f.scope,{view:'CURRENT',limit:50,sort:'SERVER'},db);
    expect(page.servers).toEqual(['An-01','moon2','moon10']);expect(page.total).toBe(6);
    const first=page.rows[0];expect(first.ip).toBe(f.net+'3');expect(first.locations).toEqual([{serverId:expect.any(String),serverCode:'An-01',vmId:expect.any(String),vmCode:'VM_001',role:'INSTALLED'}]);
    const multi=page.rows.find(r=>r.ip===f.net+'1')!;expect(multi.locations.map(l=>l.serverCode+'/'+l.vmCode+':'+l.role)).toEqual(['moon2/VM_001:UNCERTAIN','moon10/VM_010:null']);
    expect(page.rows.map(r=>r.ip)).toEqual([f.net+'3',f.net+'1',f.net+'2',f.net+'5',f.net+'4',f.net+'9']); // An-01 → moon2 → moon10 → unassigned (package 240292 before unknown package, then IP)
    expect(JSON.stringify(page)).not.toContain('vmRefs');expect(JSON.stringify(page)).not.toContain('secret-');
    const moon=await queryRegistry(f.scope,{view:'CURRENT',limit:50,sort:'SERVER',servers:['moon10','moon2']},db);expect(moon.rows.map(r=>r.ip)).toEqual([f.net+'1',f.net+'2']);expect(moon.total).toBe(2);expect(moon.servers).toEqual(['An-01','moon2','moon10']);
    const none=await queryRegistry(f.scope,{view:'CURRENT',limit:50,servers:[UNASSIGNED_SERVER]},db);expect(none.rows.map(r=>r.ip).sort()).toEqual([f.net+'4',f.net+'5',f.net+'9']);
    const combined=await queryRegistry(f.scope,{view:'CURRENT',limit:50,servers:['moon10',UNASSIGNED_SERVER],packageCode:'240292'},db);expect(combined.rows.map(r=>r.ip)).toEqual([f.net+'2',f.net+'5']);
    const bySearch=await queryRegistry(f.scope,{view:'CURRENT',limit:50,search:'moon2/vm_001'},db);expect(bySearch.rows.map(r=>r.ip)).toEqual([f.net+'1']);
    const paged=await queryRegistry(f.scope,{view:'CURRENT',limit:1,sort:'SERVER',servers:['moon10','moon2']},db);expect(paged.rows.map(r=>r.ip)).toEqual([f.net+'1']);expect(paged.total).toBe(2);
    const next=await queryRegistry(f.scope,{view:'CURRENT',limit:1,sort:'SERVER',servers:['moon10','moon2'],cursor:paged.nextCursor!},db);expect(next.rows.map(r=>r.ip)).toEqual([f.net+'2']);expect(next.nextCursor).toBeNull();
  }finally{await f.cleanup();}
});
it('bulk copy returns full proxies in the requested order, reports skipped rows by reason, enforces the capability and project, and logs counts only',async()=>{
  const f=await fixture();try{
    await db.projectMember.update({where:{userId_projectId:{userId:f.userId,projectId:f.projectId}},data:{capabilities:[]}});
    await expect(copyProxyRows(f.scope,{endpointIds:[f.e[0].id]},db)).rejects.toMatchObject({code:'FORBIDDEN'});
    await db.projectMember.update({where:{userId_projectId:{userId:f.userId,projectId:f.projectId}},data:{capabilities:['COPY_CREDENTIALS']}});
    const picked=await copyProxyRows(f.scope,{endpointIds:[f.e[2].id,f.e[0].id,f.e[4].id]},db);
    expect(picked).toEqual({proxies:[f.net+'3:80:u3:secret-3',f.net+'1:80:u1:secret-1'],copied:2,total:3,skipped:[{reason:'NO_CREDENTIALS',count:1}]});
    expect(await copyProxyEndpoint(f.scope,f.e[0].id,db)).toEqual({proxy:f.net+'1:80:u1:secret-1'}); // held for a VM, still copyable from the registry
    await expect(copyProxyRows(f.scope,{endpointIds:[f.e[0].id,randomUUID()]},db)).rejects.toMatchObject({code:'NOT_FOUND'});
    const filtered=await copyProxyRows(f.scope,{filter:{view:'CURRENT',sort:'SERVER'}},db);
    expect(filtered.proxies).toEqual([f.net+'3:80:u3:secret-3',f.net+'1:80:u1:secret-1',f.net+'2:80:u2:secret-2',f.net+'4:80:u4:secret-4']);
    expect(filtered).toMatchObject({copied:4,total:6,skipped:[{reason:'NO_CREDENTIALS',count:1},{reason:'NO_ENDPOINT',count:1}]});
    const scoped=await copyProxyRows(f.scope,{filter:{view:'CURRENT',servers:['moon10'],packageCode:'240292'}},db);expect(scoped.proxies).toEqual([f.net+'2:80:u2:secret-2']);
    const logs=await db.auditLog.findMany({where:{projectId:f.projectId,action:'COPY_PROXY_CREDENTIALS'}});expect(logs).toHaveLength(4);expect(JSON.stringify(logs)).not.toContain('secret-');
    expect(logs.map(l=>(l.changes as {count:number}).count).sort()).toEqual([1,1,2,4]);
    await expect(copyProxyRows({...f.scope,projectId:randomUUID()},{endpointIds:[f.e[0].id]},db)).rejects.toMatchObject({code:'FORBIDDEN'});
  }finally{await f.cleanup();}
});
it('tRPC exposes servers filter and both copy procedures under the same checks',async()=>{
  const f=await fixture();try{
    const caller=appRouter.createCaller({prisma:db,session:{user:{id:f.userId,memberships:[]},expires:'2099-01-01'}} as any);
    const page=await caller.proxyManagement.list({projectId:f.projectId,view:'CURRENT',limit:50,servers:['An-01']});expect(page.rows.map(r=>r.ip)).toEqual([f.net+'3']);expect(page.servers).toEqual(['An-01','moon2','moon10']);
    const picked=await caller.proxyManagement.copyEndpoints({projectId:f.projectId,endpointIds:[f.e[1].id]});expect(picked.proxies).toEqual([f.net+'2:80:u2:secret-2']);
    const all=await caller.proxyManagement.copyFiltered({projectId:f.projectId,view:'CURRENT',servers:[UNASSIGNED_SERVER]});expect(all.proxies).toEqual([f.net+'4:80:u4:secret-4']);expect(all.skipped).toEqual([{reason:'NO_CREDENTIALS',count:1},{reason:'NO_ENDPOINT',count:1}]);
    await expect(caller.proxyManagement.copyEndpoints({projectId:f.projectId,endpointIds:[]})).rejects.toMatchObject({code:'BAD_REQUEST'});
  }finally{await f.cleanup();}
});
