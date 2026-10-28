import {afterAll,afterEach,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {businessDB as db,businessFixture} from './business-fixture';
import {readPayoutReport,readPayoutDashboard,readPayoutVoided,findPayoutByTransaction} from '@/server/vm-ops/payout-report';
import {appRouter} from '@/server/routers/_app';

afterAll(()=>db.$disconnect());
afterEach(()=>vi.useRealTimers());
async function fixture(){
 const f=await businessFixture(),projectId=f.scope.projectId;
 const pp=await db.payPalAccount.create({data:{projectId,code:'PP-report',primaryEmail:randomUUID()+'@fixture.invalid'}});
 async function request(change:Partial<Prisma.EarnPayoutRequestUncheckedCreateInput>={}){
  const login=await db.gmailAccount.create({data:{projectId,email:randomUUID()+'@fixture.invalid'}});
  const ea=await db.earnAppAccount.create({data:{projectId,loginId:login.id}});
  const email=await db.payPalEmail.create({data:{projectId,paypalId:pp.id,email:randomUUID()+'@fixture.invalid'}});
  return db.earnPayoutRequest.create({data:{projectId,earnAppId:ea.id,vmId:f.vm.id,cycle:1,paypalId:pp.id,paypalEmailId:email.id,
   amount:'10',requestedAt:new Date('2026-10-26T12:00:00Z'),requestedById:f.scope.userId,submittedAt:new Date('2026-10-26T12:01:00Z'),...change}});
 }
 async function receipt(requestId:string,change:Partial<Prisma.FundTransactionUncheckedCreateInput>={}){
  return db.fundTransaction.create({data:{projectId,paypalId:pp.id,payoutRequestId:requestId,date:new Date('2026-10-27T00:00:00+07:00'),
   amount:'3',currency:'USD',transactionId:randomUUID(),confirmed:true,...change}});
 }
 const cleanup=async()=>{
  await f.cleanup();
  expect(await db.earnPayoutRequest.count({where:{projectId}})).toBe(0);
  expect(await db.fundTransaction.count({where:{projectId}})).toBe(0);
  expect(await db.project.findUnique({where:{id:projectId}})).toBeNull();
 };
 return {...f,pp,request,receipt,cleanup};
}

const dashboardClock=()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-26T17:00:00.001Z'));};
const cardsToViews={sent:'SENT_TODAY',waiting:'WAITING',received:'RECEIVED_TODAY',attention:'ATTENTION'} as const;
it('dashboard and focused report share Bangkok day, submission/receipt selection, lifetime history and separate receipt currencies',async()=>{
 dashboardClock();const f=await fixture();try{
  const before=await f.request({submittedAt:new Date('2026-10-26T16:59:59.999Z')});
  const sent=await f.request({amount:'7',state:'FAILED',requestedAt:new Date('2026-09-01T00:00:00Z'),submittedAt:new Date('2026-10-26T17:00:00Z')});
  const cancelled=await f.request({amount:'8',state:'CANCELLED',submittedAt:new Date('2026-10-26T17:00:00Z')});
  const old=await f.request({cycle:1,requestedAt:new Date('2026-09-02T00:00:00Z'),submittedAt:new Date('2026-09-02T00:01:00Z')});
  await db.earnAppAccount.update({where:{id:old.earnAppId},data:{closedAt:new Date()}});
  await db.vmOperation.create({data:{projectId:f.scope.projectId,vmId:f.vm.id,cycle:2,status:'DELETED'}});
  await f.receipt(old.id,{amount:'2',date:new Date('2026-10-26T00:00:00+07:00')});
  await f.receipt(old.id,{amount:'3.25',date:new Date('2026-10-27T00:00:00+07:00')});
  await f.receipt(old.id,{amount:'4',date:new Date('2026-10-28T00:00:00+07:00')});
  await f.receipt(old.id,{amount:'99',confirmed:false});
  await f.receipt(old.id,{amount:'98',confirmed:false,failed:true});
  await f.receipt(old.id,{amount:'97',voidedAt:new Date()});
  const mismatch=await f.request();await f.receipt(mismatch.id,{amount:'5',currency:'VND'});
  await f.request({amount:'6',submission:'UNKNOWN',submittedAt:null});
  await f.request({submission:'PREPARING',submittedAt:null});
  const dashboard=await readPayoutDashboard(f.scope,{},db);if(!dashboard.available)throw Error('expected available');
  expect(dashboard.day).toBe('2026-10-27');expect(dashboard.updatedAt).toBe('2026-10-26T17:00:00.001Z');
  expect(dashboard.cards.sent).toEqual({requests:2,vms:1,amounts:[{currency:'USD',amount:'15.00'}]});
  expect(dashboard.cards.received).toEqual({requests:2,vms:1,amounts:[{currency:'USD',amount:'3.25'},{currency:'VND',amount:'5.00'}]});
  expect(dashboard.cards.attention).toEqual({requests:3,vms:1,amounts:[{currency:'USD',amount:'23.00'}]});
  expect(dashboard.cards.waiting).toEqual({requests:2,vms:1,amounts:[{currency:'USD',amount:'10.75'}]});
  for(const [card,view] of Object.entries(cardsToViews)){
   const report=await readPayoutReport(f.scope,{view,day:dashboard.day},db);
   expect(report.focus).toEqual({view,day:dashboard.day,...dashboard.cards[card as keyof typeof cardsToViews]});
   expect(report.total).toBe(dashboard.cards[card as keyof typeof cardsToViews].requests);
  }
  const received=await readPayoutReport(f.scope,{view:'RECEIVED_TODAY'},db);
  expect(received.rows.find(r=>r.id===old.id)).toMatchObject({cycle:1,current:false,received:'9.25',receivedInView:[{currency:'USD',amount:'3.25'}]});
  expect(received.summary.find(s=>s.currency==='USD')?.received).toBe('3.25');
  expect(received.summary.find(s=>s.currency==='VND')?.received).toBe('5.00');
  const todaySent=await readPayoutReport(f.scope,{view:'SENT_TODAY'},db);
  expect(todaySent.rows.map(r=>r.id).sort()).toEqual([sent.id,cancelled.id].sort());
  expect(todaySent.summary[0].sent).toBe('15.00');expect(todaySent.rows.every(r=>r.receivedInView===null)).toBe(true);
  expect((await readPayoutReport(f.scope,{view:'SENT_TODAY',day:'2026-10-26'},db)).rows.map(r=>r.id)).toContain(before.id);
  expect((await readPayoutReport(f.scope,{},db)).focus).toBeNull();
 }finally{await f.cleanup();}
});

it('LOST_SUS is status LOST: not waiting, not attention, not on the dashboard cards, and adds to the lost total per currency',async()=>{
 dashboardClock();const f=await fixture();try{
  const lost=await f.request({amount:'15',state:'LOST_SUS',lostAmount:'10.00',lostAt:new Date('2026-10-26T12:30:00Z')});
  await f.receipt(lost.id,{amount:'5'});
  const lost2=await f.request({amount:'3',state:'LOST_SUS',lostAmount:'2.50',lostAt:new Date('2026-10-26T12:31:00Z')});
  const lostVnd=await f.request({amount:'500',currency:'VND',state:'LOST_SUS',lostAmount:'500.00',lostAt:new Date('2026-10-26T12:32:00Z')});
  const waiting=await f.request({amount:'4'});
  const report=await readPayoutReport(f.scope,{},db);
  expect(report.rows.find(r=>r.id===lost.id)).toMatchObject({status:'LOST',amount:'15.00',received:'5.00',remaining:'0.00',lostAmount:'10.00'});
  expect(report.rows.find(r=>r.id===waiting.id)).toMatchObject({status:'WAITING',remaining:'4.00',lostAmount:'0.00'});
  // Lost money is a separate bucket: only the live request is still "waiting"; the 5.00 actually received stays received.
  expect(report.summary.find(s=>s.currency==='USD')).toMatchObject({waiting:'4.00',received:'5.00',unknown:'0.00'});
  expect(report.summary.find(s=>s.currency==='VND')).toMatchObject({waiting:'0.00',received:'0.00'});
  expect(report.lost).toEqual({USD:'12.50',VND:'500.00'});
  expect((await readPayoutReport(f.scope,{status:'LOST'},db)).rows.map(r=>r.id).sort()).toEqual([lost.id,lost2.id,lostVnd.id].sort());
  const waitingView=await readPayoutReport(f.scope,{view:'WAITING'},db),attention=await readPayoutReport(f.scope,{view:'ATTENTION'},db);
  expect(waitingView.rows.map(r=>r.id)).toEqual([waiting.id]);expect(attention.rows).toEqual([]);
  expect(attention.lost).toEqual({});
  const dashboard=await readPayoutDashboard(f.scope,{},db);if(!dashboard.available)throw Error('expected available');
  expect(dashboard.cards.waiting).toEqual({requests:1,vms:1,amounts:[{currency:'USD',amount:'4.00'}]});
  expect(dashboard.cards.attention).toEqual({requests:0,vms:0,amounts:[]});
  // Same enum through the router: the new status is a valid filter.
  const caller=appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId,email:'fixture@invalid'},expires:new Date(Date.now()+60000).toISOString()} as never});
  const viaRouter=await caller.vmOps.payoutReport({projectId:f.scope.projectId,status:'LOST'});
  expect(viaRouter.total).toBe(3);expect(viaRouter.lost).toEqual({USD:'12.50',VND:'500.00'});
 }finally{await f.cleanup();}
});

