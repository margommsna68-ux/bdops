import {it,expect} from 'vitest';
import {businessFixture,businessDB as db} from './business-fixture';
import golden from '../fixtures/business-v3-cost.json';
import {encrypt} from '@/lib/encryption';
import {openSnapshot,inspectOperation} from '@/server/operation-history/journal';
import {assertImagesUnchanged,type OperationSnapshot} from '@/server/operation-history/snapshot';
it('old v3 cost projections remain inspectable until a subsequent revision',async()=>{
 const f=await businessFixture();try{
  const image=golden.resources[0],row=await db.costRecord.create({data:{projectId:f.scope.projectId,...image.after,date:new Date(image.after.date)}});
  const snapshot={...golden,resources:[{...image,id:row.id}]} as OperationSnapshot;
  const op=await db.operationJournal.create({data:{projectId:f.scope.projectId,actorId:f.scope.userId,kind:'BUSINESS_COST',accessModule:'COSTS',summary:{count:1},snapshotCipher:encrypt(JSON.stringify(snapshot))}});
  expect(openSnapshot(op.snapshotCipher).version).toBe(3);
  await expect(inspectOperation(f.scope,op.id,db)).resolves.toMatchObject({blockedReason:null});
  await db.costRecord.update({where:{id:row.id},data:{usdtRate:'25000',usdtAmount:'100',revision:{increment:1}}});
  await expect(assertImagesUnchanged(db,f.scope.projectId,snapshot)).rejects.toMatchObject({code:'STALE_PREVIEW'});
 }finally{await f.cleanup();}
});
