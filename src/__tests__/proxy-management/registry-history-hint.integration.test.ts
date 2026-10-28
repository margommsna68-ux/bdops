import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {queryRegistry} from '@/server/proxy-management/history';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
// 28/10/2026: searching an IP on "Đang quản lý" that only exists in history must say so (replaced by whom, when) instead of an empty table.
it('CURRENT search with no rows reports history matches with their replacement',async()=>{
  const projectId=randomUUID(),userId=randomUUID(),ids:string[]=[];
  try{
    await db.project.create({data:{id:projectId,code:projectId,name:'Fixture',settings:{businessMode:'PROXY_VM'}}});await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});await db.projectMember.create({data:{projectId,userId,role:'ADMIN',allowedModules:['INFRASTRUCTURE']}});
    const oldIdentity=await db.proxyIdentity.create({data:{ip:'192.0.2.110',owner:'SELF'}}),newIdentity=await db.proxyIdentity.create({data:{ip:'192.0.2.111',owner:'SELF'}});ids.push(oldIdentity.id,newIdentity.id);
    const old=await db.proxyIP.create({data:{projectId,identityId:oldIdentity.id,address:'192.0.2.110:5432',host:'192.0.2.110',port:5432,packageCode:'fixture',inventoryState:'REPLACED',status:'RESERVED',inventoryKey:oldIdentity.id,retiredAt:new Date('2026-10-24T05:26:23Z')}});
    const next=await db.proxyIP.create({data:{projectId,identityId:newIdentity.id,address:'192.0.2.111:5432',host:'192.0.2.111',port:5432,packageCode:'fixture',inventoryState:'LIVE',status:'AVAILABLE',inventoryKey:newIdentity.id}});
    const batch=await db.proxyBatch.create({data:{projectId,actorId:userId,kind:'REPLACE',idempotencyKey:randomUUID(),payloadHash:'x',token:randomUUID(),encryptedPlan:'',sourceHash:'x',revisionFacts:{},previewRows:[],status:'APPLIED',expiresAt:new Date()}});
    await db.proxyReplacement.create({data:{projectId,oldEndpointId:old.id,newEndpointId:next.id,ownerSnapshot:'SELF',receivedDate:new Date('2026-10-24T00:00:00Z'),actorId:userId,batchId:batch.id}});
    const scope={projectId,userId,role:'ADMIN' as const,capabilities:[] as string[]};
    for(const search of ['192.0.2.110','192.0.2.110:5432','192.0.2.110:5432:u:p']){
      const page=await queryRegistry(scope,{view:'CURRENT',search,limit:50},db);
      expect(page.total).toBe(0);
      expect(page.historyHint).toEqual({total:1,rows:[{identityId:oldIdentity.id,endpointId:old.id,ip:'192.0.2.110',port:5432,state:'REPLACED',retiredAt:'2026-10-24T05:26:23.000Z',replacedBy:'192.0.2.111',receivedDate:'2026-10-24'}]});
    }
    // Current rows found, other views, or no search: no hint.
    expect((await queryRegistry(scope,{view:'CURRENT',search:'192.0.2.111',limit:50},db)).historyHint).toBeNull();
    expect((await queryRegistry(scope,{view:'HISTORY',search:'192.0.2.110',limit:50},db)).historyHint).toBeNull();
    expect((await queryRegistry(scope,{view:'CURRENT',search:'192.0.2.199',limit:50},db)).historyHint).toBeNull();
    expect((await queryRegistry(scope,{view:'CURRENT',limit:50},db)).historyHint).toBeNull();
    expect(JSON.stringify(await queryRegistry(scope,{view:'CURRENT',search:'192.0.2.110:5432:u:p',limit:50},db))).not.toContain(':u:p');
  }finally{await db.proxyReplacement.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});await db.proxyIP.deleteMany({where:{projectId}});await db.proxyIdentity.deleteMany({where:{id:{in:ids}}});await db.projectMember.deleteMany({where:{projectId}});await db.project.deleteMany({where:{id:projectId}});await db.user.deleteMany({where:{id:userId}});}
});