it('focused totals cover more than 50 historical requests and count distinct VMs within the selected server',async()=>{
 dashboardClock();const f=await fixture();try{
  const second=await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_002',managed:true}});
  for(let i=0;i<53;i++)await f.request({vmId:i%2?second.id:f.vm.id,requestedAt:new Date('2025-01-01T00:00:00Z'),submittedAt:new Date('2026-10-26T17:00:00Z')});
  const anotherServer=await db.server.create({data:{projectId:f.scope.projectId,code:'ANOTHER'}});
  const outside=await db.virtualMachine.create({data:{serverId:anotherServer.id,code:'OUTSIDE',managed:true}});
  await f.request({vmId:outside.id,submittedAt:new Date('2026-10-26T17:00:00Z')});
  const input={serverId:f.server.id,view:'SENT_TODAY' as const};
  const report=await readPayoutReport(f.scope,{...input,page:2},db),dashboard=await readPayoutDashboard(f.scope,{serverId:f.server.id},db);
  if(!dashboard.available)throw Error('expected available');
  expect(report).toMatchObject({page:2,pages:2,total:53});expect(report.rows).toHaveLength(3);
  expect(report.focus).toEqual({view:'SENT_TODAY',day:'2026-10-27',requests:53,vms:2,amounts:[{currency:'USD',amount:'530.00'}]});
  expect(report.focus).toEqual({view:'SENT_TODAY',day:dashboard.day,...dashboard.cards.sent});
 }finally{await f.cleanup();}
});

