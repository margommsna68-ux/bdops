import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db} from './business-fixture';
import {teamCashFixture} from './team-cash-fixture';
import {createProxyBatchService} from '@/server/proxy-management/batches';
import {persistSourceSnapshot} from '@/server/proxy-management/sources';
import {saveProviderAccount,listPackages,setPackageRenewal} from '@/server/proxy-management/catalog-management';
import {packageReminders} from '@/server/proxy-management/reminders';
import {dueState,addMonthsClamped,nextDueAfterPayment} from '@/server/proxy-management/package-terms';
import {destroyProject} from '@/server/project-lifecycle/destroy';
import {undoOperation} from '@/server/operation-history/undo';
import {saveUsdtCost} from '@/server/business-management/usdt-costs';
import {businessDay} from '@/server/proxy-management/package-terms';
import type {BatchInput} from '@/server/proxy-management/types';
afterAll(()=>db.$disconnect());
const day=(offset:number)=>new Date(businessDay()+offset*86400000);
const ymd=(d:Date)=>d.toISOString().slice(0,10);
const randomIp=()=>'10.'+[0,0,0].map(()=>Math.floor(Math.random()*254)+1).join('.');
async function fixture(){
  const f=await teamCashFixture(),projectId=f.scope.projectId;
  const service=createProxyBatchService(db,{refreshSource:async()=>persistSourceSnapshot(projectId,{id:randomUUID(),sourceKey:'GENJY',hash:'empty-'+projectId,fetchedAt:new Date().toISOString(),scanSucceeded:true,evidence:[]},db)});
  const run=async(input:Omit<BatchInput,'idempotencyKey'>)=>{const key=randomUUID();const preview=await service.preview(f.scope,{...input,idempotencyKey:key});return {preview,commit:()=>service.commit(f.scope,preview.token,key)};};
  const cleanup=async()=>{await destroyProject(db,projectId);await db.user.deleteMany({where:{id:{in:[f.scope.userId,f.worker.userId]}}});};
  return {...f,projectId,run,cleanup};
}
describe('due state and reminders (pure)',()=>{
  const today=new Date('2026-10-16T05:00:00.000Z');
  const pkg=(o:Partial<Parameters<typeof packageReminders>[0][number]>)=>({id:'p1',code:'240292',nextDueDate:new Date('2026-10-20T00:00:00.000Z'),reminderDays:7,renewalStoppedAt:null,price:'120',priceCurrency:'USD',disabled:false,...o});
  it('honours the configured reminder window and steps up at 3 days, 1 day, due day and overdue',()=>{
    expect(dueState(new Date('2026-10-26T00:00:00.000Z'),today,10)).toEqual({state:'DUE_SOON',daysLeft:10});
    expect(dueState(new Date('2026-10-26T00:00:00.000Z'),today,7)).toEqual({state:'OK',daysLeft:10});
    const at=(due:string)=>packageReminders([pkg({nextDueDate:new Date(due+'T00:00:00.000Z')})],today,true)[0];
    expect(at('2026-10-24')).toBeUndefined();
    expect(at('2026-10-23')).toMatchObject({id:'pkg-due-p1',level:'SOON',severity:'info',title:'Gói 240292 còn 7 ngày'});
    expect(at('2026-10-19')).toMatchObject({level:'THREE_DAYS',severity:'warning',title:'Gói 240292 còn 3 ngày'});
    expect(at('2026-10-17')).toMatchObject({level:'ONE_DAY',severity:'error',title:'Gói 240292 còn 1 ngày'});
    expect(at('2026-10-16')).toMatchObject({level:'TODAY',severity:'error',title:'Gói 240292 đến hạn hôm nay'});
    expect(at('2026-10-14')).toMatchObject({level:'OVERDUE',severity:'error',title:'Gói 240292 quá hạn 2 ngày'});
    expect(at('2026-10-14').link).toBe('/infrastructure/proxies?package=240292&pay=240292');
    expect(at('2026-10-14').message).toContain('120 USD');expect(packageReminders([pkg({})],today,false)[0].message).not.toContain('120');
  });
  it('gives one alert per package, none without a due date or after renewal was stopped, and keeps alerting disabled packages',()=>{
    const list=packageReminders([pkg({}),pkg({id:'p2',code:'A',nextDueDate:null}),pkg({id:'p3',code:'B',renewalStoppedAt:new Date()}),pkg({id:'p4',code:'C',disabled:true,nextDueDate:new Date('2026-10-10T00:00:00.000Z')})],today,true);
    expect(list.map(a=>a.id)).toEqual(['pkg-due-p4','pkg-due-p1']); // overdue first
  });
  it('rolls over month ends without inventing days',()=>{
    expect(ymd(addMonthsClamped(new Date('2026-01-31T00:00:00.000Z'),1))).toBe('2026-02-28');
    expect(ymd(nextDueAfterPayment(new Date('2026-10-31T00:00:00.000Z'),new Date('2026-10-16T00:00:00.000Z'),1))).toBe('2026-11-30');
    expect(ymd(nextDueAfterPayment(new Date('2026-12-15T00:00:00.000Z'),new Date('2026-12-20T00:00:00.000Z'),1))).toBe('2027-01-20');
  });
});
it('package reminder terms: reminder days, stop/resume renewal, disable keeps proxies and reminders, hides price without cost access',async()=>{
  const f=await fixture();try{
    await saveProviderAccount(f.scope,{code:'240292',label:'240292',username:'u1',password:'p1',price:'120',priceCurrency:'USD',cycleMonths:1,nextDueDate:ymd(day(9)),reminderDays:10},db);
    const ip=randomIp();await (await f.run({kind:'NEW',text:ip+':80:u1:p1',owner:'SELF'})).commit();
    let [pkg]=await listPackages(f.scope,db);expect(pkg).toMatchObject({reminderDays:10,due:{state:'DUE_SOON',daysLeft:9},reminder:true,renewalStoppedAt:null,priceHidden:false,price:'120'});
    await expect(saveProviderAccount(f.scope,{code:'240292',label:'240292',reminderDays:0},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    await setPackageRenewal(f.scope,{code:'240292',stopped:true,note:'Không thuê tiếp'},db);
    [pkg]=await listPackages(f.scope,db);expect(pkg.reminder).toBe(false);expect(pkg.renewalStoppedAt).toBeTruthy();expect(pkg.nextDueDate).toBe(ymd(day(9)));
    expect(packageReminders([{...pkg,nextDueDate:new Date(pkg.nextDueDate!+'T00:00:00.000Z'),renewalStoppedAt:new Date(pkg.renewalStoppedAt!)}],new Date(),true)).toEqual([]);
    await setPackageRenewal(f.scope,{code:'240292',stopped:false},db);[pkg]=await listPackages(f.scope,db);expect(pkg.reminder).toBe(true);
    await saveProviderAccount(f.scope,{code:'240292',label:'240292',disabled:true},db);
    [pkg]=await listPackages(f.scope,db);expect(pkg).toMatchObject({disabled:true,proxyCount:1,reminder:true,nextDueDate:ymd(day(9))});
    const blocked=await f.run({kind:'NEW',text:randomIp()+':80:u1:p1',owner:'SELF',packageCode:'240292'}).catch(e=>e);expect(blocked).toMatchObject({code:'NOT_FOUND'}); // disabled package takes no new proxies
    const auto=await f.run({kind:'NEW',text:randomIp()+':80:u1:p1',owner:'SELF'});expect(auto.preview.rows[0]).toMatchObject({code:'UNKNOWN_PACKAGE'});
    await saveProviderAccount(f.scope,{code:'240292',label:'240292',disabled:false},db);[pkg]=await listPackages(f.scope,db);expect(pkg.disabled).toBe(false);
    const ops=await db.operationJournal.findMany({where:{projectId:f.projectId,kind:'CATALOG'},orderBy:{createdAt:'desc'}});await undoOperation(f.scope,ops[0].id,'nhầm',db);[pkg]=await listPackages(f.scope,db);expect(pkg.disabled).toBe(true);
    const worker=await listPackages(f.worker,db);expect(worker[0]).toMatchObject({priceHidden:true,price:null});
  }finally{await f.cleanup();}
});
it('replace, block and VM/group edits never move the due date; recording a payment twice with one key writes one cost and advances once',async()=>{
  const f=await fixture();try{
    await saveProviderAccount(f.scope,{code:'240292',label:'240292',username:'u1',password:'p1',price:'120',priceCurrency:'USDT',cycleMonths:1,nextDueDate:ymd(day(20))},db);
    const ip=randomIp(),next=randomIp();await (await f.run({kind:'NEW',text:ip+':80:u1:p1',owner:'SELF'})).commit();
    await (await f.run({kind:'BLOCKED',text:ip})).commit();await (await f.run({kind:'REPLACE',removedText:ip,addedText:next,owner:'SELF'})).commit();
    let [pkg]=await listPackages(f.scope,db);expect(pkg.nextDueDate).toBe(ymd(day(20)));expect(pkg.lastPaidAt).toBeNull();
    const key=randomUUID(),base={date:ymd(day(0)),amount:'120',currency:'USDT',category:'IP_PROXY' as const,treatment:'CASH_COST' as const,proxyAccountId:pkg.id,packageDue:{proxyAccountId:pkg.id,expectedRevision:pkg.revision}};
    const first=await saveUsdtCost(f.scope,{...base,key},db),second=await saveUsdtCost(f.scope,{...base,key},db);expect(second.id).toBe(first.id);
    expect(await db.costRecord.count({where:{projectId:f.projectId,category:'IP_PROXY',voidedAt:null}})).toBe(1);
    [pkg]=await listPackages(f.scope,db);expect(pkg.nextDueDate).toBe(ymd(addMonthsClamped(day(20),1)));expect(pkg.lastPaidAt).toBeTruthy();
    await expect(saveUsdtCost(f.scope,{...base,key:randomUUID(),packageDue:{proxyAccountId:pkg.id,expectedRevision:pkg.revision-1}},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  }finally{await f.cleanup();}
});
