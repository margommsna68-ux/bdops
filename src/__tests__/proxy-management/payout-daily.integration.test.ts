import {afterAll,afterEach,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {VirtualMachine,EarnAppAccount,PayPalEmail} from '@prisma/client';
import {businessDB as db,businessFixture} from './business-fixture';
import {createPayoutRequest,updatePayoutRequest,readPayoutPick,suggestPayout} from '@/server/vm-ops/payout';

afterAll(()=>db.$disconnect());afterEach(()=>vi.useRealTimers());
const clock=(at:string)=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(at));};
async function setup(){
 const f=await businessFixture(),projectId=f.scope.projectId;
 const pp=await db.payPalAccount.create({data:{projectId,code:'PP-daily',primaryEmail:randomUUID()+'@example.invalid'}});
 const rows:{vm:VirtualMachine;account:EarnAppAccount;email:PayPalEmail}[]=[];for(let i=0;i<5;i++){
  const vm=i?await db.virtualMachine.create({data:{serverId:f.server.id,code:`VM_00${i+1}`,managed:true,proxySlotState:'BLANK'}}):f.vm;
  const login=await db.gmailAccount.create({data:{projectId,email:randomUUID()+'@example.invalid'}});
  const account=await db.earnAppAccount.create({data:{projectId,loginId:login.id,vmId:vm.id}});
  const email=await db.payPalEmail.create({data:{projectId,paypalId:pp.id,email:randomUUID()+'@example.invalid'}});
  rows.push({vm,account,email});
 }
 const input=(n:number)=>({key:randomUUID(),vmId:rows[n].vm.id,expectedCycle:1,earnAppId:rows[n].account.id,paypalEmailId:rows[n].email.id,amount:'10',date:'2026-10-19',submission:'PREPARING' as const});
 const update=async(id:string,action:'SENT'|'UNKNOWN'|'CANCELLED'|'FAILED'|'RETRY')=>{const r=await db.earnPayoutRequest.findUniqueOrThrow({where:{id}});return updatePayoutRequest(f.scope,{key:randomUUID(),requestId:id,expectedRevision:r.revision,action,note:'Synthetic evidence'},db);};
 return {...f,pp,rows,input,update};
}

