import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {commitStockImport,previewStockImport,type BatchInput,type ImportInput} from '@/server/account-store/inventory';
import {accountStoreRouter} from '@/server/routers/accountStore';
import type {Context} from '@/server/trpc';

afterAll(()=>db.$disconnect());
const batch=(quantity:number,extra:Partial<BatchInput>&{autoQuantity?:boolean}={}):BatchInput&{autoQuantity?:boolean}=>({purchasedAt:'2026-10-25',priceMode:'UNIT',amount:'2',currency:'USDT',quantity,autoQuantity:true,...extra});
const mail=()=>randomUUID()+'@fixture.invalid';
const none={purchasedAt:'2026-10-25',priceMode:'NONE' as const};
async function fixture(){const f=await businessFixture();await db.project.update({where:{id:f.scope.projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});return f;}
const snapshot=async(projectId:string)=>({
 accounts:await db.payPalAccount.count({where:{projectId}}),
 logins:await db.gmailAccount.count({where:{projectId}}),
 batches:await db.accountPurchaseBatch.count({where:{projectId}}),
 costs:await db.costRecord.count({where:{projectId}}),
 journals:await db.operationJournal.count({where:{projectId}}),
});

it('uses PP READY heads, excluding existing codes, email additions and grouped lines',async()=>{
 const f=await fixture();try{
  await commitStockImport(f.scope,{key:randomUUID(),kind:'PAYPAL',text:'OLD '+mail(),batch:none},db);
  const input:ImportInput={kind:'PAYPAL',text:['NEW '+mail()+' '+mail(),'new '+mail(),'OLD '+mail()].join('\n'),batch:batch(2)};
  const before=await snapshot(f.scope.projectId);
  await expect(previewStockImport(f.scope,input,db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  await expect(commitStockImport(f.scope,{...input,key:randomUUID()},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  expect(await snapshot(f.scope.projectId)).toEqual(before);
  input.batch=batch(1);
  expect(await previewStockImport(f.scope,input,db)).toMatchObject({ready:1,add:1,batch:{total:{quantity:1,amount:'2.00000000'}}});
  expect(await commitStockImport(f.scope,{...input,key:randomUUID()},db)).toMatchObject({applied:1,add:1});
  expect(await db.costRecord.count({where:{projectId:f.scope.projectId}})).toBe(1);
 }finally{await f.cleanup();}
});

it('rejects a two-actor PP race after priced preview without importing the remainder or recording another cost',async()=>{
 const f=await fixture();try{
  await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{role:'ADMIN'}});
  const first='FIRST '+mail(),second='SECOND '+mail();
  const input:ImportInput={kind:'PAYPAL',text:first+'\n'+second,batch:batch(2)},key=randomUUID();
  expect(await previewStockImport(f.scope,input,db)).toMatchObject({ready:2});
  await commitStockImport(f.worker,{kind:'PAYPAL',text:first,batch:none,key:randomUUID()},db);
  const before=await snapshot(f.scope.projectId);
  await expect(commitStockImport(f.scope,{...input,key},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  expect(await snapshot(f.scope.projectId)).toEqual(before);
  expect(await db.payPalAccount.count({where:{projectId:f.scope.projectId,code:'SECOND'}})).toBe(0);
  // A refreshed preview also refuses the stale automatic quantity, rather than silently repricing it.
  await expect(previewStockImport(f.scope,input,db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  const corrected={...input,batch:batch(1)};
  expect(await previewStockImport(f.scope,corrected,db)).toMatchObject({ready:1,exists:1});
  const saved=await commitStockImport(f.scope,{...corrected,key:randomUUID()},db);
  expect(saved.applied).toBe(1);
  const paid=await db.accountPurchaseBatch.findUniqueOrThrow({where:{id:saved.batch.id}});
  expect(paid.paidQuantity).toBe(1);expect(paid.totalPaid?.toString()).toBe('2');
 }finally{await f.cleanup();}
});

it('refuses stale automatic unit pricing at zero READY while NONE classification remains readable',async()=>{
 const f=await fixture();try{
  const text='EXISTING '+mail();await commitStockImport(f.scope,{kind:'PAYPAL',text,batch:none,key:randomUUID()},db);
  const input:ImportInput={kind:'PAYPAL',text,batch:batch(1)},before=await snapshot(f.scope.projectId);
  await expect(previewStockImport(f.scope,input,db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  await expect(commitStockImport(f.scope,{...input,key:randomUUID()},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  expect(await previewStockImport(f.scope,{...input,batch:{...none,autoQuantity:true} as BatchInput},db)).toMatchObject({ready:0,exists:1});
  expect(await snapshot(f.scope.projectId)).toEqual(before);
 }finally{await f.cleanup();}
});

it('preserves legacy/manual actual quantity 50 for 48 logins and TOTAL cost despite the flag',async()=>{
 const f=await fixture();try{
  for(const flag of [undefined,false]){
   const input:ImportInput={kind:'LOGIN',loginType:'GMAIL',text:Array.from({length:48},()=>mail()+'|fixture-secret').join('\n'),batch:batch(50,{autoQuantity:flag})};
   expect(await previewStockImport(f.scope,input,db)).toMatchObject({ready:48});
   const r=await commitStockImport(f.scope,{...input,key:randomUUID()},db),saved=await db.accountPurchaseBatch.findUniqueOrThrow({where:{id:r.batch.id}});
   expect(r.applied).toBe(48);expect(saved.paidQuantity).toBe(50);expect(saved.totalPaid?.toString()).toBe('100');
  }
  const total:ImportInput={kind:'LOGIN',loginType:'GMAIL',text:mail()+'|fixture-secret',batch:batch(50,{priceMode:'TOTAL',amount:'120'})};
  expect(await previewStockImport(f.scope,total,db)).toMatchObject({ready:1});
  const r=await commitStockImport(f.scope,{...total,key:randomUUID()},db),saved=await db.accountPurchaseBatch.findUniqueOrThrow({where:{id:r.batch.id}});
  expect(saved.paidQuantity).toBe(50);expect(saved.totalPaid?.toString()).toBe('120');
 }finally{await f.cleanup();}
});

it('preserves the partial purchase cost and quantity while appending corrected rows without a batch payload',async()=>{
 const f=await fixture();try{
  const partial=await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:mail()+'|fixture-secret\nbad-email',batch:batch(1),key:randomUUID()},db);
  expect(partial).toMatchObject({applied:1,errors:1});
  const input:ImportInput={kind:'LOGIN',loginType:'GMAIL',text:mail()+'|fixture-secret',append:{batchId:partial.batch.id}};
  expect(await previewStockImport(f.scope,input,db)).toMatchObject({ready:1,batch:{existing:true,cost:'RECORDED'}});
  expect(await commitStockImport(f.scope,{...input,key:randomUUID()},db)).toMatchObject({applied:1,batch:{appended:true}});
  const saved=await db.accountPurchaseBatch.findUniqueOrThrow({where:{id:partial.batch.id}});
  expect(saved.paidQuantity).toBe(1);expect(saved.totalPaid?.toString()).toBe('2');
  expect(await db.costRecord.count({where:{projectId:f.scope.projectId}})).toBe(1);
 }finally{await f.cleanup();}
});

it('keeps autoQuantity through both tRPC input parsers so stale requests cannot bypass the guard',async()=>{
 const f=await fixture();try{
  const api=accountStoreRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId},expires:'2099-01-01'}} as unknown as Context);
  const input={projectId:f.scope.projectId,kind:'LOGIN' as const,loginType:'GMAIL' as const,text:mail()+'|fixture-secret',batch:batch(2)};
  await expect(api.importPreview(input)).rejects.toMatchObject({code:'CONFLICT'});
  await expect(api.importCommit({...input,key:randomUUID()})).rejects.toMatchObject({code:'CONFLICT'});
  expect(await db.costRecord.count({where:{projectId:f.scope.projectId}})).toBe(0);
  expect(await db.gmailAccount.count({where:{projectId:f.scope.projectId}})).toBe(0);
 }finally{await f.cleanup();}
});
