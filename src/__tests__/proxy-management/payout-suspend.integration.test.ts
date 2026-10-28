import {afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {VirtualMachine,EarnAppAccount,PayPalEmail} from '@prisma/client';
import {businessDB as db,businessFixture} from './business-fixture';
import {createPayoutRequest,recordPayoutReceipt,pendingByPaypal,readVmOps} from '@/server/vm-ops/payout';
import {readPayoutReport} from '@/server/vm-ops/payout-report';
import {recordRecreated,recreateRule,setVmStatus} from '@/server/vm-ops/ops';
import {memberOf} from '@/server/vm-ops/payout-members';
import {markEarnAppSuspended} from '@/server/vm-ops/suspend';
import {undoOperation} from '@/server/operation-history/undo';

// Payout simplification, Task 5 (owner 28/10/2026): "EarnApp bị SUS" closes the payout of the round and retires its receiving email.
// Synthetic data only (example.invalid), test database only.
afterAll(()=>db.$disconnect());
type Row={vm:VirtualMachine;ea:EarnAppAccount;email:PayPalEmail};
async function setup(n=2){
 const f=await businessFixture(),projectId=f.scope.projectId;
 const pp=await db.payPalAccount.create({data:{projectId,code:'PP-sus-1',primaryEmail:randomUUID()+'@example.invalid'}});
 const rows:Row[]=[];for(let i=0;i<n;i++){
  const vm=i?await db.virtualMachine.create({data:{serverId:f.server.id,code:`VM_S${i}`,managed:true,proxySlotState:'BLANK'}}):f.vm;
  const login=await db.gmailAccount.create({data:{projectId,email:randomUUID()+'@example.invalid'}});
  const ea=await db.earnAppAccount.create({data:{projectId,loginId:login.id,vmId:vm.id}});
  rows.push({vm,ea,email:await db.payPalEmail.create({data:{projectId,paypalId:pp.id,email:randomUUID()+'@example.invalid'}})});
 }
 const req=(id:string)=>db.earnPayoutRequest.findUniqueOrThrow({where:{id}});
 const create=(i:number,amount:string,submission:'PREPARING'|'SENT',extra:Record<string,unknown>={})=>createPayoutRequest(f.scope,{key:randomUUID(),vmId:rows[i].vm.id,expectedCycle:1,earnAppId:rows[i].ea.id,paypalEmailId:rows[i].email.id,amount,date:'2026-10-19',submission,...extra},db);
 const receipt=async(id:string,amount:string)=>recordPayoutReceipt(f.scope,{key:randomUUID(),requestId:id,expectedRequestRevision:(await req(id)).revision,amount,currency:'USD',receivedAt:new Date().toISOString()},db);
 const sus=(i:number,key=randomUUID())=>markEarnAppSuspended(f.scope,{key,vmId:rows[i].vm.id,expectedCycle:1},db);
 const email=(id:string)=>db.payPalEmail.findUniqueOrThrow({where:{id}});
 const ops=(i:number)=>db.vmOperation.findUnique({where:{vmId:rows[i].vm.id}});
 const vmOps=async(i:number)=>({id:rows[i].vm.id,operation:await ops(i)});
 const journal=(key:string)=>db.operationJournal.findUnique({where:{projectId_commandKey:{projectId,commandKey:key}}});
 const cleanup=async()=>{await db.earnPayoutRequestVoid.deleteMany({where:{projectId}});await db.operationJournal.deleteMany({where:{projectId}});await f.cleanup();};
 return {...f,cleanup,pp,rows,req,create,receipt,sus,email,ops,vmOps,journal};
}
const last=(history:unknown)=>(history as {kind?:string;what:string}[]).at(-1);

it('SUS on a SENT waiting request',async()=>{
 const f=await setup();try{const a=f.rows[0];
 const r=await f.create(0,'15','SENT');await f.receipt(r.id,'5');
 const key=randomUUID(),out=await f.sus(0,key);
 expect(out).toMatchObject({vmId:a.vm.id,cycle:1,changed:true,request:{id:r.id,outcome:'LOST',lostAmount:'10.00'}});
 expect(out.archivedEmailIds).toEqual([a.email.id]);
 const row=await f.req(r.id);expect(row.state).toBe('LOST_SUS');expect(row.lostAmount?.toFixed(2)).toBe('10.00');expect(row.lostAt).not.toBeNull();
 expect(last(row.history)).toMatchObject({kind:'SUS',what:expect.stringMatching(/EarnApp bị SUS: mất 10,00 USD/)});
 expect((await pendingByPaypal(db,f.scope.projectId)).get(f.pp.id)).toBeUndefined();
 expect((await f.ops(0))?.status).toBe('SUSPENDED');
 expect((await db.vmOpsEvent.findFirst({where:{vmId:a.vm.id,kind:'STATUS'},orderBy:{createdAt:'desc'}}))?.toStatus).toBe('SUSPENDED');
 expect((await f.email(a.email.id)).archivedAt).not.toBeNull();
 expect(await recreateRule(db,f.scope.projectId,await f.vmOps(0))).toMatchObject({refusal:null,reason:'SUSPENDED'});
 expect(await f.journal(key)).toMatchObject({kind:'EARN_SUSPEND',accessModule:'INFRASTRUCTURE',reversible:true});
 }finally{await f.cleanup();}
});
it('SUS on a PREPARING request voids it and returns the email',async()=>{
 const f=await setup();try{const a=f.rows[0];
 const r=await f.create(0,'10','PREPARING');expect((await f.email(a.email.id)).holdEarnAppId).toBe(a.ea.id);
 const out=await f.sus(0);
 expect(out).toMatchObject({request:{id:r.id,outcome:'VOIDED',lostAmount:null},archivedEmailIds:[]});
 expect(await db.earnPayoutRequest.findUnique({where:{id:r.id}})).toBeNull();
 const v=await db.earnPayoutRequestVoid.findFirstOrThrow({where:{requestId:r.id}});expect(v.reason).toMatch(/EarnApp bị SUS/);
 expect(await f.email(a.email.id)).toMatchObject({archivedAt:null,holdEarnAppId:null});
 expect((await f.ops(0))?.status).toBe('SUSPENDED');
 }finally{await f.cleanup();}
});
it('SUS with no request only marks SUS and archives the EarnApp\'s receiving email',async()=>{
 const f=await setup();try{const a=f.rows[0],other=f.rows[1].email;
 await db.earnAppAccount.update({where:{id:a.ea.id},data:{paypalId:f.pp.id,paypalEmailId:a.email.id}});
 await db.payPalEmail.update({where:{id:a.email.id},data:{usedEarnAppId:a.ea.id,usedAt:new Date()}});
 const before=(await f.email(a.email.id)).revision;
 const out=await f.sus(0);
 expect(out).toMatchObject({request:{id:null,outcome:null,lostAmount:null},archivedEmailIds:[a.email.id]});
 const e=await f.email(a.email.id);expect(e.archivedAt).not.toBeNull();expect(e.revision).toBe(before+1);
 expect((await f.email(other.id)).archivedAt).toBeNull();
 expect((await f.ops(0))?.status).toBe('SUSPENDED');
 }finally{await f.cleanup();}
});
it('SUS on a merged primary',async()=>{
 const f=await setup(2);try{const member=f.rows[1].vm;
 const r=await f.create(0,'20','SENT',{members:[{vmId:member.id,expectedCycle:1}]});
 const out=await f.sus(0);expect(out.request).toMatchObject({id:r.id,outcome:'LOST',lostAmount:'20.00'});
 expect((await f.req(r.id)).state).toBe('LOST_SUS');
 expect(await db.earnPayoutMember.findFirst({where:{requestId:r.id,vmId:member.id}})).toMatchObject({removedAt:null});
 expect(await recreateRule(db,f.scope.projectId,{id:member.id,operation:await db.vmOperation.findUnique({where:{vmId:member.id}})})).toMatchObject({refusal:null,reason:'SUSPENDED'});
 const report=await readPayoutReport(f.scope,{},db);
 const rows=report.rows.filter(x=>x.vmId===member.id||x.members.some(m=>m.vmId===member.id));
 expect(rows.length).toBeGreaterThan(0);expect(rows.every(x=>x.status!=='WAITING')).toBe(true);
 }finally{await f.cleanup();}
});
it('SUS on a PREPARING merged primary removes the members, then voids the request',async()=>{
 const f=await setup(2);try{const member=f.rows[1].vm;
 const r=await f.create(0,'20','PREPARING',{members:[{vmId:member.id,expectedCycle:1}]});
 const out=await f.sus(0);expect(out.request).toMatchObject({id:r.id,outcome:'VOIDED'});
 expect(await db.earnPayoutRequest.findUnique({where:{id:r.id}})).toBeNull();
 const v=await db.earnPayoutRequestVoid.findFirstOrThrow({where:{requestId:r.id}});
 expect((v.snapshot as {members:{vmId:string;removedAt:string|null}[]}).members).toEqual([expect.objectContaining({vmId:member.id,removedAt:expect.any(String)})]);
 }finally{await f.cleanup();}
});
it('undo of SUS on a PREPARING merged primary brings the request back with its members active',async()=>{
 const f=await setup(2);try{const member=f.rows[1].vm;
 const r=await f.create(0,'20','PREPARING',{members:[{vmId:member.id,expectedCycle:1}]});
 const key=randomUUID();await f.sus(0,key);
 await undoOperation(f.scope,(await f.journal(key))!.id,'Bấm nhầm',db);
 expect(await f.req(r.id)).toMatchObject({state:'REQUESTED',submission:'PREPARING'});
 expect(await db.earnPayoutMember.findFirstOrThrow({where:{requestId:r.id,vmId:member.id}})).toMatchObject({removedAt:null,removedById:null});
 expect(await db.earnPayoutRequestVoid.count({where:{requestId:r.id}})).toBe(0);
 }finally{await f.cleanup();}
});
it('choosing SUS in setVmStatus closes the payout the same way',async()=>{
 const f=await setup();try{const a=f.rows[0];
 const r=await f.create(0,'15','SENT');await f.receipt(r.id,'5');
 const res=await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:a.vm.id,status:'SUSPENDED',expectedCycle:1}]},db);
 expect(res.applied).toBe(1);
 const row=await f.req(r.id);expect(row.state).toBe('LOST_SUS');expect(row.lostAmount?.toFixed(2)).toBe('10.00');expect(last(row.history)?.kind).toBe('SUS');
 expect((await f.email(a.email.id)).archivedAt).not.toBeNull();
 expect((await f.ops(0))?.status).toBe('SUSPENDED');
 expect((await pendingByPaypal(db,f.scope.projectId)).get(f.pp.id)).toBeUndefined();
 }finally{await f.cleanup();}
});
it('SUS twice is a no-op',async()=>{
 const f=await setup();try{
 const r=await f.create(0,'15','SENT');await f.sus(0);const rev=(await f.req(r.id)).revision;
 const count=await db.operationJournal.count({where:{projectId:f.scope.projectId}});
 const key=randomUUID(),again=await f.sus(0,key);
 expect(again).toMatchObject({changed:false,request:{id:r.id,outcome:null},archivedEmailIds:[]});
 expect(await db.operationJournal.count({where:{projectId:f.scope.projectId}})).toBe(count);expect(await f.journal(key)).toBeNull();
 expect((await f.req(r.id)).revision).toBe(rev);
 }finally{await f.cleanup();}
});
it('undo of SUS restores request state, email and status',async()=>{
 const f=await setup();try{const a=f.rows[0];
 await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:a.vm.id,status:'OK',expectedCycle:1}]},db);
 const r=await f.create(0,'15','SENT');await f.receipt(r.id,'5');
 const key=randomUUID();await f.sus(0,key);
 await undoOperation(f.scope,(await f.journal(key))!.id,'Bấm nhầm',db);
 const row=await f.req(r.id);expect(row).toMatchObject({state:'REQUESTED',lostAmount:null,lostAt:null});
 expect((await f.email(a.email.id)).archivedAt).toBeNull();
 expect((await f.ops(0))?.status).toBe('OK');
 expect((await pendingByPaypal(db,f.scope.projectId)).get(f.pp.id)).toEqual({USD:1000});
 }finally{await f.cleanup();}
});
it('undo of SUS on a PREPARING request brings the request and its hold back',async()=>{
 const f=await setup();try{const a=f.rows[0];
 const r=await f.create(0,'10','PREPARING');const key=randomUUID();await f.sus(0,key);
 await undoOperation(f.scope,(await f.journal(key))!.id,'Bấm nhầm',db);
 expect(await f.req(r.id)).toMatchObject({state:'REQUESTED',submission:'PREPARING'});
 expect((await f.email(a.email.id)).holdEarnAppId).toBe(a.ea.id);
 expect((await f.ops(0))?.status??null).not.toBe('SUSPENDED');
 }finally{await f.cleanup();}
});
it('SUS needs the VM status right; a stale round is refused',async()=>{
 const f=await setup();try{const a=f.rows[0];
 await expect(markEarnAppSuspended(f.scope,{key:randomUUID(),vmId:a.vm.id,expectedCycle:2},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
 // A viewer may not write VM status; the worker (USER, Server / VM) may, like the status cell.
 await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.worker.userId},data:{role:'VIEWER'}});
 await expect(markEarnAppSuspended(f.worker,{key:randomUUID(),vmId:a.vm.id,expectedCycle:1},db)).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();}
});
it('a SUS on a received request leaves it as it is',async()=>{
 const f=await setup();try{const a=f.rows[0];
 const r=await f.create(0,'10','SENT');await f.receipt(r.id,'10');
 const out=await f.sus(0);expect(out.request).toMatchObject({id:r.id,outcome:null});
 expect((await f.req(r.id)).state).toBe('REQUESTED');expect((await f.email(a.email.id)).archivedAt).not.toBeNull();
 expect(await recreateRule(db,f.scope.projectId,await f.vmOps(0))).toMatchObject({reason:'PAYOUT_RECEIVED'});
 }finally{await f.cleanup();}
});
// ─── Review fix round 1 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const memberRule=async(vmId:string)=>({id:vmId,operation:await db.vmOperation.findUnique({where:{vmId}})});
it('a member still recreates as SUSPENDED after the SUS primary status was changed away (LOST_SUS is the SUS fact)',async()=>{
 const f=await setup(2);try{const member=f.rows[1].vm;
 await f.create(0,'20','SENT',{members:[{vmId:member.id,expectedCycle:1}]});await f.sus(0);
 const res=await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.rows[0].vm.id,status:'OFF',expectedCycle:1}]},db);expect(res.applied).toBe(1);
 expect(await recreateRule(db,f.scope.projectId,await memberRule(member.id))).toMatchObject({refusal:null,reason:'SUSPENDED'});
 expect(await recreateRule(db,f.scope.projectId,await f.vmOps(0))).toMatchObject({refusal:null,reason:'SUSPENDED'});
 }finally{await f.cleanup();}
});
it('a member of a LOST_SUS request that joined a live merged payout waits for the live one',async()=>{
 const f=await setup(3);try{const member=f.rows[1].vm;
 const lost=await f.create(0,'20','SENT',{members:[{vmId:member.id,expectedCycle:1}]});await f.sus(0);
 const live=await f.create(2,'12','SENT',{members:[{vmId:member.id,expectedCycle:1}]});
 const m=await memberOf(db,f.scope.projectId,member.id,1);expect(m?.request.id).toBe(live.id);expect(m?.request.id).not.toBe(lost.id);
 expect(await recreateRule(db,f.scope.projectId,await memberRule(member.id))).toMatchObject({reason:null,refusal:expect.stringMatching(/chưa về đủ/)});
 await expect(recordRecreated(f.scope,{key:randomUUID(),vmId:member.id,expectedCycle:1},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
 }finally{await f.cleanup();}
});
it('bulk SUS: a row whose preparation cannot be voided is an ERROR row, the others are closed',async()=>{
 const f=await setup(2);try{const a=f.rows[0],b=f.rows[1];
 const prep=await f.create(0,'10','PREPARING');const sent=await f.create(1,'15','SENT');
 await db.fundTransaction.create({data:{projectId:f.scope.projectId,paypalId:f.pp.id,paypalEmailId:a.email.id,earnAppId:a.ea.id,date:new Date(),amount:'1',transactionId:'TX-SUS-'+randomUUID()}});
 const res=await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:a.vm.id,status:'SUSPENDED',expectedCycle:1},{vmId:b.vm.id,status:'SUSPENDED',expectedCycle:1}]},db);
 expect(res.rows.map(r=>r.outcome)).toEqual(['ERROR','APPLIED']);expect(res.rows[0].message).toMatch(/đã nhận tiền/);
 expect(await f.req(prep.id)).toMatchObject({state:'REQUESTED',submission:'PREPARING'});expect((await f.email(a.email.id)).archivedAt).toBeNull();
 expect((await f.ops(0))?.status??null).not.toBe('SUSPENDED');
 expect((await f.req(sent.id)).state).toBe('LOST_SUS');expect((await f.ops(1))?.status).toBe('SUSPENDED');
 await expect(f.sus(0)).rejects.toMatchObject({code:'INVALID_INPUT'});
 }finally{await db.fundTransaction.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();}
});
it('SUS then recordRecreated: EarnApp closed SUSPENDED, the round closed without a payout, new round NEW_VM',async()=>{
 const f=await setup(1);try{const a=f.rows[0];
 const r=await f.create(0,'15','SENT');await f.sus(0);
 expect(await recordRecreated(f.scope,{key:randomUUID(),vmId:a.vm.id,expectedCycle:1},db)).toMatchObject({cycle:2,reason:'SUSPENDED'});
 expect(await db.earnAppAccount.findUniqueOrThrow({where:{id:a.ea.id}})).toMatchObject({vmId:null,closedReason:'SUSPENDED'});
 expect(await db.vmCycle.findFirstOrThrow({where:{vmId:a.vm.id,number:1}})).toMatchObject({reason:'SUSPENDED',payoutRequestId:null});
 expect(await f.ops(0)).toMatchObject({cycle:2,status:'NEW_VM'});
 expect(await f.req(r.id)).toMatchObject({state:'LOST_SUS',consumedAt:null});
 }finally{await f.cleanup();}
});