it('view day validates real calendar dates and rejects ambiguous request-date ranges',async()=>{
 dashboardClock();const f=await fixture();try{
  for(const input of [{view:'INVALID'},{view:'SENT_TODAY',day:'2026-02-29'},{view:'RECEIVED_TODAY',day:'2026-13-01'},
   {view:'WAITING',day:'20261027'},{view:'ATTENTION',from:'2026-10-01'},{view:'SENT_TODAY',to:'2026-10-27'}])
   await expect(readPayoutReport(f.scope,input,db)).rejects.toMatchObject({code:'INVALID_INPUT'});
  const empty=await readPayoutReport(f.scope,{view:'RECEIVED_TODAY',day:'2024-02-29'},db);
  expect(empty.focus).toEqual({view:'RECEIVED_TODAY',day:'2024-02-29',requests:0,vms:0,amounts:[]});
 }finally{await f.cleanup();}
});

it('protected dashboard denies anonymous/nonmembers, returns no-leak unavailable for ordinary members, and preserves scoped finance denial',async()=>{
 dashboardClock();const f=await fixture(),other=await fixture();try{
  await f.request({submittedAt:new Date('2026-10-26T17:00:00Z')});
  await other.request({submittedAt:new Date('2026-10-26T17:00:00Z')});
  const caller=(userId?:string,queryDb=db)=>appRouter.createCaller({prisma:queryDb,session:userId?{user:{id:userId,email:'fixture@invalid'},expires:new Date(Date.now()+60000).toISOString()} as never:null});
  await expect(caller().vmOps.payoutDashboard({projectId:f.scope.projectId})).rejects.toMatchObject({code:'UNAUTHORIZED'});
  await expect(caller(other.scope.userId).vmOps.payoutDashboard({projectId:f.scope.projectId})).rejects.toMatchObject({code:'FORBIDDEN'});
  let payoutReads=0;
  const guarded=new Proxy(db,{get(target,key,receiver){
   if(key==='earnPayoutRequest')return {findMany:()=>{payoutReads++;throw Error('Payout read forbidden for unavailable dashboard');}};
   const value=Reflect.get(target,key,receiver);return typeof value==='function'?value.bind(target):value;
  }}) as typeof db;
  expect(await caller(f.worker.userId,guarded).vmOps.payoutDashboard({projectId:f.scope.projectId})).toEqual({available:false});expect(payoutReads).toBe(0);
  const member={userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}};
  await db.projectMember.update({where:member,data:{capabilities:['EARN_PAYOUT']}});
  const dash=await caller(f.worker.userId).vmOps.payoutDashboard({projectId:f.scope.projectId});if(!dash.available)throw Error('expected available');
  expect(dash.cards.sent.requests).toBe(1);
  const drilldown=await caller(f.worker.userId).vmOps.payoutReport({projectId:f.scope.projectId,view:'SENT_TODAY',day:dash.day});
  expect(drilldown.focus).toEqual({view:'SENT_TODAY',day:dash.day,...dash.cards.sent});
  const foreign=await caller(f.worker.userId).vmOps.payoutDashboard({projectId:f.scope.projectId,serverId:other.server.id});
  if(!foreign.available)throw Error('expected available');expect(foreign.cards.sent.requests).toBe(0);
  await db.projectMember.update({where:member,data:{serverScope:'SELECTED',allowedServerIds:[f.server.id]}});
  expect(await readPayoutDashboard(f.worker,{},db)).toEqual({available:false});
  await expect(caller(f.worker.userId).vmOps.payoutDashboard({projectId:f.scope.projectId})).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();await other.cleanup();}
});

