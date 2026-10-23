import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db,api,setup,prepareBody,balanceBody} from './ops-fixture';
import {beginTotpSetup,confirmTotpSetup,totpCodeFor} from '@/server/users/totp';
import {decideApproval,listApprovals,APPROVAL_TTL_MS} from '@/server/ops-api/approvals';
import {observeVmSdks} from '@/server/vm-management/sdk-observe';
afterAll(()=>db.$disconnect());
// Owner decision 23/10/2026: the AI needs only its token; critical commands wait for an ADMIN's 2FA approval on the web; SDK codes are masked.
// The setup is confirmed with the previous step's code (inside the ±1 window), so the current step and the next one stay usable for two decisions.
async function enableTotp(userId:string){const b=await beginTotpSetup(db,userId,{label:'t'});await confirmTotpSetup(db,userId,totpCodeFor(b.secret,Date.now()-30000),null);return b.secret;}
let offset=-30000;const nextCode=(secret:string)=>{offset+=30000;return totpCodeFor(secret,Date.now()+offset);};
describe('ops API without PIN; approvals for critical commands',()=>{
  it('a plain write needs no X-Ops-Pin; prepare is held until an ADMIN with 2FA approves; the same key then runs once and replays',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,['READ','BALANCE_WRITE','PAYOUT']),email=(await f.pp('pp-82')).emails[0].id;
      const v0=await f.vmNow(0);
      const b=await api('POST','vms/'+v0.id+'/balance-check',{token:t,pin:null,body:await balanceBody(f,0)});
      expect(b.status).toBe(200);
      // Critical: held, nothing recorded.
      const key=randomUUID(),body=await prepareBody(f,0,email);
      const held=await api('POST','withdrawals/prepare',{token:t,pin:null,key,body,autoApprove:false});
      expect(held.status).toBe(202);expect(held.json.error?.code).toBe('APPROVAL_REQUIRED');
      const approvalId=held.json.error!.details.approvalId as string;
      expect(await db.earnPayoutRequest.count({where:{projectId:f.projectId}})).toBe(0);
      const again=await api('POST','withdrawals/prepare',{token:t,pin:null,key,body,autoApprove:false});
      expect(again.status).toBe(202);expect(again.json.error!.details.approvalId).toBe(approvalId);
      // Same key, other body → conflict.
      const other=await api('POST','withdrawals/prepare',{token:t,pin:null,key,body:{...body,amount:'11.00'},autoApprove:false});
      expect(other.json.error?.code).toBe('IDEMPOTENCY_CONFLICT');
      const list=await listApprovals(db,f.projectId);
      expect(list[0]).toMatchObject({id:approvalId,status:'PENDING',action:'WITHDRAWAL_PREPARE',summary:{amount:'10.00 USD'}});
      const fullEmail=(await f.pp('pp-82')).emails[0].email;expect(JSON.stringify(list[0].summary)).not.toContain(fullEmail);expect(String(list[0].summary.paypal)).toMatch(/^pp-82 → .\*\*\*@/);
      // Not an ADMIN / ADMIN without 2FA / wrong code → refused.
      await expect(decideApproval(db,{approvalId,actorId:f.ai,projectId:f.projectId,approve:true,code:'000000'})).rejects.toThrow(/ADMIN/);
      await expect(decideApproval(db,{approvalId,actorId:f.scope.userId,projectId:f.projectId,approve:true,code:'000000'})).rejects.toThrow(/Bật 2FA/);
      const secret=await enableTotp(f.scope.userId);
      await expect(decideApproval(db,{approvalId,actorId:f.scope.userId,projectId:f.projectId,approve:true,code:'000000'})).rejects.toThrow(/Mã chưa đúng/);
      const d=await decideApproval(db,{approvalId,actorId:f.scope.userId,projectId:f.projectId,approve:true,code:nextCode(secret)});
      expect(d.status).toBe('APPROVED');
      // The retry runs once; the approval is consumed; a later retry replays the recorded command.
      const run=await api('POST','withdrawals/prepare',{token:t,pin:null,key,body,autoApprove:false});
      expect(run.status).toBe(200);expect(run.json.data.recorded.submission).toBe('PREPARING');
      expect((await db.opsApproval.findUniqueOrThrow({where:{id:approvalId}})).status).toBe('CONSUMED');
      const replay=await api('POST','withdrawals/prepare',{token:t,pin:null,key,body,autoApprove:false});
      expect(replay.status).toBe(200);expect(replay.json.data.replay).toBe(true);
      expect(await db.earnPayoutRequest.count({where:{projectId:f.projectId}})).toBe(1);
      // Rejected and expired paths.
      const k2=randomUUID(),b2=await prepareBody(f,1,(await f.pp('pp-82')).emails[1].id);
      const h2=await api('POST','withdrawals/prepare',{token:t,pin:null,key:k2,body:b2,autoApprove:false});
      await decideApproval(db,{approvalId:h2.json.error!.details.approvalId,actorId:f.scope.userId,projectId:f.projectId,approve:false,code:nextCode(secret),note:'không rút lúc này'});
      const rej=await api('POST','withdrawals/prepare',{token:t,pin:null,key:k2,body:b2,autoApprove:false});
      expect(rej.status).toBe(403);expect(rej.json.error?.code).toBe('APPROVAL_REJECTED');
      const k3=randomUUID(),h3=await api('POST','withdrawals/prepare',{token:t,pin:null,key:k3,body:b2,autoApprove:false});
      await db.opsApproval.update({where:{id:h3.json.error!.details.approvalId},data:{expiresAt:new Date(Date.now()-APPROVAL_TTL_MS)}});
      const exp=await api('POST','withdrawals/prepare',{token:t,pin:null,key:k3,body:b2,autoApprove:false});
      expect(exp.status).toBe(410);expect(exp.json.error?.code).toBe('APPROVAL_EXPIRED');
    }finally{await db.opsApproval.deleteMany({where:{projectId:f.projectId}});await db.userBackupCode.deleteMany({where:{userId:f.scope.userId}});await f.cleanup();}
  });
  it('SDK codes are masked in every read; the full code needs an approved reveal',async()=>{
    offset=-30000;const f=await setup();try{
      const t=await f.token(f.ai,['READ','BALANCE_WRITE','PAYOUT']),v0=await f.vmNow(0),code='sdk-win-'+f.x+'-abcdef123456';
      const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:v0.id}});
      await observeVmSdks(f.scope,{key:'obs-'+randomUUID(),vmId:v0.id,expectedCycle:v0.cycle,expectedVmRevision:vm.revision,observedAt:new Date().toISOString(),source:'test',items:[{code,expectedSdkRevision:null,current:true}]},db);
      const detail=await api('GET','vms/'+v0.id+'?projectId='+f.projectId,{token:t});
      expect(detail.status).toBe(200);
      const item=detail.json.data.sdk.items[0];
      expect(item.code).toBe('sdk-…3456');expect(detail.text).not.toContain(code);
      const look=await api('GET','sdks?projectId='+f.projectId+'&code='+encodeURIComponent(code),{token:t});
      expect(look.json.data.items[0]).toMatchObject({found:true,code:'sdk-…3456',sdkId:item.id});
      expect(look.text).not.toContain(code);
      // Reveal: VM_OPS token + approval.
      const tv=await f.token(f.ai,['READ','VM_OPS' as never]),key=randomUUID();
      const held=await api('POST','sdks/'+item.id+'/reveal',{token:tv,pin:null,key,body:{projectId:f.projectId},autoApprove:false});
      expect(held.status).toBe(202);expect(held.text).not.toContain(code);
      const secret=await enableTotp(f.scope.userId);
      await decideApproval(db,{approvalId:held.json.error!.details.approvalId,actorId:f.scope.userId,projectId:f.projectId,approve:true,code:nextCode(secret)});
      const shown=await api('POST','sdks/'+item.id+'/reveal',{token:tv,pin:null,key,body:{projectId:f.projectId},autoApprove:false});
      expect(shown.status).toBe(200);expect(shown.json.data.code).toBe(code);
    }finally{await db.opsApproval.deleteMany({where:{projectId:f.projectId}});await db.userBackupCode.deleteMany({where:{userId:f.scope.userId}});await db.vMSdkHistory.deleteMany({where:{vmId:{in:f.vms.map(v=>v.id)}}});await f.cleanup();}
  });
});