// ─── Task 6: the board queue "Chờ tạo lại" equals what recreateRule allows ─────────────────────────────────────────────────
it('board shows RECREATE for paid, SUS and merged-SUS members, nothing for waiting',async()=>{
 const f=await setup(5);try{
 // 0: paid in full, 1: waiting (SENT, nothing yet), 2: SUS primary with member 3, 4: waiting primary with member
 const paid=await f.create(0,'10','SENT');await f.receipt(paid.id,'10');
 // other PayPal codes: the 2 emails / day limit is per PP code
 for(const i of [1,4]){const pp2=await db.payPalAccount.create({data:{projectId:f.scope.projectId,code:'PP-sus-b'+i,primaryEmail:randomUUID()+'@example.invalid'}});await db.payPalEmail.update({where:{id:f.rows[i].email.id},data:{paypalId:pp2.id}});}
 await f.create(1,'10','SENT');
 await f.create(2,'20','SENT',{members:[{vmId:f.rows[3].vm.id,expectedCycle:1}]});await f.sus(2);
 const board=async()=>new Map((await readVmOps(f.scope,db)).vms.map(v=>[v.vmId,v.milestone]));
 const m=await board();
 expect(m.get(f.rows[0].vm.id)).toBe('RECREATE');
 expect(m.get(f.rows[1].vm.id)).toBe('WAITING');
 expect(m.get(f.rows[2].vm.id)).toBe('RECREATE');
 expect(m.get(f.rows[3].vm.id)).toBe('RECREATE');
 expect(m.get(f.rows[4].vm.id)).toBe('');
 // every VM the board queues is allowed by recreateRule, and nothing else is
 for(const [i,row] of f.rows.entries()){const rule=await recreateRule(db,f.scope.projectId,await f.vmOps(i));expect(m.get(row.vm.id)==='RECREATE').toBe(rule.refusal===null);}
 }finally{await f.cleanup();}
});
it('a VM recorded SUS by hand (no request) is queued for recreation',async()=>{
 const f=await setup(1);try{
 await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.rows[0].vm.id,status:'SUSPENDED',expectedCycle:1}]},db);
 expect((await readVmOps(f.scope,db)).vms.find(v=>v.vmId===f.rows[0].vm.id)?.milestone).toBe('RECREATE');
 }finally{await f.cleanup();}
});