it('reports partial receipts with void/failed/pending precedence and sums only actual confirmed money',async()=>{
 const f=await fixture();try{
  const r=await f.request(),actual=await f.receipt(r.id),voided=await f.receipt(r.id,{amount:'9',voidedAt:new Date(),failed:true,confirmed:false}),
   failed=await f.receipt(r.id,{amount:'8',failed:true,confirmed:false}),pending=await f.receipt(r.id,{amount:'2',confirmed:false});
  const report=await readPayoutReport(f.scope,{},db);
  expect(report.rows).toHaveLength(1);expect(report.rows[0]).toMatchObject({id:r.id,vmId:f.vm.id,serverId:f.server.id,server:f.server.code,vm:f.vm.code,
   cycle:1,paypalId:f.pp.id,paypal:f.pp.code,amount:'10.00',currency:'USD',received:'3.00',remaining:'7.00',shortfall:'0.00',status:'PARTIAL'});
  expect(report.rows[0].receipts).toEqual(expect.arrayContaining([
   expect.objectContaining({id:actual.id,status:'CONFIRMED',transactionId:actual.transactionId}),expect.objectContaining({id:voided.id,status:'VOIDED'}),
   expect.objectContaining({id:failed.id,status:'FAILED'}),expect.objectContaining({id:pending.id,status:'PENDING'}),
  ]));
  expect(report.summary).toEqual([{currency:'USD',prepared:'0.00',sent:'10.00',waiting:'7.00',received:'3.00',unknown:'0.00'}]);
  expect(Number.isFinite(Date.parse(report.updatedAt))).toBe(true);
 }finally{await f.cleanup();}
});

it('keeps closed account, recreated/deleted VM history on request.vmId rather than current account position',async()=>{
 const f=await fixture();try{
  const r=await f.request({cycle:2}),otherServer=await db.server.create({data:{projectId:f.scope.projectId,code:'CURRENT'}});
  const moved=await db.virtualMachine.create({data:{serverId:otherServer.id,code:'CURRENT_VM',managed:true}});
  await db.earnAppAccount.update({where:{id:r.earnAppId},data:{vmId:moved.id,closedAt:new Date()}});
  await db.virtualMachine.update({where:{id:f.vm.id},data:{archivedAt:new Date()}});
  await db.vmOperation.create({data:{projectId:f.scope.projectId,vmId:f.vm.id,cycle:3,status:'DELETED'}});
  const report=await readPayoutReport(f.scope,{serverId:f.server.id},db);
  expect(report.rows).toHaveLength(1);expect(report.rows[0]).toMatchObject({id:r.id,vmId:f.vm.id,serverId:f.server.id,vm:f.vm.code,cycle:2});
  expect((await readPayoutReport(f.scope,{serverId:otherServer.id},db)).total).toBe(0);
 }finally{await f.cleanup();}
});

it('exposes exact request revision/account and active identity without borrowing a replacement account',async()=>{
 const f=await fixture();try{
  const r=await f.request({revision:7});
  await db.earnAppAccount.update({where:{id:r.earnAppId},data:{vmId:f.vm.id}});
  const row=async()=>{const report=await readPayoutReport(f.scope,{},db);return report.rows.find(x=>x.id===r.id);};
  // Like updatePayout, an absent operation row denotes the initial cycle 1.
  expect(await row()).toMatchObject({revision:7,earnAppId:r.earnAppId,consumed:false,current:true});
  await db.earnPayoutRequest.update({where:{id:r.id},data:{revision:8,consumedAt:new Date()}});
  expect(await row()).toMatchObject({revision:8,earnAppId:r.earnAppId,consumed:true,current:true});
  const moved=await db.virtualMachine.create({data:{serverId:f.server.id,code:'MOVED',managed:true}});
  await db.earnAppAccount.update({where:{id:r.earnAppId},data:{vmId:moved.id}});
  expect(await row()).toMatchObject({earnAppId:r.earnAppId,vmId:f.vm.id,current:false});
  await db.earnAppAccount.update({where:{id:r.earnAppId},data:{vmId:f.vm.id}});
  await db.vmOperation.create({data:{projectId:f.scope.projectId,vmId:f.vm.id,cycle:2,status:'NEW_VM'}});
  expect(await row()).toMatchObject({cycle:1,current:false});
  await db.vmOperation.update({where:{vmId:f.vm.id},data:{cycle:1}});
  await db.earnAppAccount.update({where:{id:r.earnAppId},data:{vmId:null,closedAt:new Date()}});
  const login=await db.gmailAccount.create({data:{projectId:f.scope.projectId,email:randomUUID()+'@fixture.invalid'}});
  const replacement=await db.earnAppAccount.create({data:{projectId:f.scope.projectId,loginId:login.id,vmId:f.vm.id}});
  expect(await row()).toMatchObject({earnAppId:r.earnAppId,current:false,consumed:true});
  expect((await row())?.earnAppId).not.toBe(replacement.id);
 }finally{await f.cleanup();}
});

