import {afterAll,expect,it} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {scanWorkbook,persistSourceSnapshot} from '@/server/proxy-management/sources';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
it('same source content does not invalidate identities; failure preserves reservations; returned ref is masked',async()=>{
  const projectId=randomUUID();let identityId:string|undefined;
  try{
    await db.project.create({data:{id:projectId,code:projectId,name:'Fixture'}});
    const source=scanWorkbook({spreadsheetId:'fixture',tabs:[{id:'1',name:'PC',hidden:true,cells:[{a1:'A1',row:1,column:1,value:'192.0.2.74:80:fake:secret'}]}]},'GENJY');
    const first=await persistSourceSnapshot(projectId,source,db);
    expect(Object.keys(first).sort()).toEqual(['fetchedAt','hash','id','scanSucceeded','sourceKey']);
    const identity=await db.proxyIdentity.findUniqueOrThrow({where:{ip:'192.0.2.74'}});identityId=identity.id;
    const second=await persistSourceSnapshot(projectId,{...source,id:randomUUID(),fetchedAt:new Date(Date.now()+1000).toISOString()},db);
    expect(Object.keys(second).sort()).toEqual(['fetchedAt','hash','id','scanSucceeded','sourceKey']);
    expect(second.hash).toBe(first.hash);expect(second.id).toBe(first.id);
    expect((await db.proxyIdentity.findUniqueOrThrow({where:{id:identityId}})).revision).toBe(identity.revision);
    await persistSourceSnapshot(projectId,{id:randomUUID(),sourceKey:'GENJY',hash:'UNAVAILABLE',fetchedAt:new Date(Date.now()+2000).toISOString(),scanSucceeded:false,evidence:[]},db);
    expect(await db.proxySourceReference.count({where:{identityId}})).toBe(1);
    expect((await db.proxyIdentity.findUniqueOrThrow({where:{id:identityId}})).owner).toBe('GENJY');
  }finally{
    await db.proxySourceReference.deleteMany({where:{snapshot:{projectId}}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});
    if(identityId) await db.proxyIdentity.deleteMany({where:{id:identityId}});await db.project.deleteMany({where:{id:projectId}});
  }
});
it('annotation-aware scans replace unsafe evidence cached by the earlier scanner hash',async()=>{
  const projectId=randomUUID();let identityId:string|undefined;
  const book={spreadsheetId:'fixture',tabs:[{id:'1',name:'PC',hidden:false,cells:[{a1:'A1',row:1,column:1,value:'198.51.100.205 BLOCKED 2026-10-01',note:'',formula:''}]}]};
  try{
    await db.project.create({data:{id:projectId,code:projectId,name:'Scanner upgrade fixture'}});
    const source=scanWorkbook(book,'GENJY');
    const oldHash=createHash('sha256').update(JSON.stringify(book)).digest('hex');
    const old=await persistSourceSnapshot(projectId,{...source,hash:oldHash,evidence:source.evidence.map(e=>({...e,hasManualMetadata:false}))},db);
    identityId=(await db.proxyIdentity.findUniqueOrThrow({where:{ip:'198.51.100.205'}})).id;
    const current=await persistSourceSnapshot(projectId,{...source,id:randomUUID()},db);
    expect(current.id).not.toBe(old.id);
    expect(await db.proxySourceReference.findFirstOrThrow({where:{snapshotId:current.id}})).toMatchObject({hasManualMetadata:true});
  }finally{
    await db.proxySourceReference.deleteMany({where:{snapshot:{projectId}}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});if(identityId)await db.proxyIdentity.delete({where:{id:identityId}});await db.project.deleteMany({where:{id:projectId}});
  }
});
