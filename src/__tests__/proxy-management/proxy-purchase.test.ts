import {expect,it} from 'vitest';
import {planBatch} from '@/server/proxy-management/batches';
import type {ProxyContext} from '@/server/proxy-management/types';
const ctx:ProxyContext={identities:[],endpoints:[],evidence:[],history:[],receipts:[],source:{id:'s',sourceKey:'GENJY',hash:'x',fetchedAt:'2026-10-25T00:00:00Z',scanSucceeded:true}};
const catalog=[{id:'package',code:'fixture',username:'u',password:'secret'}];
const text='192.0.2.30:80:u:secret\n192.0.2.30:80:u:secret\n192.0.2.31:80:u:secret\nbroken';
const purchase={purchasedAt:'2026-10-25',priceMode:'UNIT' as const,amount:'25000',currency:'VND' as const,rate:'25000'};
it('auto-counts accepted unique new proxies and calculates VND unit price × quantity',()=>{
 const p=planBatch({kind:'NEW',text,idempotencyKey:'purchase-key',purchase},ctx,catalog);
 expect(p.items).toHaveLength(2);expect(p.purchase).toMatchObject({automaticQuantity:2,quantity:2,quantitySource:'AUTO',importableQuantity:2,unitPrice:'25000.00000000',total:'50000.00000000',currency:'VND',usdt:'2.000000'});
 expect(JSON.stringify(p.purchase)).not.toContain('secret');
});
it('keeps actual purchase quantity even when some valid rows cannot import; TOTAL does not multiply again',()=>{
 const facts={...ctx,identities:[{id:'i',ip:'192.0.2.30',owner:'SELF' as const,subgroup:null,revision:1,allocationMode:'SINGLE_IP' as const}],endpoints:[{id:'e',identityId:'i',projectId:'p',proxy:{ip:'192.0.2.30',port:80,username:'u',password:'secret',format:'FULL' as const},inventoryState:'NEW' as const,revision:1,vmKeys:[]}]};
 const automatic=planBatch({kind:'NEW',text,idempotencyKey:'auto-key',purchase},facts,catalog,'p');
 expect(automatic.purchase).toMatchObject({automaticQuantity:1,quantity:1,quantitySource:'AUTO',importableQuantity:1,total:'25000.00000000',usdt:'1.000000'});
 const p=planBatch({kind:'NEW',text,idempotencyKey:'purchase-key',purchase:{...purchase,quantity:10}},facts,catalog,'p');expect(p.purchase).toMatchObject({automaticQuantity:1,quantity:10,quantitySource:'ACTUAL',importableQuantity:1,total:'250000.00000000',usdt:'10.000000'});
 expect(planBatch({kind:'NEW',text,idempotencyKey:'total-key',purchase:{...purchase,priceMode:'TOTAL',amount:'50000',quantity:10}},ctx,catalog).purchase).toMatchObject({quantity:10,unitPrice:null,total:'50000.00000000',usdt:'2.000000'});
});
it('supports PPUSD conversion via both rates and exact USDT amounts',()=>{
 expect(planBatch({kind:'NEW',text,idempotencyKey:'paypal-key',purchase:{...purchase,amount:'3',currency:'PPUSD',rate:undefined,paypalVndRate:'25000',vndUsdtRate:'26000'}},ctx,catalog).purchase).toMatchObject({quantity:2,total:'6.00000000',currency:'PPUSD',usdt:'5.769231'});
 expect(planBatch({kind:'NEW',text,idempotencyKey:'usdt-key',purchase:{...purchase,amount:'0.12345678',currency:'USDT',rate:undefined}},ctx,catalog).purchase).toMatchObject({total:'0.24691356',usdt:'0.246914'});
});
it('requires NEW, a positive integer quantity, canonical money, valid dates, matching rates and at least one importable row',()=>{
 for(const kind of ['BLOCKED','REPLACE','SHEET'] as const)expect(()=>planBatch({kind,text,idempotencyKey:'wrong-kind',purchase},ctx,catalog)).toThrow();
 for(const patch of [{quantity:0},{quantity:1.5},{quantity:100001},{amount:'25.000'},{amount:'0'},{purchasedAt:'2026-02-30'},{currency:'PPUSD',rate:undefined},{currency:'USD'},{currency:'USDT',rate:'2'}])expect(()=>planBatch({kind:'NEW',text,idempotencyKey:'invalid-key',purchase:{...purchase,...patch} as typeof purchase},ctx,catalog)).toThrow();
 expect(()=>planBatch({kind:'NEW',text:'bad',idempotencyKey:'none-ready',purchase},ctx,catalog)).toThrow();
});
it('approved port streams count separate ports, while ordinary same-IP lines count once',()=>{
 const ports='192.0.2.30:80:u:secret\n192.0.2.30:81:u:secret';
 const approved={...ctx,identities:[{id:'i',ip:'192.0.2.30',owner:'SELF' as const,subgroup:null,revision:1,allocationMode:'APPROVED_PORT_STREAM' as const}]};
 expect(planBatch({kind:'NEW',text:ports,idempotencyKey:'stream',purchase},approved,catalog).purchase?.automaticQuantity).toBe(2);
 expect(planBatch({kind:'NEW',text:ports,idempotencyKey:'normal',purchase},ctx,catalog).purchase?.automaticQuantity).toBe(1);
});