it('current requires managed, nonarchived VM and server plus an open original account',async()=>{
 const f=await fixture();try{
  const r=await f.request();await db.earnAppAccount.update({where:{id:r.earnAppId},data:{vmId:f.vm.id}});
  const row=async()=>(await readPayoutReport(f.scope,{},db)).rows[0];
  for(const data of [{managed:false},{archivedAt:new Date()}]){
   await db.virtualMachine.update({where:{id:f.vm.id},data});expect(await row()).toMatchObject({current:false});
   await db.virtualMachine.update({where:{id:f.vm.id},data:{managed:true,archivedAt:null}});
  }
  for(const data of [{managed:false},{archivedAt:new Date()}]){
   await db.server.update({where:{id:f.server.id},data});expect(await row()).toMatchObject({current:false});
   await db.server.update({where:{id:f.server.id},data:{managed:true,archivedAt:null}});
  }
  await db.earnAppAccount.update({where:{id:r.earnAppId},data:{closedAt:new Date()}});
  expect(await row()).toMatchObject({current:false});
  await db.earnAppAccount.update({where:{id:r.earnAppId},data:{closedAt:null}});
  expect(await row()).toMatchObject({current:true});
 }finally{await f.cleanup();}
});

it('returns freshly loaded management/submission rights without widening narrow receipt-only access',async()=>{
 const f=await fixture();try{
  await f.request();
  expect((await readPayoutReport(f.scope,{},db)).rights).toEqual({manage:true,markSubmission:true,userId:f.scope.userId});
  const where={userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}};
  await db.projectMember.update({where,data:{capabilities:['EARN_PAYOUT']}});
  expect((await readPayoutReport(f.worker,{},db)).rights).toEqual({manage:false,markSubmission:true,userId:f.worker.userId});
  await db.projectMember.update({where,data:{capabilities:['PAYPAL_RECEIPT_RECORD']}});
  const receiptReader=await readPayoutReport({...f.worker,role:'ADMIN',capabilities:['EARN_PAYOUT']},{},db);
  expect(receiptReader.total).toBe(1);expect(receiptReader.rights).toEqual({manage:false,markSubmission:false,userId:f.worker.userId});
  await db.projectMember.update({where,data:{capabilities:[]}});
  await expect(readPayoutReport(f.worker,{},db)).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();}
});

it('derives submission/phase states and keeps each currency separate including shortfall settlement and review',async()=>{
 const f=await fixture();try{
  const preparing=await f.request({submission:'PREPARING',submittedAt:null}),unknown=await f.request({submission:'UNKNOWN',submittedAt:null}),
   waiting=await f.request(),paid=await f.request({settledAt:new Date(),shortfall:'2'}),failed=await f.request({state:'FAILED'}),
   cancelled=await f.request({state:'CANCELLED'}),review=await f.request({consumedAt:new Date()}),vnd=await f.request({currency:'VND',amount:'5'});
  await f.receipt(paid.id,{amount:'8'});await f.receipt(review.id,{amount:'11'});await f.receipt(vnd.id,{currency:'VND',amount:'5'});
  // Money that really arrived remains received even if the request was later marked failed.
  await f.receipt(failed.id,{amount:'1'});
  const report=await readPayoutReport(f.scope,{},db),byId=new Map(report.rows.map(r=>[r.id,r]));
  for(const [r,status] of [[preparing,'PREPARING'],[unknown,'UNKNOWN'],[waiting,'WAITING'],[paid,'RECEIVED'],[failed,'FAILED'],[cancelled,'CANCELLED'],[review,'REVIEW'],[vnd,'RECEIVED']] as const)
   expect(byId.get(r.id)?.status).toBe(status);
  expect(byId.get(paid.id)).toMatchObject({shortfall:'2.00',remaining:'0.00'});
  expect(byId.get(preparing.id)?.remaining).toBe('0.00');
  expect(byId.get(unknown.id)?.remaining).toBe('0.00');
  expect(report.summary).toEqual([
   {currency:'USD',prepared:'10.00',sent:'50.00',waiting:'10.00',received:'20.00',unknown:'10.00'},
   {currency:'VND',prepared:'0.00',sent:'5.00',waiting:'0.00',received:'5.00',unknown:'0.00'},
  ]);
  const partial=await f.request({consumedAt:new Date()});await f.receipt(partial.id,{amount:'1'});
  expect((await readPayoutReport(f.scope,{status:'REVIEW'},db)).rows.map(r=>r.id)).toContain(partial.id);
 }finally{await f.cleanup();}
});

