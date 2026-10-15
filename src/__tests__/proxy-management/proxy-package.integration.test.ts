import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db} from './business-fixture';
import {teamCashFixture} from './team-cash-fixture';
import {createProxyBatchService} from '@/server/proxy-management/batches';
import {persistSourceSnapshot} from '@/server/proxy-management/sources';
import {saveProviderAccount,listPackages} from '@/server/proxy-management/catalog-management';
import {queryRegistry} from '@/server/proxy-management/history';
import {destroyProject} from '@/server/project-lifecycle/destroy';
import {listOperations} from '@/server/operation-history/journal';
import {undoOperation} from '@/server/operation-history/undo';
import {saveUsdtCost} from '@/server/business-management/usdt-costs';
import type {BatchInput} from '@/server/proxy-management/types';
import {businessDay} from '@/server/proxy-management/package-terms';
afterAll(()=>db.$disconnect());
const day=(offset:number)=>new Date(businessDay()+offset*86400000);
const ymd=(d:Date)=>d.toISOString().slice(0,10);
function randomIp(){return '10.'+[0,0,0].map(()=>Math.floor(Math.random()*254)+1).join('.');}
async function fixture(){
  const f=await teamCashFixture(),projectId=f.scope.projectId;
  const service=createProxyBatchService(db,{refreshSource:async()=>persistSourceSnapshot(projectId,{id:randomUUID(),sourceKey:'GENJY',hash:'empty-'+projectId,fetchedAt:new Date().toISOString(),scanSucceeded:true,evidence:[]},db)});
  const run=async(input:Omit<BatchInput,'idempotencyKey'>)=>{const key=randomUUID();const preview=await service.preview(f.scope,{...input,idempotencyKey:key});return {preview,commit:()=>service.commit(f.scope,preview.token,key)};};
  const cleanup=async()=>{await destroyProject(db,projectId);await db.user.deleteMany({where:{id:{in:[f.scope.userId,f.worker.userId]}}});};
  return {...f,projectId,service,run,cleanup};
}
it('saves package terms, lists packages with proxy count and due state, keeps credentials when omitted and undoes to previous terms',async()=>{
  const f=await fixture();try{
    await saveProviderAccount(f.scope,{code:'240292',label:'240292',username:'u1',password:'p1',site:'proxiware.com',price:'120',priceCurrency:'USD',cycleMonths:1,nextDueDate:ymd(day(3)),note:'gói chính'},db);
    const ip=randomIp();const {commit}=await f.run({kind:'NEW',text:ip+':80:u1:p1',owner:'SELF'});await commit();
    let [pkg]=await listPackages(f.scope,db);
    expect(pkg).toMatchObject({code:'240292',site:'proxiware.com',price:'120',priceCurrency:'USD',cycleMonths:1,nextDueDate:ymd(day(3)),note:'gói chính',proxyCount:1,due:{state:'DUE_SOON',daysLeft:3},disabled:false});
    await saveProviderAccount(f.scope,{code:'240292',label:'240292',site:'proxiware.com',price:'130',priceCurrency:'USD',cycleMonths:2,nextDueDate:ymd(day(40)),note:'tăng giá'},db);
    [pkg]=await listPackages(f.scope,db);expect(pkg).toMatchObject({price:'130',cycleMonths:2,due:{state:'OK',daysLeft:40},proxyCount:1});
    const again=await f.run({kind:'NEW',text:randomIp()+':80:u1:p1',owner:'SELF'});expect(again.preview.rows[0]).toMatchObject({outcome:'READY',packageCode:'240292'});
    const ops=await listOperations(f.scope,db);const edit=ops.find(o=>o.kind==='CATALOG')!;
    await undoOperation(f.scope,edit.id,'nhầm giá',db);
    [pkg]=await listPackages(f.scope,db);expect(pkg).toMatchObject({price:'120',cycleMonths:1,nextDueDate:ymd(day(3)),note:'gói chính'});
  }finally{await f.cleanup();}
});
it('import with a chosen or new package: matches credentials, rejects mismatches, creates the package on commit and undo disables it',async()=>{
  const f=await fixture();try{
    await saveProviderAccount(f.scope,{code:'231243',label:'231243',username:'ua',password:'pa'},db);
    const a=randomIp(),b=randomIp(),c=randomIp();
    const chosen=await f.run({kind:'NEW',text:[a+':80:ua:pa',b+':80:ux:px'].join('\n'),owner:'SELF',packageCode:'231243'});
    expect(chosen.preview.rows.map(r=>[r.outcome,r.code||null,r.packageCode||null])).toEqual([['READY',null,'231243'],['ERROR','PACKAGE_MISMATCH',null]]);
    await expect(f.run({kind:'NEW',text:a+':80:ua:pa',owner:'SELF',newPackage:{code:'231243',site:'x'}})).rejects.toMatchObject({code:'DUPLICATE_INPUT'});
    const fresh=await f.run({kind:'NEW',text:[a+':80:ub:pb',b+':80:ub:pb',c+':80:ua:pa'].join('\n'),owner:'SELF',newPackage:{code:'Account VietPhe',site:'vietphe.net'}});
    expect(fresh.preview.rows.map(r=>[r.outcome,r.code||null,r.packageCode||null])).toEqual([['READY',null,'Account VietPhe'],['READY',null,'Account VietPhe'],['ERROR','PACKAGE_MISMATCH',null]]);
    const result=await fresh.commit();expect(result.applied).toBe(2);
    const packages=await listPackages(f.scope,db);expect(packages.map(p=>[p.code,p.site,p.proxyCount])).toEqual([['231243',null,0],['Account VietPhe','vietphe.net',2]]);
    expect(await db.proxyIP.count({where:{projectId:f.projectId,packageCode:'Account VietPhe',inventoryState:'NEW'}})).toBe(2);
    const op=(await listOperations(f.scope,db)).find(o=>o.kind==='NEW')!;await undoOperation(f.scope,op.id,'nhập nhầm',db);
    expect((await listPackages(f.scope,db)).find(p=>p.code==='Account VietPhe')).toMatchObject({disabled:true,proxyCount:0});
    expect(await db.proxyIP.count({where:{projectId:f.projectId,inventoryState:'VOID'}})).toBe(2);
  }finally{await f.cleanup();}
});
it('registry sorts by package, server, status or IP, filters one package and packages due soon',async()=>{
  const f=await fixture();try{
    await saveProviderAccount(f.scope,{code:'240292',label:'240292',username:'u1',password:'p1',nextDueDate:ymd(day(2))},db);
    await saveProviderAccount(f.scope,{code:'231243',label:'231243',username:'u2',password:'p2',nextDueDate:ymd(day(30))},db);
    const ips=[randomIp(),randomIp(),randomIp()];
    await (await f.run({kind:'NEW',text:ips[0]+':80:u1:p1',owner:'SELF'})).commit();
    await (await f.run({kind:'NEW',text:ips[1]+':80:u2:p2\n'+ips[2]+':80:u2:p2',owner:'SELF'})).commit();
    const codes=async(extra:Partial<Parameters<typeof queryRegistry>[1]>)=>(await queryRegistry(f.scope,{view:'CURRENT',limit:50,...extra},db)).rows.map(r=>r.packageCode);
    expect(await codes({sort:'PACKAGE'})).toEqual(['231243','231243','240292']);
    expect(await codes({sort:'STATUS'})).toHaveLength(3);
    expect(await codes({packageCode:'240292'})).toEqual(['240292']);
    expect(await codes({due:true})).toEqual(['240292']);
    const numeric=(ip:string)=>ip.split('.').reduce((n,x)=>n*256+Number(x),0);
    const byIp=(await queryRegistry(f.scope,{view:'CURRENT',limit:50,sort:'IP'},db)).rows.map(r=>r.ip);expect([...byIp].sort((a,b)=>numeric(a)-numeric(b))).toEqual(byIp);
  }finally{await f.cleanup();}
});
it('paying a package records a USDT cost and advances the due date in one command; undo restores the date and voids the cost',async()=>{
  const f=await fixture();try{
    await saveProviderAccount(f.scope,{code:'240292',label:'240292',username:'u1',password:'p1',price:'120',priceCurrency:'USDT',cycleMonths:1,nextDueDate:ymd(day(2))},db);
    const [pkg]=await listPackages(f.scope,db);
    const base={date:ymd(day(0)),amount:'120',currency:'USDT',treatment:'CASH_COST' as const,proxyAccountId:pkg.id};
    await expect(saveUsdtCost(f.scope,{...base,key:randomUUID(),category:'OTHER',packageDue:{proxyAccountId:pkg.id,expectedRevision:pkg.revision}},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    await expect(saveUsdtCost(f.scope,{...base,key:randomUUID(),category:'IP_PROXY',packageDue:{proxyAccountId:pkg.id,expectedRevision:pkg.revision+5}},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    const saved=await saveUsdtCost(f.scope,{...base,key:randomUUID(),category:'IP_PROXY',packageDue:{proxyAccountId:pkg.id,expectedRevision:pkg.revision}},db);
    const expected=day(2);expected.setUTCMonth(expected.getUTCMonth()+1);
    let [after]=await listPackages(f.scope,db);expect(after).toMatchObject({nextDueDate:ymd(expected),lastPaidAt:expect.any(String),revision:pkg.revision+1,due:{state:'OK'}});
    const cost=await db.costRecord.findUniqueOrThrow({where:{id:saved.id}});expect(cost).toMatchObject({proxyAccountId:pkg.id,category:'IP_PROXY'});
    const explicit=await saveUsdtCost(f.scope,{...base,key:randomUUID(),category:'IP_PROXY',packageDue:{proxyAccountId:pkg.id,expectedRevision:after.revision,nextDueDate:ymd(day(90))}},db);
    [after]=await listPackages(f.scope,db);expect(after.nextDueDate).toBe(ymd(day(90)));
    const op=(await listOperations(f.scope,db)).find(o=>o.kind==='TEAM_CASH_COST')!;await undoOperation(f.scope,op.id,'ghi nhầm',db);
    [after]=await listPackages(f.scope,db);expect(after.nextDueDate).toBe(ymd(expected));
    expect((await db.costRecord.findUniqueOrThrow({where:{id:explicit.id}})).voidedAt).not.toBeNull();
  }finally{await f.cleanup();}
});
