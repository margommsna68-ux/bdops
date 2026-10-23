import {afterAll,it,expect} from 'vitest';import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {commitStockImport,recordBatchCost} from '@/server/account-store/inventory';
import {saveUsdtCost} from '@/server/business-management/usdt-costs';
import {readCashCosts} from '@/server/business-management/cash-workspace';
import {sealP2PQuote} from '@/server/business-management/binance-p2p';
afterAll(()=>db.$disconnect());
it('records PayPal-VND costs with both rates, replays once and exposes both rates for editing',async()=>{
 const f=await businessFixture();try{
  await db.project.update({where:{id:f.scope.projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
  const q=sealP2PQuote({fiat:'VND',side:'BUY',rate:'25940',source:'BINANCE_P2P',fetchedAt:new Date().toISOString()},f.scope);
  const cmd={key:randomUUID(),date:'2026-10-23',amount:'250',currency:'PPUSD',paypalVndRate:'24000',vndUsdtRate:'25940',p2pQuoteToken:q,category:'IP_PROXY',treatment:'CASH_COST' as const};
  await expect(saveUsdtCost(f.scope,{...cmd,paypalVndRate:undefined},db)).rejects.toThrow();
  expect(await db.costRecord.count({where:{projectId:f.scope.projectId}})).toBe(0);
  const a=await saveUsdtCost(f.scope,cmd,db);expect((await saveUsdtCost(f.scope,cmd,db)).replay).toBe(true);
  const rows=await readCashCosts(f.scope,{start:'2026-10-01',end:'2026-10-31'},db);
  expect(rows[0]).toMatchObject({id:a.id,currency:'PPUSD',usdt:'231.303007',paypalVndRate:'24000.000000000000',vndUsdtRate:'25940.000000000000',fxSource:'PAYPAL_VND_BINANCE_P2P_BUY'});
  await commitStockImport(f.scope,{key:randomUUID(),kind:'LOGIN',loginType:'GMAIL',text:`chain-${randomUUID()}@example.invalid|fake`,batch:{purchasedAt:'2026-10-23',priceMode:'NONE'}},db);
  const batch=await db.accountPurchaseBatch.findFirstOrThrow({where:{projectId:f.scope.projectId}});
  await recordBatchCost(f.scope,{batchId:batch.id,expectedRevision:batch.revision,key:randomUUID(),priceMode:'UNIT',amount:'5',quantity:2,currency:'PPUSD',paypalVndRate:'24000',vndUsdtRate:'25940',p2pQuoteToken:q},db);
  const saved=await db.costRecord.findFirstOrThrow({where:{projectId:f.scope.projectId,category:'GMAIL'}});
  expect(saved.amount.toString()).toBe('10');expect(saved.usdtAmount?.toString()).toBe('9.25212');expect(JSON.parse(saved.fxNote!)).toMatchObject({kind:'PAYPAL_VND',paypalVndRate:'24000.000000000000'});
  const receipt=await db.teamReceipt.create({data:{projectId:f.scope.projectId,createdById:f.scope.userId,receivedAt:new Date('2026-10-23'),status:'CONFIRMED',amountUsdt:'100',referenceId:randomUUID(),referenceKey:randomUUID()}});
  const netted=await saveUsdtCost(f.scope,{...cmd,key:randomUUID(),treatment:'ALREADY_NETTED',sourceReceiptId:receipt.id},db);
  const nettedRow=await db.costRecord.findUniqueOrThrow({where:{id:netted.id}});
  expect(nettedRow.usdtAmount?.toString()).toBe('231.303007');expect(nettedRow.usdtRate).not.toBeNull();
 }finally{await f.cleanup();}
});