it('filters before 50-row paging and totals; sorts timestamp/create/id stably without truncating history',async()=>{
 const f=await fixture();try{
  const at=new Date('2026-10-26T12:00:00Z'),created=new Date('2026-10-26T12:01:00Z');
  for(let i=0;i<53;i++)await f.request({id:`${f.scope.projectId}-${String(i).padStart(3,'0')}`,requestedAt:at,createdAt:created,reference:'needle'});
  await f.request({requestedAt:new Date('2026-10-25T16:59:59.999Z'),reference:'needle'});
  await f.request({requestedAt:new Date('2026-10-26T17:00:00.000Z'),reference:'needle'});
  const input={from:'2026-10-26',to:'2026-10-26',q:' NeEdLe ',paypalId:f.pp.id,status:'WAITING'};
  const first=await readPayoutReport(f.scope,input,db),second=await readPayoutReport(f.scope,{...input,page:2},db);
  expect(first).toMatchObject({total:53,page:1,pages:2});expect(first.rows).toHaveLength(50);expect(second.rows).toHaveLength(3);
  expect(first.rows[0].id).toBe(`${f.scope.projectId}-052`);expect(second.rows.at(-1)?.id).toBe(`${f.scope.projectId}-000`);
  expect(first.summary).toEqual([{currency:'USD',prepared:'0.00',sent:'530.00',waiting:'530.00',received:'0.00',unknown:'0.00'}]);
  expect(second.summary).toEqual(first.summary);
  const beyond=await readPayoutReport(f.scope,{...input,page:999},db);
  expect(beyond).toMatchObject({page:2,pages:2,total:53});expect(beyond.rows).toEqual(second.rows);
  // Removing the partial last page must return the new last page, not a blank.
  await db.earnPayoutRequest.deleteMany({where:{id:{in:second.rows.map(r=>r.id)},projectId:f.scope.projectId}});
  const shrunk=await readPayoutReport(f.scope,{...input,page:2},db);
  expect(shrunk).toMatchObject({page:1,pages:1,total:50});expect(shrunk.rows).toHaveLength(50);
  const empty=await readPayoutReport(f.scope,{...input,q:'no-matching-request',page:999},db);
  expect(empty).toMatchObject({page:1,pages:1,total:0,rows:[],summary:[]});
 }finally{await f.cleanup();}
});

it('totals confirmed receipts in their own currency even on mismatched, failed or cancelled requests',async()=>{
 const f=await fixture();try{
  // The fixture ledger permits USD/VND: use a real supported mismatch, no constraint bypass.
  const review=await f.request(),failed=await f.request({state:'FAILED'}),cancelled=await f.request({state:'CANCELLED'});
  await f.receipt(review.id,{amount:'4.25',currency:'VND'});
  await f.receipt(failed.id,{amount:'2.10',currency:'VND'});
  await f.receipt(cancelled.id,{amount:'1.05',currency:'VND'});
  await f.receipt(review.id,{amount:'99',currency:'VND',confirmed:false});
  await f.receipt(review.id,{amount:'98',currency:'VND',confirmed:false,failed:true});
  await f.receipt(review.id,{amount:'97',currency:'VND',voidedAt:new Date()});
  const report=await readPayoutReport(f.scope,{},db);
  expect(report.rows.find(r=>r.id===review.id)).toMatchObject({status:'REVIEW',currency:'USD',received:'0.00'});
  expect(report.rows.find(r=>r.id===failed.id)?.status).toBe('FAILED');
  expect(report.rows.find(r=>r.id===cancelled.id)?.status).toBe('CANCELLED');
  expect(report.summary).toEqual([
   {currency:'USD',prepared:'0.00',sent:'30.00',waiting:'0.00',received:'0.00',unknown:'0.00'},
   {currency:'VND',prepared:'0.00',sent:'0.00',waiting:'0.00',received:'7.40',unknown:'0.00'},
  ]);
  expect((await readPayoutReport(f.scope,{status:'REVIEW'},db)).summary.find(r=>r.currency==='VND')?.received).toBe('4.25');
 }finally{await f.cleanup();}
});

it('searches server, VM, login, PayPal, receiving email and reference; validates filters and calendar days',async()=>{
 const f=await fixture();try{
  const r=await f.request({reference:'search-reference'}),ea=await db.earnAppAccount.findUniqueOrThrow({where:{id:r.earnAppId},include:{login:true}}),email=await db.payPalEmail.findUniqueOrThrow({where:{id:r.paypalEmailId}});
  for(const q of [f.server.code,f.vm.code,ea.login.email,f.pp.code,email.email,'search-reference'])expect((await readPayoutReport(f.scope,{q},db)).total).toBe(1);
  expect((await readPayoutReport(f.scope,{q:'not-present'},db)).total).toBe(0);
  for(const input of [{from:'2026-02-30'},{to:'not-a-date'},{from:'2026-10-27',to:'2026-10-26'},{status:'SENT'},{page:0},{page:1.5}])
   await expect(readPayoutReport(f.scope,input,db)).rejects.toMatchObject({code:'INVALID_INPUT'});
 }finally{await f.cleanup();}
});

