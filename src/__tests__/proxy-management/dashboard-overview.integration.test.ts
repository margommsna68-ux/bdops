import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {createVMService} from '@/server/vm-management/allocation';
import {readVMWorkspace} from '@/server/vm-management/repository';
import {summarizeVMs} from '@/server/vm-management/state';
import {readOrphanTasks,closeOrphanTask} from '@/server/vm-management/orphan-tasks';
import {queryRegistry} from '@/server/proxy-management/history';
import {readOverview} from '@/server/dashboard/overview';
import {saveTeamReceipt} from '@/server/business-management/team-receipts';
import {saveUsdtCost} from '@/server/business-management/usdt-costs';
import {teamCashSources} from '@/server/business-management/team-cash-report';
import {listOperations} from '@/server/operation-history/journal';
import {undoOperation} from '@/server/operation-history/undo';
import type {ActorScope} from '@/server/proxy-management/types';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
// Servers moon10 and moon2 (natural order puts moon2 first) plus a deleted moonX; proxies TUT NEW ×3 / BLOCKED ×1 / REPLACED ×1,
// Chung mooon–Genjy NEW ×1, Genjy riêng NEW ×1. Members: admin, an operator with INFRASTRUCTURE only, an accountant with COSTS+PROFIT.
async function fixture(){
  const projectId=randomUUID(),admin=randomUUID(),operator=randomUUID(),accountant=randomUUID(),identities:string[]=[];
  await db.project.create({data:{id:projectId,code:projectId,name:'Dashboard fixture',settings:{businessMode:'PROXY_VM'}}});
  await db.user.createMany({data:[admin,operator,accountant].map(id=>({id,email:id+'@fixture.invalid'}))});
  await db.projectMember.createMany({data:[{projectId,userId:admin,role:'ADMIN',capabilities:['PROXY_IMPORT','COPY_CREDENTIALS']},{projectId,userId:operator,role:'USER',allowedModules:['INFRASTRUCTURE']},{projectId,userId:accountant,role:'MODERATOR',allowedModules:['COSTS','PROFIT']}]});
  const s10=await db.server.create({data:{projectId,code:'moon10',managed:true}}),s2=await db.server.create({data:{projectId,code:'moon2',managed:true}}),gone=await db.server.create({data:{projectId,code:'moonX',managed:true,archivedAt:new Date()}});
  const vm=(serverId:string,code:string,extra:Record<string,unknown>={})=>db.virtualMachine.create({data:{serverId,code,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL',...extra}});
  const a1=await vm(s2.id,'VM_001'),a2=await vm(s2.id,'VM_002',{sdkId:'sdk-'+projectId.slice(0,8)}),a3=await vm(s2.id,'VM_003',{archivedAt:new Date()}),b1=await vm(s10.id,'VM_001');await vm(gone.id,'VM_001');
  const r=()=>1+Math.floor(Math.random()*250),net='10.'+r()+'.'+r()+'.';
  const proxy=async(n:number,owner:'SELF'|'GENJY',subgroup:'PC_CHUNG'|null,state:'NEW'|'BLOCKED'|'REPLACED'='NEW')=>{const ip=net+n,identity=await db.proxyIdentity.create({data:{ip,owner,subgroup,ownerDecidedAt:owner==='GENJY'?new Date():null}});identities.push(identity.id);return db.proxyIP.create({data:{projectId,identityId:identity.id,address:ip+':8080',host:ip,port:8080,credentialCipher:encrypt(JSON.stringify({username:'u'+n,password:'p'+n})),packageCode:'pkg',inventoryState:state,inventoryKey:identity.id}});};
  const tut=await proxy(1,'SELF',null);await proxy(2,'SELF',null);await proxy(3,'SELF',null);await proxy(4,'SELF',null,'BLOCKED');await proxy(5,'SELF',null,'REPLACED');await proxy(6,'GENJY','PC_CHUNG');await proxy(7,'GENJY',null);
  const snapshot=await db.proxySourceSnapshot.create({data:{projectId,sourceKey:'GENJY',hash:'dash',scanSucceeded:true}});
  const scope=(userId:string,role:'ADMIN'|'USER'|'MODERATOR'):ActorScope=>({projectId,userId,role,capabilities:role==='ADMIN'?['PROXY_IMPORT','COPY_CREDENTIALS']:[]});
  const service=createVMService(db,{refreshSource:async()=>({id:snapshot.id,sourceKey:'GENJY',hash:'dash',fetchedAt:new Date().toISOString(),scanSucceeded:true})});
  const cleanup=async()=>{await db.operationJournal.deleteMany({where:{projectId}});await db.businessWorkItem.deleteMany({where:{projectId}});await db.costRecord.deleteMany({where:{projectId}});await db.teamReceipt.deleteMany({where:{projectId}});await db.vMTask.deleteMany({where:{vm:{server:{projectId}}}});await db.vMProxyAllocation.deleteMany({where:{projectId}});await db.virtualMachine.updateMany({where:{server:{projectId}},data:{proxyId:null,desiredConfigurationId:null,installedConfigurationId:null}});await db.vMConfiguration.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});await db.virtualMachine.deleteMany({where:{server:{projectId}}});await db.server.deleteMany({where:{projectId}});await db.proxyIP.deleteMany({where:{projectId}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});await db.proxyIdentity.deleteMany({where:{id:{in:identities}}});await db.auditLog.deleteMany({where:{projectId}});await db.projectMember.deleteMany({where:{projectId}});await db.project.delete({where:{id:projectId}});await db.user.deleteMany({where:{id:{in:[admin,operator,accountant]}}});};
  return {projectId,admin:scope(admin,'ADMIN'),operator:scope(operator,'USER'),accountant:scope(accountant,'MODERATOR'),s2,s10,a1,a2,a3,b1,tut,service,cleanup};
}
describe('Tổng quan (dashboard read model)',()=>{
  it('counts VMs per server with the grid rule, skips deleted servers/VMs and orders servers naturally',async()=>{
    const f=await fixture();try{
      const key=randomUUID(),p=await f.service.preview(f.admin,{mode:'MANUAL',vmIds:[f.a2.id],endpointId:f.tut.id,idempotencyKey:key});expect(p.ready).toBe(1);await f.service.commit(f.admin,p.token,key);
      const o=await readOverview(f.admin,{month:'2026-10'},db),ops=o.operations!;
      expect(ops.servers.map(s=>s.code)).toEqual(['moon2','moon10']);
      expect(ops.servers[0]).toMatchObject({code:'moon2',total:2,PENDING:1,MISSING:1,INSTALLED:0,REVIEW:0});
      // Same numbers as the Server / VM grid (active servers, active VMs) — the list the chart opens.
      const w=await readVMWorkspace(f.admin,db),live=new Set(w.servers.filter(s=>!s.archivedAt).map(s=>s.id)),grid=summarizeVMs(w.vms.filter(v=>!v.archivedAt&&live.has(v.serverId)));
      expect(ops.totals).toMatchObject({servers:2,vms:grid.total,PENDING:grid.pending,MISSING:grid.missing,INSTALLED:grid.installed,REVIEW:grid.review});
      expect(ops.gaps.noSdk).toBe(2);expect(ops.gaps.noAccount).toBe(3);expect(ops.gaps.noPaypal).toBe(3);
    }finally{await f.cleanup();}
  });
  it('proxy stock per group and state equals the registry list each segment opens (whole result, OTHER included)',async()=>{
    const f=await fixture();try{
      const o=await readOverview(f.admin,{month:'2026-10'},db),rows=o.operations!.stock.rows;
      expect(rows.map(r=>r.key)).toEqual(['TUT','SHARED','GENJY']);
      for(const row of rows)for(const state of ['NEW','LIVE','BLOCKED','OTHER'] as const){
        const page=await queryRegistry(f.admin,{view:'CURRENT',group:row.key,state,limit:1},db);
        expect(row[state],`${row.key} ${state}`).toBe(page.total);
      }
      expect(rows[0]).toMatchObject({NEW:3,BLOCKED:1,OTHER:0,total:4});// REPLACED is history, not in the current view
      expect(o.operations!.stock.total).toBe((await queryRegistry(f.admin,{view:'CURRENT',limit:1},db)).total);
    }finally{await f.cleanup();}
  });
  it('staff work excludes old-Sheet reconciliation; orphan install tasks are listed, closed once and reopened by undo',async()=>{
    const f=await fixture();try{
      await db.businessWorkItem.createMany({data:[{projectId:f.projectId,title:'Kiểm tra máy',createdById:f.admin.userId,kind:'TASK',dueDate:new Date('2026-01-01')},{projectId:f.projectId,title:'Dòng Sheet cũ',createdById:f.admin.userId,kind:'SHEET_REVIEW'},{projectId:f.projectId,title:'Đã xong',createdById:f.admin.userId,status:'COMPLETED'}]});
      const task=await db.vMTask.create({data:{vmId:f.b1.id,type:'PROXY_INSTALL',title:'Cài proxy cũ',scheduledAt:new Date('2026-01-01')}});
      let o=await readOverview(f.admin,{month:'2026-10'},db);
      expect(o.operations!.work).toMatchObject({open:1,overdue:1,sheetOpen:1});expect(o.operations!.work!.items.map(i=>i.title)).toEqual(['Kiểm tra máy']);
      expect(o.operations!.orphanTasks).toBe(1);expect((await readOrphanTasks(f.operator,db)).map(t=>t.id)).toEqual([task.id]);
      const member={projectId:f.projectId,userId:f.operator.userId};await db.projectMember.updateMany({where:member,data:{role:'VIEWER'}});
      await expect(closeOrphanTask(f.operator,{taskId:task.id},db)).rejects.toMatchObject({code:'FORBIDDEN'});// a viewer only reads
      await db.projectMember.updateMany({where:member,data:{role:'USER'}});
      expect(await closeOrphanTask(f.admin,{taskId:task.id},db)).toMatchObject({closed:true});
      expect(await closeOrphanTask(f.admin,{taskId:task.id},db)).toMatchObject({closed:false});// retry writes nothing
      o=await readOverview(f.admin,{month:'2026-10'},db);expect(o.operations!.orphanTasks).toBe(0);
      const op=(await listOperations(f.admin,db)).find(x=>x.kind==='VM_TASK_CLOSE')!;await undoOperation(f.admin,op.id,'',db);
      expect((await db.vMTask.findUniqueOrThrow({where:{id:task.id}})).status).toBe('PENDING');
      // A task that belongs to the VM's pending configuration is handled on Việc cài, never closed here.
      const key=randomUUID(),p=await f.service.preview(f.admin,{mode:'MANUAL',vmIds:[f.a1.id],endpointId:f.tut.id,idempotencyKey:key});await f.service.commit(f.admin,p.token,key);
      const live=await db.vMTask.findFirstOrThrow({where:{vmId:f.a1.id,status:'PENDING'}});
      await expect(closeOrphanTask(f.admin,{taskId:live.id},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
      expect((await readOrphanTasks(f.admin,db)).map(t=>t.id)).toEqual([task.id]);
    }finally{await f.cleanup();}
  });
  it('finance is team-received USDT minus valid costs per day; no records → no series; sections follow backend rights',async()=>{
    const f=await fixture();try{
      let o=await readOverview(f.admin,{month:'2026-10'},db);expect(o.finance).toEqual({enabled:false});
      await db.project.update({where:{id:f.projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
      o=await readOverview(f.admin,{month:'2026-10'},db);expect(o.finance).toMatchObject({enabled:true,received:'0.000000',records:0,series:[]});
      await saveTeamReceipt(f.admin,{key:randomUUID(),receivedDate:'2026-10-15',amountUsdt:'100',referenceId:randomUUID(),status:'CONFIRMED'},db);
      await saveTeamReceipt(f.admin,{key:randomUUID(),receivedDate:'2026-10-16',amountUsdt:'50',referenceId:randomUUID(),status:'DRAFT'},db);// not confirmed: not income
      await saveUsdtCost(f.admin,{key:randomUUID(),date:'2026-10-03',amount:'1000000',currency:'VND',rate:'25000',category:'SERVER',treatment:'CASH_COST'},db);
      o=await readOverview(f.admin,{month:'2026-10'},db);const fin=o.finance as Extract<typeof o.finance,{enabled:true}>;
      const report=(await teamCashSources(f.admin,{start:'2026-10-01',end:'2026-10-31'},db)).report;
      expect(fin).toMatchObject({received:report.teamReceived,cost:report.cost,net:report.net,blockingCount:report.blockingCount});
      expect(Number(fin.net)).toBe(60);expect(fin.series).toHaveLength(31);
      expect(fin.series.find(d=>d.date==='2026-10-15')).toEqual({date:'2026-10-15',received:'100.00',cost:'0.00'});
      expect(fin.series.find(d=>d.date==='2026-10-03')).toEqual({date:'2026-10-03',received:'0.00',cost:'40.00'});
      expect(fin.series.find(d=>d.date==='2026-10-16')!.received).toBe('0.00');
      expect((await readOverview(f.admin,{month:'2026-09'},db)).finance).toMatchObject({series:[],records:0});
      // Operator: operations, no finance. Accountant: finance, no operations.
      const op=await readOverview(f.operator,{month:'2026-10'},db);expect(op.operations).not.toBeNull();expect(op.finance).toBeNull();expect(op.rights).toMatchObject({infra:true,profit:false,costs:false});
      const acc=await readOverview(f.accountant,{month:'2026-10'},db);expect(acc.operations).toBeNull();expect(acc.finance).toMatchObject({enabled:true,net:fin.net});
      await expect(readOverview(f.admin,{month:'2026-13'},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    }finally{await f.cleanup();}
  });
});
