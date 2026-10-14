import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {testClient} from './db-fixture';
import {backfillLegacyProject,getEligibleInventory,loadProxyContext} from '@/server/proxy-management/repository';
const db=testClient();afterAll(()=>db.$disconnect());
it('quarantines duplicate legacy IP variants and keeps them out of available inventory',async()=>{
  const id=randomUUID(),scope={userId:'fixture',projectId:id,role:'ADMIN' as const,capabilities:[]};
  let identityId:string|undefined;
  try{
    await db.project.create({data:{id,code:id,name:'Fixture'}});
    await db.proxyIP.createMany({data:[{projectId:id,address:'192.0.2.44:80:u:p'},{projectId:id,address:'192.0.2.44:8080:other:pass'}]});
    const result=await backfillLegacyProject(id,db);
    expect(result.quarantined).toBe(2);
    const rows=await db.proxyIP.findMany({where:{projectId:id}});identityId=rows[0].identityId!;
    expect(rows.every(r=>r.inventoryState==='QUARANTINED'&&r.credentialCipher&&!r.address.includes(':u:p'))).toBe(true);
    expect(await getEligibleInventory(id,db)).toEqual([]);
    const context=await loadProxyContext(scope,{kind:'NEW',text:'192.0.2.44:80:new:credentials',idempotencyKey:'fixture'},db);
    expect(context.endpoints).toHaveLength(2);
    expect(context.history.every(h=>h.occurredAt===null)).toBe(true);
    const events=await db.proxyStatusEvent.findMany({where:{projectId:id}});
    expect(events).toHaveLength(2);expect(events.every(e=>e.occurredAt===null&&e.recordedAt instanceof Date)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('credentials');
  }finally{
    await db.proxyStatusEvent.deleteMany({where:{projectId:id}});await db.proxyIP.deleteMany({where:{projectId:id}});
    if(identityId) await db.proxyIdentity.deleteMany({where:{id:identityId}});await db.project.deleteMany({where:{id}});
  }
});