it('reloads rights, denies server-scoped money, and isolates rows, totals and options by project',async()=>{
 const f=await fixture(),other=await fixture();try{
  await f.request();await other.request();
  await expect(readPayoutReport({...f.worker,role:'ADMIN',capabilities:['EARN_PAYOUT']},{},db)).rejects.toMatchObject({code:'FORBIDDEN'});
  const member={userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}};
  await db.projectMember.update({where:member,data:{capabilities:['EARN_PAYOUT']}});
  expect((await readPayoutReport(f.worker,{},db)).total).toBe(1);
  await db.projectMember.update({where:member,data:{serverScope:'SELECTED',allowedServerIds:[f.server.id]}});
  await expect(readPayoutReport(f.worker,{},db)).rejects.toMatchObject({code:'FORBIDDEN'});
  const report=await readPayoutReport(f.scope,{},db);
  expect(report.servers).toEqual([{id:f.server.id,code:f.server.code}]);expect(report.paypals).toEqual([{id:f.pp.id,code:f.pp.code}]);
  expect((await readPayoutReport(f.scope,{paypalId:other.pp.id},db)).total).toBe(0);
  expect((await readPayoutReport(f.scope,{serverId:other.server.id},db)).total).toBe(0);
  expect(report.total).toBe(1);expect(report.summary[0].sent).toBe('10.00');
  await db.projectMember.update({where:member,data:{serverScope:'ALL',capabilities:['PAYPAL_RECEIPT_RECORD'],allowedModules:[]}});
  await expect(readPayoutReport(f.worker,{},db)).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();await other.cleanup();}
});

// Task 11 (28/10/2026): "Đã xoá do ghi nhầm" on the report reads EarnPayoutRequestVoid; reason / amount only with request money rights,
// selected-server members only their servers.
it('lists voided requests per project and server scope, money only with request money rights',async()=>{
 const f=await fixture(),projectId=f.scope.projectId;
 try{
  const server2=await db.server.create({data:{projectId,code:'business-fixture-2',managed:true}});
  const vm2=await db.virtualMachine.create({data:{serverId:server2.id,code:'VM_009',managed:true,proxySlotState:'BLANK'}});
  const mk=(vmId:string,amount:string,reason:string,at:string)=>db.earnPayoutRequestVoid.create({data:{projectId,requestId:randomUUID(),vmId,cycle:1,earnAppId:randomUUID(),paypalEmailId:randomUUID(),
   snapshot:{amount,currency:'USD',paypalCode:'PP-report',email:'mail-'+amount+'@fixture.invalid'},reason,voidedById:f.scope.userId,voidedAt:new Date(at)}});
  await mk(f.vm.id,'10.00','Ghi nhầm VM','2026-10-27T01:00:00Z');await mk(vm2.id,'7.50','Sai email','2026-10-28T01:00:00Z');
  const foreign=await businessFixture();
  await db.earnPayoutRequestVoid.create({data:{projectId:foreign.scope.projectId,requestId:randomUUID(),vmId:foreign.vm.id,cycle:1,earnAppId:randomUUID(),paypalEmailId:randomUUID(),snapshot:{amount:'1.00',currency:'USD'},reason:'x',voidedById:foreign.scope.userId}});
  try{
   const all=await readPayoutVoided(f.scope,{},db);
   expect(all.total).toBe(2);
   expect(all.rows.map(r=>[r.server,r.vm,r.amount,r.reason,r.paypal])).toEqual([['business-fixture-2','VM_009','7.50','Sai email','PP-report'],['business-fixture','VM_001','10.00','Ghi nhầm VM','PP-report']]);
   expect(all.rows[0]).toMatchObject({currency:'USD',email:'mail-7.50@fixture.invalid',voidedAt:'2026-10-28T01:00:00.000Z',cycle:1});
   expect(all.rows[0].voidedBy).toBeTruthy();expect(all.money).toBe(true);
   expect((await readPayoutVoided(f.scope,{serverId:f.server.id},db)).rows.map(r=>r.vm)).toEqual(['VM_001']);
   // Infrastructure reader without money rights: rows yes, reason / amount never.
   const plain=await readPayoutVoided(f.worker,{},db);
   expect(plain.money).toBe(false);expect(plain.total).toBe(2);
   for(const r of plain.rows){expect(r.amount).toBeNull();expect(r.currency).toBeNull();expect(r.reason).toBeNull();}
   // Selected-server member: only their server; asking for another server is refused.
   const member={userId_projectId:{userId:f.worker.userId,projectId}};
   await db.projectMember.update({where:member,data:{serverScope:'SELECTED',allowedServerIds:[f.server.id]}});
   const scoped=await readPayoutVoided(f.worker,{},db);
   expect(scoped.rows.map(r=>r.vm)).toEqual(['VM_001']);expect(scoped.rows[0].amount).toBeNull();
   await expect(readPayoutVoided(f.worker,{serverId:server2.id},db)).rejects.toMatchObject({code:'NOT_FOUND'});
   // Through the router.
   const caller=appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId,email:'fixture@invalid'},expires:new Date(Date.now()+60000).toISOString()} as never});
   expect((await caller.vmOps.payoutVoided({projectId})).total).toBe(2);
   // Tổng quan carries the money lost to SUS of the same rows as the report (server filter too).
   await f.request({state:'LOST_SUS',lostAmount:'4.25',lostAt:new Date()});
   const dash=await readPayoutDashboard(f.scope,{},db);if(!dash.available)throw Error('expected available');expect(dash.lost).toEqual({USD:'4.25'});
   const dash2=await readPayoutDashboard(f.scope,{serverId:server2.id},db);if(!dash2.available)throw Error('expected available');expect(dash2.lost).toEqual({});
   await expect(caller.vmOps.payoutVoided({projectId:foreign.scope.projectId})).rejects.toBeTruthy();
  }finally{await db.earnPayoutRequestVoid.deleteMany({where:{projectId:foreign.scope.projectId}});await foreign.cleanup();}
 }finally{await db.earnPayoutRequestVoid.deleteMany({where:{projectId}});await f.cleanup();}
});

