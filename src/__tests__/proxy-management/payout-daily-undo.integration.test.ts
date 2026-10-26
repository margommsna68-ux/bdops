import {afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {VirtualMachine,EarnAppAccount,PayPalEmail} from '@prisma/client';
import {readFileSync} from 'node:fs';
import {businessDB as db,businessFixture} from './business-fixture';
import {createPayoutRequest,updatePayoutRequest} from '@/server/vm-ops/payout';
import {readPayoutDaily} from '@/server/vm-ops/payout-daily';
import {undoOperation} from '@/server/operation-history/undo';

afterAll(()=>db.$disconnect());
async function setup(){
 const f=await businessFixture(),projectId=f.scope.projectId,pp=await db.payPalAccount.create({data:{projectId,code:'PP-undo',primaryEmail:randomUUID()+'@example.invalid'}}),rows:{vm:VirtualMachine;ea:EarnAppAccount;email:PayPalEmail}[]=[];
 for(let i=0;i<3;i++){const vm=await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_U'+i,managed:true,proxySlotState:'BLANK'}}),login=await db.gmailAccount.create({data:{projectId,email:randomUUID()+'@example.invalid'}}),ea=await db.earnAppAccount.create({data:{projectId,loginId:login.id,vmId:vm.id}}),email=await db.payPalEmail.create({data:{projectId,paypalId:pp.id,email:randomUUID()+'@example.invalid'}});rows.push({vm,ea,email});}
 const input=(n:number)=>({key:randomUUID(),vmId:rows[n].vm.id,expectedCycle:1,earnAppId:rows[n].ea.id,paypalEmailId:rows[n].email.id,amount:'10',date:'2026-10-19',submission:'PREPARING' as const});
 return {...f,pp,rows,input};
}
it('undo of cancellation cannot reopen a third reserved email',async()=>{
 const f=await setup();try{const a=await createPayoutRequest(f.scope,f.input(0),db),key=randomUUID();await updatePayoutRequest(f.scope,{key,requestId:a.id,expectedRevision:0,action:'CANCELLED',note:'Not sent'},db);
 await createPayoutRequest(f.scope,f.input(1),db);await createPayoutRequest(f.scope,f.input(2),db);
 const op=await db.operationJournal.findUniqueOrThrow({where:{projectId_commandKey:{projectId:f.scope.projectId,commandKey:key}}});
 await expect(undoOperation(f.scope,op.id,'Restore draft',db)).rejects.toMatchObject({reason:'PAYPAL_DAILY_LIMIT'});
 expect((await db.earnPayoutRequest.findUniqueOrThrow({where:{id:a.id}})).state).toBe('CANCELLED');
 expect((await db.payPalEmail.findUniqueOrThrow({where:{id:f.rows[0].email.id}})).holdEarnAppId).toBeNull();
 }finally{await f.cleanup();}
});
it('undo of sent record keeps its consumed slot even if the request is removed',async()=>{
 const f=await setup();try{const row=f.rows[0];await db.earnAppAccount.update({where:{id:row.ea.id},data:{paypalId:f.pp.id,paypalEmailId:row.email.id}});await db.payPalEmail.update({where:{id:row.email.id},data:{usedEarnAppId:row.ea.id,usedAt:new Date()}});
 const input={...f.input(0),submission:'SENT' as const};await createPayoutRequest(f.scope,input,db);const op=await db.operationJournal.findUniqueOrThrow({where:{projectId_commandKey:{projectId:f.scope.projectId,commandKey:input.key}}});await undoOperation(f.scope,op.id,'Undo web record only',db);
 await createPayoutRequest(f.scope,f.input(1),db);await expect(createPayoutRequest(f.scope,f.input(2),db)).rejects.toMatchObject({reason:'PAYPAL_DAILY_LIMIT'});
 }finally{await f.cleanup();}
});
it('migration preserves failed sends and cancelled uncertain attempts on the correct Vietnam day',async()=>{
 const f=await setup();try{for(let i=0;i<3;i++){const at=new Date(i===2?'2026-10-26T16:59:59Z':'2026-10-26T17:00:00Z'),row=f.rows[i];await db.earnPayoutRequest.create({data:{projectId:f.scope.projectId,earnAppId:row.ea.id,vmId:row.vm.id,cycle:1,paypalId:f.pp.id,paypalEmailId:row.email.id,amount:'10',requestedAt:new Date('2001-01-01'),requestedById:f.scope.userId,state:i===1?'CANCELLED':'FAILED',submission:i===1?'UNKNOWN':'SENT',submittedAt:i===1?null:at,history:i===1?[{at:at.toISOString(),kind:'UNKNOWN',what:'Synthetic uncertain result'}]:[]}});}
 const sql=readFileSync('prisma/migrations/20261026110000_paypal_daily_emails/migration.sql','utf8');await db.$executeRawUnsafe(sql.slice(sql.indexOf('WITH evidence AS')));
 const day=await readPayoutDaily(db,f.scope.projectId,new Date('2026-10-27T00:00:00Z'));expect(day.summary(f.pp.id)).toMatchObject({date:'2026-10-27',used:2,reserved:0,remaining:0});expect(day.allowed(f.pp.id,f.rows[2].email.id)).toBe(false);
 expect(await db.payPalPayoutDayEmail.count({where:{paypalId:f.pp.id,day:'2026-10-26'}})).toBe(1);
 }finally{await f.cleanup();}
});
it('follow-up migration records today when an older UNKNOWN was retried and cancelled today',async()=>{
 const f=await setup();try{const row=f.rows[0];await db.earnPayoutRequest.create({data:{projectId:f.scope.projectId,earnAppId:row.ea.id,vmId:row.vm.id,cycle:1,paypalId:f.pp.id,paypalEmailId:row.email.id,amount:'10',requestedAt:new Date('2026-10-25'),requestedById:f.scope.userId,state:'CANCELLED',submission:'UNKNOWN',history:[{kind:'UNKNOWN',at:'2026-10-26T16:00:00.000Z'},{kind:'FAILED',at:'2026-10-26T16:30:00.000Z'},{kind:'RETRY',at:'2026-10-26T17:00:00.000Z'},{kind:'CANCELLED',at:'2026-10-26T17:01:00.000Z'}]}});
 for(const migration of ['20261026110000_paypal_daily_emails','20261026110100_paypal_daily_retry_evidence']){const sql=readFileSync(`prisma/migrations/${migration}/migration.sql`,'utf8');await db.$executeRawUnsafe(sql.slice(sql.indexOf('WITH evidence AS')));}
 expect((await readPayoutDaily(db,f.scope.projectId,new Date('2026-10-27T00:00:00Z'))).summary(f.pp.id)).toMatchObject({used:1,remaining:1});
 }finally{await f.cleanup();}
});
it('legacy overbooked preparations cannot all be marked sent',async()=>{
 const f=await setup();try{const req=[];for(const [i,row] of f.rows.entries())req.push(await db.earnPayoutRequest.create({data:{projectId:f.scope.projectId,earnAppId:row.ea.id,vmId:row.vm.id,cycle:1,paypalId:f.pp.id,paypalEmailId:row.email.id,amount:'10',requestedAt:new Date(),requestedById:f.scope.userId,submission:'PREPARING',createdAt:new Date(Date.now()-1000+i)}}));
 await expect(updatePayoutRequest(f.scope,{key:randomUUID(),requestId:req[2].id,expectedRevision:0,action:'SENT'},db)).rejects.toMatchObject({reason:'PAYPAL_DAILY_LIMIT'});
 const daily=await readPayoutDaily(db,f.scope.projectId);expect(daily.allowed(f.pp.id,f.rows[0].email.id)).toBe(true);expect(daily.allowed(f.pp.id,f.rows[1].email.id)).toBe(true);expect(daily.allowed(f.pp.id,f.rows[2].email.id)).toBe(false);
 }finally{await f.cleanup();}
});
