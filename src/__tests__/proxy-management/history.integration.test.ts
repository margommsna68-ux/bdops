import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {queryRegistry,getProxyTimeline,exportBlocked} from '@/server/proxy-management/history';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
it('queries mask credentials, timeline hides other projects, copy requires capability',async()=>{
  const projectId=randomUUID(),userId=randomUUID();let identityId:string|undefined;
  try{
    await db.project.create({data:{id:projectId,code:projectId,name:'Fixture',settings:{businessMode:'PROXY_VM'}}});await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});await db.projectMember.create({data:{projectId,userId,role:'USER',allowedModules:['INFRASTRUCTURE']}});
    const identity=await db.proxyIdentity.create({data:{ip:'192.0.2.90',owner:'SELF'}});identityId=identity.id;
    const endpoint=await db.proxyIP.create({data:{projectId,identityId,address:'192.0.2.90:80',host:'192.0.2.90',port:80,credentialCipher:encrypt(JSON.stringify({username:'u',password:'secret'})),packageCode:'fixture',inventoryState:'BLOCKED',status:'BLOCKED',inventoryKey:identityId,statusAt:new Date('2026-10-14T00:00:00Z')}});
    await db.proxyStatusEvent.create({data:{projectId,identityId,endpointId:endpoint.id,ip:identity.ip,kind:'BLOCKED',occurredAt:null}});
    const scope={projectId,userId,role:'ADMIN' as const,capabilities:['COPY_CREDENTIALS']}; // Fake client flags must not grant copy.
    const page=await queryRegistry(scope,{view:'CURRENT',limit:50},db);expect(page.rows).toHaveLength(1);expect(JSON.stringify(page)).not.toContain('secret');
    const timeline=await getProxyTimeline(scope,identityId,db);expect(timeline.events[0].occurredAt).toBeNull();expect(JSON.stringify(timeline)).not.toContain('secret');
    await expect(getProxyTimeline({...scope,projectId:randomUUID()},identityId,db)).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(exportBlocked(scope,db)).rejects.toMatchObject({code:'FORBIDDEN'});
    await db.projectMember.update({where:{userId_projectId:{userId,projectId}},data:{capabilities:['COPY_CREDENTIALS']}});
    expect(await exportBlocked(scope,db)).toEqual([{packageCode:'fixture',proxy:'192.0.2.90:80:u:secret',status:'BLOCKED'}]);expect(await db.auditLog.count({where:{projectId,action:'COPY_PROXY_CREDENTIALS'}})).toBe(1);
  }finally{await db.auditLog.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});await db.proxyIP.deleteMany({where:{projectId}});if(identityId) await db.proxyIdentity.deleteMany({where:{id:identityId}});await db.projectMember.deleteMany({where:{projectId}});await db.project.deleteMany({where:{id:projectId}});await db.user.deleteMany({where:{id:userId}});}
});