// Search by PayPal transaction id (29/10/2026): the report q matches a request whose receipt has exactly that id (case-insensitive,
// the "Mã giao dịch:" label dropped), never another request; findPayoutByTransaction finds the VM for the Server / VM search.
it('report q matches a PayPal transaction id exactly, case-insensitively and with a pasted label',async()=>{
 const f=await fixture();try{
  const hit=await f.request(),miss=await f.request();
  await f.receipt(hit.id,{transactionId:'8JR02442V10816200'});
  await f.receipt(miss.id,{transactionId:'8JR02442V10816201'});
  for(const q of ['8JR02442V10816200','8jr02442v10816200','  Mã giao dịch: 8JR02442V10816200 ','Transaction ID:8JR02442V10816200']){
   const report=await readPayoutReport(f.scope,{q},db);
   expect(report.rows.map(r=>r.id)).toEqual([hit.id]);
   expect(report.rows[0].matchedTransactionId).toBe('8JR02442V10816200');
  }
  expect((await readPayoutReport(f.scope,{q:'8JR02442V1081620'},db)).rows.map(r=>r.id)).toEqual([]);
  for(const q of ['%','8JR_2442V10816200','8JR02442V1081620%'])expect((await readPayoutReport(f.scope,{q},db)).rows.map(r=>r.id)).toEqual([]);
  expect((await readPayoutReport(f.scope,{},db)).rows.every(r=>r.matchedTransactionId===null)).toBe(true);
 }finally{await f.cleanup();}
});

it('findPayoutByTransaction returns the request VM, null when unknown, and refuses scoped / no-money members',async()=>{
 const f=await fixture(),other=await fixture();try{
  const r=await f.request();await f.receipt(r.id,{transactionId:'9AB12345CD6789012'});
  const o=await other.request();await other.receipt(o.id,{transactionId:'7ZZ12345CD6789012'});
  expect(await findPayoutByTransaction(f.scope,{transactionId:'Mã giao dịch: 9ab12345cd6789012'},db)).toEqual({vmId:f.vm.id,serverId:f.server.id,serverCode:f.server.code,requestId:r.id,
   receipt:{transactionId:'9AB12345CD6789012',amount:'3.00',currency:'USD',status:'CONFIRMED'}});
  // ILIKE wildcards never reach the database: "%" / "_" are refused, not matched.
  for(const transactionId of ['%','9AB_2345CD6789012','9AB12345CD678901%'])await expect(findPayoutByTransaction(f.scope,{transactionId},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
  expect(await findPayoutByTransaction(f.scope,{transactionId:'7ZZ12345CD6789012'},db)).toBeNull();
  expect(await findPayoutByTransaction(f.scope,{transactionId:'0000000000000000'},db)).toBeNull();
  await expect(findPayoutByTransaction(f.worker,{transactionId:'9AB12345CD6789012'},db)).rejects.toMatchObject({code:'FORBIDDEN'});
  const member={userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}};
  await db.projectMember.update({where:member,data:{capabilities:['EARN_PAYOUT']}});
  expect((await findPayoutByTransaction(f.worker,{transactionId:'9AB12345CD6789012'},db))?.vmId).toBe(f.vm.id);
  await db.projectMember.update({where:member,data:{serverScope:'SELECTED',allowedServerIds:[f.server.id]}});
  await expect(findPayoutByTransaction(f.worker,{transactionId:'9AB12345CD6789012'},db)).rejects.toMatchObject({code:'FORBIDDEN'});
  const caller=appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId,email:'fixture@invalid'},expires:new Date(Date.now()+60000).toISOString()} as never});
  expect(await caller.vmOps.findByTransaction({projectId:f.scope.projectId,transactionId:'9AB12345CD6789012'})).toMatchObject({vmId:f.vm.id,requestId:r.id});
  await expect(caller.vmOps.findByTransaction({projectId:f.scope.projectId,transactionId:'%'})).rejects.toMatchObject({code:'BAD_REQUEST'});
  // A voided receipt is reported as such; an archived VM is not offered.
  const v=await f.request();await f.receipt(v.id,{transactionId:'VOID12345CD678901',voidedAt:new Date()});
  expect((await findPayoutByTransaction(f.scope,{transactionId:'VOID12345CD678901'},db))?.receipt.status).toBe('VOIDED');
  await db.virtualMachine.update({where:{id:f.vm.id},data:{archivedAt:new Date()}});
  expect(await findPayoutByTransaction(f.scope,{transactionId:'9AB12345CD6789012'},db)).toBeNull();
 }finally{await f.cleanup();await other.cleanup();}
});