it('reserves only two distinct emails per PayPal across requests; retry keeps the same slot',async()=>{
 const f=await setup();try{const a=f.input(0);await createPayoutRequest(f.scope,a,db);await createPayoutRequest(f.scope,a,db);await createPayoutRequest(f.scope,f.input(1),db);
 await expect(createPayoutRequest(f.scope,f.input(2),db)).rejects.toMatchObject({reason:'PAYPAL_DAILY_LIMIT'});
 expect(await db.earnPayoutRequest.count({where:{projectId:f.scope.projectId}})).toBe(2);
 expect((await db.payPalEmail.findUniqueOrThrow({where:{id:f.rows[2].email.id}})).holdEarnAppId).toBeNull();
 }finally{await f.cleanup();}
});
it('two simultaneous preparations cannot take the last daily slot twice',async()=>{
 const f=await setup();try{await createPayoutRequest(f.scope,f.input(0),db);const out=await Promise.allSettled([1,2].map(n=>createPayoutRequest(f.scope,f.input(n),db)));
 expect(out.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(out.filter(x=>x.status==='rejected')).toHaveLength(1);
 expect(await db.earnPayoutRequest.count({where:{projectId:f.scope.projectId}})).toBe(2);
 }finally{await f.cleanup();}
});
it('cancelling an unsent preparation frees capacity; sent and unknown failures do not',async()=>{
 const f=await setup();try{const a=await createPayoutRequest(f.scope,f.input(0),db),b=await createPayoutRequest(f.scope,f.input(1),db);
 await f.update(a.id,'CANCELLED');const c=await createPayoutRequest(f.scope,f.input(2),db);
 await f.update(b.id,'SENT');await f.update(b.id,'FAILED');await f.update(c.id,'UNKNOWN');await f.update(c.id,'CANCELLED');
 await expect(createPayoutRequest(f.scope,f.input(3),db)).rejects.toMatchObject({reason:'PAYPAL_DAILY_LIMIT'});
 }finally{await f.cleanup();}
});
it('uses Vietnam midnight and server date, not a caller-supplied historical date',async()=>{
 clock('2026-10-26T16:59:59Z');const f=await setup();try{
 await createPayoutRequest(f.scope,{...f.input(0),submission:'SENT'},db);await createPayoutRequest(f.scope,{...f.input(1),submission:'SENT'},db);
 await expect(createPayoutRequest(f.scope,{...f.input(2),date:'2001-01-01'},db)).rejects.toMatchObject({reason:'PAYPAL_DAILY_LIMIT'});
 vi.setSystemTime(new Date('2026-10-26T17:00:00Z'));await createPayoutRequest(f.scope,f.input(2),db);await createPayoutRequest(f.scope,f.input(3),db);
 await expect(createPayoutRequest(f.scope,f.input(4),db)).rejects.toMatchObject({reason:'PAYPAL_DAILY_LIMIT'});
 }finally{await f.cleanup();}
});
it('pending reservations cross midnight and keep their owner eligible',async()=>{
 clock('2026-10-26T16:59:59Z');const f=await setup();try{const a=await createPayoutRequest(f.scope,f.input(0),db);await createPayoutRequest(f.scope,f.input(1),db);
 vi.setSystemTime(new Date('2026-10-26T17:00:00Z'));
 await expect(createPayoutRequest(f.scope,f.input(2),db)).rejects.toMatchObject({reason:'PAYPAL_DAILY_LIMIT'});
 await f.update(a.id,'SENT');
 const own=await readPayoutPick(f.scope,{vmId:f.rows[0].vm.id},db);expect(own.suggestion?.paypalId).toBe(f.pp.id);
 }finally{await f.cleanup();}
});
it('suggestion and picker exclude a full PP even for a bound but unused third email',async()=>{
 const f=await setup();try{
 await createPayoutRequest(f.scope,f.input(0),db);await createPayoutRequest(f.scope,f.input(1),db);
 await db.earnAppAccount.update({where:{id:f.rows[2].account.id},data:{paypalId:f.pp.id,paypalEmailId:f.rows[2].email.id}});
 const pick=await readPayoutPick(f.scope,{vmId:f.rows[2].vm.id},db);expect(pick.suggestion).toBeNull();
 expect(pick.paypals[0]).toMatchObject({daily:{limit:2,reserved:2,used:0,remaining:0},emails:expect.arrayContaining([expect.objectContaining({id:f.rows[2].email.id,dailyAllowed:false})])});
 const suggestion=await suggestPayout(f.scope,{earnAppId:f.rows[2].account.id,amount:'10',currency:'USD'},db);expect(suggestion.suggestion).toBeNull();
 }finally{await f.cleanup();}
});
it('a resend on a new day also takes a slot, while a consumed email can retry at 2/2',async()=>{
 clock('2026-10-26T12:00:00Z');const f=await setup();try{const a=await createPayoutRequest(f.scope,{...f.input(0),submission:'SENT'},db);await f.update(a.id,'FAILED');
 vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));await createPayoutRequest(f.scope,f.input(1),db);await createPayoutRequest(f.scope,f.input(2),db);
 await expect(f.update(a.id,'RETRY')).rejects.toMatchObject({reason:'PAYPAL_DAILY_LIMIT'});
 vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));const second=await db.earnPayoutRequest.findUniqueOrThrow({where:{earnAppId:f.rows[1].account.id}});await f.update(second.id,'CANCELLED');await f.update(a.id,'RETRY');await f.update(a.id,'FAILED');await f.update(a.id,'RETRY');
 }finally{await f.cleanup();}
});

it('stock shows the shared 0/2, 1/2, 2/2 occupancy and only usable new-email capacity',async()=>{
 const f=await setup();try{
 await db.project.update({where:{id:f.scope.projectId},data:{settings:{businessMode:'PROXY_VM'}}});
 const {readAccountStore}=await import('@/server/account-store/read');
 const row=async()=>(await readAccountStore(f.scope,db)).paypals.find(p=>p.id===f.pp.id)!;
 expect(await row()).toMatchObject({daily:{used:0,reserved:0,remaining:2},canReceiveToday:true});
 const a=await createPayoutRequest(f.scope,f.input(0),db);
 expect(await row()).toMatchObject({daily:{used:0,reserved:1,remaining:1},canReceiveToday:true});
 await createPayoutRequest(f.scope,f.input(1),db);
 expect(await row()).toMatchObject({daily:{used:0,reserved:2,remaining:0},canReceiveToday:false});
 await f.update(a.id,'CANCELLED');
 expect(await row()).toMatchObject({daily:{remaining:1},canReceiveToday:true});
 await db.payPalAccount.update({where:{id:f.pp.id},data:{status:'LIMITED'}});
 expect((await row()).canReceiveToday).toBe(false);
 }finally{await f.cleanup();}
});
