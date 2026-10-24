import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {testClient} from './db-fixture';
import {listProxyMembers,listServerAccessChoices,setProxyCapabilities} from '@/server/proxy-management/capabilities';
import {loadInfrastructureScope} from '@/server/permissions/infrastructure';
import {assertImagesUnchanged,captureMember,type OperationSnapshot} from '@/server/operation-history/snapshot';
import type {ActorScope} from '@/server/proxy-management/types';

const db=testClient();
afterAll(()=>db.$disconnect());
async function fixture(){
  const projectId=randomUUID(),foreignProjectId=randomUUID(),adminId=randomUUID(),workerId=randomUUID();
  const projectIds=[projectId,foreignProjectId],userIds=[adminId,workerId];
  const cleanup=async()=>{
    await db.operationJournal.deleteMany({where:{projectId:{in:projectIds}}});
    await db.auditLog.deleteMany({where:{projectId:{in:projectIds}}});
    await db.server.deleteMany({where:{projectId:{in:projectIds}}});
    await db.projectMember.deleteMany({where:{projectId:{in:projectIds}}});
    await db.project.deleteMany({where:{id:{in:projectIds}}});
    await db.user.deleteMany({where:{id:{in:userIds}}});
  };
  try{
    await db.project.createMany({data:projectIds.map(id=>({id,code:id,name:'Member server scope synthetic fixture',settings:{businessMode:'PROXY_VM'}}))});
    await db.user.createMany({data:userIds.map(id=>({id,email:id+'@fixture.invalid'}))});
    const admin=await db.projectMember.create({data:{projectId,userId:adminId,role:'ADMIN'}});
    const member=await db.projectMember.create({data:{projectId,userId:workerId,role:'USER',allowedModules:['INFRASTRUCTURE'],capabilities:['EARN_BALANCE']}});
    const a=await db.server.create({data:{projectId,code:'SCOPE_A'}}),b=await db.server.create({data:{projectId,code:'SCOPE_B'}});
    const foreign=await db.server.create({data:{projectId:foreignProjectId,code:'FOREIGN'}});
    const scope:ActorScope={userId:adminId,projectId,role:'ADMIN',capabilities:[]};
    return {scope,admin,member,a,b,foreign,cleanup};
  }catch(error){await cleanup();throw error;}
}
it('real DB grants multiple servers, journals nonreversibly, blocks an old member image, and treats SELECTED empty as none',async()=>{
  const f=await fixture();try{
    expect(f.member).toMatchObject({serverScope:'ALL',allowedServerIds:[],accessRevision:0});
    const before=captureMember(f.member);
    const oldSnapshot:OperationSnapshot={version:1,resources:[{resource:'MEMBER',id:f.member.id,before,after:before}],eventIds:[],replacementIds:[]};
    await expect(assertImagesUnchanged(db,f.scope.projectId,oldSnapshot)).resolves.toBeUndefined();
    await setProxyCapabilities(f.scope,f.member.id,['EARN_BALANCE'],db,true,{mode:'SELECTED',serverIds:[f.b.id,f.a.id],expectedAccessRevision:0});
    expect(await db.projectMember.findUniqueOrThrow({where:{id:f.member.id}})).toMatchObject({serverScope:'SELECTED',allowedServerIds:[f.a.id,f.b.id].sort(),accessRevision:1});
    expect((await loadInfrastructureScope(db,f.member.userId,f.scope.projectId)).serverIds?.sort()).toEqual([f.a.id,f.b.id].sort());
    expect(await db.operationJournal.findFirstOrThrow({where:{projectId:f.scope.projectId,kind:'ACCESS'}})).toMatchObject({reversible:false});
    expect((await db.auditLog.findFirstOrThrow({where:{projectId:f.scope.projectId,entityId:f.member.id}})).changes).toMatchObject({serverScope:'SELECTED',accessRevision:1});
    await expect(assertImagesUnchanged(db,f.scope.projectId,oldSnapshot)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    await setProxyCapabilities(f.scope,f.member.id,['EARN_BALANCE'],db,true,{mode:'SELECTED',serverIds:[],expectedAccessRevision:1});
    expect(await db.projectMember.findUniqueOrThrow({where:{id:f.member.id}})).toMatchObject({serverScope:'SELECTED',allowedServerIds:[],accessRevision:2});
    expect((await loadInfrastructureScope(db,f.member.userId,f.scope.projectId)).serverIds).toEqual([]);
    expect((await listProxyMembers(f.scope,db)).find(m=>m.id===f.member.id)).toMatchObject({serverScope:'SELECTED',allowedServerIds:[],accessRevision:2});
    expect((await listServerAccessChoices(f.scope,db)).map(s=>s.id).sort()).toEqual([f.a.id,f.b.id].sort());
  }finally{await f.cleanup();}
});
it('real DB rejects foreign/duplicate server IDs and stale revisions atomically',async()=>{
  const f=await fixture();try{
    for(const serverIds of [[f.foreign.id],[f.a.id,f.a.id]]){
      await expect(setProxyCapabilities(f.scope,f.member.id,[],db,true,{mode:'SELECTED',serverIds,expectedAccessRevision:0})).rejects.toMatchObject({code:'INVALID_INPUT'});
    }
    await expect(setProxyCapabilities(f.scope,f.member.id,[],db,true,{mode:'SELECTED',serverIds:[f.a.id],expectedAccessRevision:1})).rejects.toMatchObject({code:'STALE_PREVIEW'});
    expect(await db.projectMember.findUniqueOrThrow({where:{id:f.member.id}})).toMatchObject({serverScope:'ALL',allowedServerIds:[],accessRevision:0,capabilities:['EARN_BALANCE']});
    expect(await db.operationJournal.count({where:{projectId:f.scope.projectId}})).toBe(0);
    expect(await db.auditLog.count({where:{projectId:f.scope.projectId}})).toBe(0);
  }finally{await f.cleanup();}
});
it('real DB uses current administrator role and refuses restricted ADMIN grants',async()=>{
  const f=await fixture();try{
    await expect(setProxyCapabilities(f.scope,f.admin.id,[],db,true,{mode:'SELECTED',serverIds:[],expectedAccessRevision:0})).rejects.toMatchObject({code:'FORBIDDEN'});
    await db.projectMember.update({where:{id:f.admin.id},data:{role:'USER',allowedModules:['INFRASTRUCTURE']}});
    await expect(setProxyCapabilities(f.scope,f.member.id,[],db,true,{mode:'SELECTED',serverIds:[f.a.id],expectedAccessRevision:0})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(await db.projectMember.findUniqueOrThrow({where:{id:f.member.id}})).toMatchObject({serverScope:'ALL',accessRevision:0});
  }finally{await f.cleanup();}
});
