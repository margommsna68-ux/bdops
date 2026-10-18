import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {commitStockImport} from '@/server/account-store/inventory';
import {parseReceiptLines,checkReceipts,recordReceipts,recordTransfer,recordOpening,readPaypalLedger,readPaypalEntries} from '@/server/business-management/paypal-ledger';
import {dayText} from '@/server/business-management/money';
afterAll(()=>db.$disconnect());
// Independent review of 18/10/2026 (.runtime/paypal-independent-review-20261018.ts). Synthetic data only (example.invalid).
const u=()=>randomUUID().slice(0,6);
async function setup(){
  const f=await businessFixture(),x=u();
  await db.project.update({where:{id:f.scope.projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
  const a=`rv-a-${x}@example.invalid`,b=`rv-b-${x}@example.invalid`;
  await commitStockImport(f.scope,{kind:'PAYPAL',text:`rv-1 ${a}\nrv-2 ${b}`,batch:{purchasedAt:'2026-10-18',priceMode:'NONE'},key:randomUUID()},db);
  const p=(await db.payPalAccount.findFirstOrThrow({where:{projectId:f.scope.projectId,code:'rv-1'}})).id,q=(await db.payPalAccount.findFirstOrThrow({where:{projectId:f.scope.projectId,code:'rv-2'}})).id;
  return {...f,x,a,b,p,q};
}
it('receipt lines keep empty cells in place for tab and |: an empty amount is never read from the payment id column',async()=>{
  const e='x@example.invalid';
  expect(parseReceiptLines(`${e} | | 24`)[0]).toMatchObject({amount:null,error:expect.stringMatching(/số tiền/i)});
  expect(parseReceiptLines(`${e}\t\t24`)[0]).toMatchObject({amount:null,error:expect.stringMatching(/số tiền/i)});
  expect(parseReceiptLines(`${e} | 24 | TX | more`)[0].error).toMatch(/Thừa cột/);
  expect(parseReceiptLines(`${e} | 24 | | TX`)[0].error).toMatch(/Thừa cột|trống/);
  expect(parseReceiptLines(`| ${e} | 24`)[0].error).toMatch(/email/);
  expect(parseReceiptLines(`${e} | 2x4 | TX`)[0].error).toMatch(/Số tiền/);
  expect(parseReceiptLines(`${e} | 24 |`)[0]).toMatchObject({amount:'24.00',transactionId:null,error:null});// trailing separator only
  expect(parseReceiptLines(`${e}\t24\tTX-1`)[0]).toMatchObject({amount:'24.00',transactionId:'TX-1',error:null});
  expect(parseReceiptLines(`${e} 24 TX-2`)[0]).toMatchObject({amount:'24.00',transactionId:'TX-2',error:null});
  const f=await setup();try{
    const bad=`${f.a} | | 24`,input={paypalId:f.p,date:'2026-10-18',currency:'USD',status:'RECEIVED' as const,text:bad};
    expect((await checkReceipts(f.scope,input,db)).rows[0].outcome).toBe('ERROR');
    const r=await recordReceipts(f.scope,{...input,key:randomUUID()},db);expect(r.saved).toBe(0);
    expect(await db.fundTransaction.count({where:{projectId:f.scope.projectId}})).toBe(0);
  }finally{await f.cleanup();}
});
it('transfers must add up: refuses received 31 for 31 − fee 1, and 30 VND for (31 − 1) × 25 000; valid ones still record',async()=>{
  const f=await setup();try{
    const t={paypalId:f.p,type:'MIXING' as const,destPaypalId:f.q,date:'2026-10-18',currency:'USD',debited:'31',fee:'1'};
    await expect(recordTransfer(f.scope,{...t,received:'31',receivedCurrency:'USD',transactionId:'F-'+f.x,key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    await expect(recordTransfer(f.scope,{...t,received:'30',receivedCurrency:'VND',rate:'25000',transactionId:'X-'+f.x,key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(await db.withdrawal.count({where:{projectId:f.scope.projectId}})).toBe(0);
    await recordReceipts(f.scope,{paypalId:f.p,date:'2026-10-18',currency:'USD',status:'RECEIVED',text:`${f.a} | 46 | IN-${f.x}`,key:randomUUID()},db);
    await recordTransfer(f.scope,{...t,debited:'30',fee:null,type:'EXCHANGE',destPaypalId:null,key:randomUUID()},db);
    let l=await readPaypalLedger(f.scope,{month:'2026-10'},db);expect(l.paypals.find(x=>x.paypalId===f.p)!.currencies[0]).toMatchObject({in:'46.00',out:'30.00',balance:'16.00'});
    await recordTransfer(f.scope,{...t,received:'30',receivedCurrency:'USD',key:randomUUID()},db);
    l=await readPaypalLedger(f.scope,{month:'2026-10'},db);
    expect(l.paypals.find(x=>x.paypalId===f.p)!.currencies[0]).toMatchObject({out:'61.00',balance:'-15.00'});
    expect(l.paypals.find(x=>x.paypalId===f.q)!.currencies[0]).toMatchObject({internalIn:'30.00',balance:'30.00'});
    const fx=await recordTransfer(f.scope,{...t,date:'2026-10-17',received:'750000',receivedCurrency:'VND',rate:'25000',key:randomUUID()},db);
    expect((await db.withdrawal.findUniqueOrThrow({where:{id:fx.id}})).receivedAmount!.toFixed(2)).toBe('750000.00');
    const rf=await recordTransfer(f.scope,{...t,date:'2026-10-16',received:'29.5',receiverFee:'0.5',receivedCurrency:'USD',key:randomUUID()},db);
    expect((await db.withdrawal.findUniqueOrThrow({where:{id:rf.id}})).receiverFeeAmount!.toFixed(2)).toBe('0.50');
  }finally{await f.cleanup();}
});
it('the list behind a number has the same range as the number: no future rows; rows that are not added up say so',async()=>{
  const f=await setup();try{
    const today=dayText(new Date()),key=()=>randomUUID(),r=(date:string,text:string,status:'RECEIVED'|'PENDING'='RECEIVED')=>recordReceipts(f.scope,{paypalId:f.p,date,currency:'USD',status,text,key:key()},db);
    await recordOpening(f.scope,{paypalId:f.p,date:today,currency:'USD',amount:'100',key:key()},db);
    await r(today,`${f.a} | 10 | NOW-${f.x}`);await r('2099-01-01',`${f.a} | 50 | FUT-${f.x}`);await r(today,`${f.a} | 7 | PEN-${f.x}`,'PENDING');
    const book=await readPaypalLedger(f.scope,{},db),cur=book.paypals.find(x=>x.paypalId===f.p)!.currencies[0];expect(cur).toMatchObject({in:'10.00',balance:'110.00'});
    const list=await readPaypalEntries(f.scope,{paypalId:f.p,direction:'IN'},db);
    expect(list.rows.some(x=>x.date==='2099-01-01')).toBe(false);expect(list.asOf).toBe(book.asOf);expect(list.totals).toEqual({USD:'10.00'});
    expect(list.later).toBe(1);
    const pend=list.rows.find(x=>x.transactionId==='PEN-'+f.x)!,open=list.rows.find(x=>x.kind==='OPENING')!;
    expect(pend.counted).toBe(false);expect(pend.role).toMatch(/Chờ nhận/);expect(open.counted).toBe(false);expect(open.role).toMatch(/Số dư đầu/);
    expect(list.rows.find(x=>x.transactionId==='NOW-'+f.x)!.counted).toBe(true);
    // A stated cut-off day is used by both.
    const early=await readPaypalLedger(f.scope,{asOf:'2026-01-01'},db),earlyList=await readPaypalEntries(f.scope,{paypalId:f.p,direction:'IN',asOf:'2026-01-01'},db);
    expect(early.asOf).toBe('2026-01-01');expect(earlyList.rows).toHaveLength(0);
    // Month view: totals of the list = the month's number.
    const m='2099-01',mb=await readPaypalLedger(f.scope,{month:m},db),ml=await readPaypalEntries(f.scope,{paypalId:f.p,direction:'IN',month:m},db);
    expect(mb.paypals.find(x=>x.paypalId===f.p)!.currencies[0].in).toBe('50.00');expect(ml.totals).toEqual({USD:'50.00'});
  }finally{await f.cleanup();}
});
