import {afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db,api,setup,balanceBody,prepareBody} from './ops-fixture';
import {beginTotpSetup,confirmTotpSetup,totpCodeFor} from '@/server/users/totp';
import {addManagedVMs} from '@/server/vm-management/metadata';

afterAll(()=>db.$disconnect());
async function cleanup(f:Awaited<ReturnType<typeof setup>>){
 await db.opsBatchKey.deleteMany({where:{projectId:f.projectId}});
 await db.opsApproval.deleteMany({where:{projectId:f.projectId}});
 await db.vmJob.deleteMany({where:{projectId:f.projectId}});
 await db.vMSdkHistory.deleteMany({where:{vm:{server:{projectId:f.projectId}}}});
 await db.userBackupCode.deleteMany({where:{userId:f.scope.userId}});
 await f.cleanup();
}
const item=(path:string,body:unknown)=>({method:'POST',path,body,idempotencyKey:randomUUID()});
describe('AI stocks and batch through the real HTTP handler',()=>{
 it('lists masked stock; holds one login for an owned VM job; releases only before registration',async()=>{
  const f=await setup();try{
   const token=await f.token(f.ai,['READ','VM_OPS','ACCOUNT_OPS'] as never);
   const list=await api('GET',`earnapp-accounts?projectId=${f.projectId}&state=UNUSED&type=GMAIL`,{token});
   expect(list.status).toBe(200);expect(list.json.data.items).toHaveLength(3);expect(list.text).not.toContain('Secret-pw');
   await addManagedVMs(f.scope,f.server.id,['NEW_701'],db);
   const vm=await db.virtualMachine.findFirstOrThrow({where:{serverId:f.server.id,code:'NEW_701'}});
   const claim=await api('POST',`vms/${vm.id}/claim`,{token,body:{projectId:f.projectId,expectedCycle:1,kind:'PREPARE'}});
   expect(claim.status).toBe(200);const jobId=claim.json.data.recorded.job.id;
   const v=await db.virtualMachine.findUniqueOrThrow({where:{id:vm.id}}),key=randomUUID();
   const body={projectId:f.projectId,vmId:vm.id,expectedCycle:1,expectedVmRevision:v.revision,jobId,loginType:'GMAIL'};
   const held=await api('POST','earnapp-accounts/hold',{token,key,body});
   expect(held.status).toBe(200);const r=held.json.data.recorded;
   expect(r.email).toContain('***');
   const replay=await api('POST','earnapp-accounts/hold',{token,key,body});
   expect(replay.json.data.replay).toBe(true);expect(replay.json.data.recorded).toEqual(r);
   const cred=await api('POST',`earnapp-accounts/${r.accountId}/credentials`,{token,autoApprove:false,body:{projectId:f.projectId,vmId:vm.id,jobId}});
   expect(cred.status).toBe(202);expect(cred.text).not.toContain('Secret-pw');
   const release=await api('POST',`earnapp-accounts/${r.accountId}/release`,{token,body:{projectId:f.projectId,vmId:vm.id,expectedCycle:1,jobId,expectedRevision:r.revision,reason:'Chưa đăng ký, chủ yêu cầu trả kho'}});
   expect(release.status).toBe(200);expect(release.json.data.recorded.released).toBe(true);
   const noScope=await f.token(f.ai,['READ']);
   expect((await api('GET',`earnapp-accounts?projectId=${f.projectId}`,{token:noScope})).status).toBe(403);
  }finally{await cleanup(f);}
 });
 it('runs ordinary items, holds one approval for secrets, confirms at CLI then replays without duplicate money',async()=>{
  const f=await setup();try{
   const token=await f.token(f.ai,['READ','BALANCE_WRITE','PAYOUT']),key=randomUUID(),vm=await f.vmNow(0);
   const body={projectId:f.projectId,items:[item(`vms/${vm.id}/balance-check`,await balanceBody(f,0)),item('withdrawals/prepare',await prepareBody(f,0,(await f.pp('pp-82')).emails[0].id))]};
   const pending=await api('POST','batch',{token,key,body,autoApprove:false});
   expect(pending.status).toBe(202);expect(pending.json.ok).toBe(true);
   expect(pending.json.data.summary).toEqual({ok:1,waiting:1,refused:0});
   expect(await db.earnBalanceCheck.count({where:{projectId:f.projectId}})).toBe(1);
   const approvalId=pending.json.data.approval.approvalId;
   expect(await db.opsApproval.count({where:{projectId:f.projectId}})).toBe(1);
   const begin=await beginTotpSetup(db,f.scope.userId,{label:'batch test'});
   await confirmTotpSetup(db,f.scope.userId,totpCodeFor(begin.secret,Date.now()-30000),null);
   const admin=await db.user.findUniqueOrThrow({where:{id:f.scope.userId}});
   const detail=await api('GET',`approvals/${approvalId}?projectId=${f.projectId}`,{token});expect(detail.json.data.status).toBe('PENDING');
   const confirmed=await api('POST',`approvals/${approvalId}/confirm`,{token,body:{projectId:f.projectId,admin:admin.email,totp:totpCodeFor(begin.secret)},autoApprove:false});
   expect(confirmed.status).toBe(200);expect(confirmed.json.data.status).toBe('APPROVED');
   const done=await api('POST','batch',{token,key,body,autoApprove:false});
   expect(done.status).toBe(200);expect(done.json.data.summary).toEqual({ok:2,waiting:0,refused:0});
   const again=await api('POST','batch',{token,key,body,autoApprove:false});expect(again.json.data.summary.ok).toBe(2);
   expect(await db.earnBalanceCheck.count({where:{projectId:f.projectId}})).toBe(1);
   expect(await db.earnPayoutRequest.count({where:{projectId:f.projectId}})).toBe(1);
   const logs=JSON.stringify(await db.opsAudit.findMany({where:{projectId:f.projectId}}));expect(logs).not.toContain(begin.secret);
  }finally{await cleanup(f);}
 });
 it('wires proxy inventory and SDK assignment/linking to an owned job without exposing SDK codes',async()=>{
  const f=await setup();try{
   const token=await f.token(f.ai,['READ','VM_OPS','ACCOUNT_OPS'] as never),v=await f.vmNow(0);
   const proxies=await api('GET',`proxies?projectId=${f.projectId}&state=FREE&group=TUT`,{token});
   expect(proxies.status).toBe(200);expect(proxies.json.data.items).toEqual([]);
   const claim=await api('POST',`vms/${v.id}/claim`,{token,body:{projectId:f.projectId,expectedCycle:1,kind:'CHECK'}});
   expect(claim.status).toBe(200);const jobId=claim.json.data.recorded.job.id;
   const missing=await api('POST',`vms/${v.id}/proxy-assign`,{token,body:{projectId:f.projectId,expectedCycle:1,expectedVmRevision:(await f.vmNow(0)).revision,jobId,pick:{group:'TUT'}}});
   expect(missing.status).toBe(422);
   const sdk=await db.sdkRecord.create({data:{projectId:f.projectId,code:'sdk-win-http-'+randomUUID(),linkState:'UNLINKED'}});
   const stock=await api('GET',`sdks?projectId=${f.projectId}&state=UNLINKED&place=STOCK&limit=1`,{token});
   expect(stock.status).toBe(200);expect(stock.json.data.items[0].sdkId).toBe(sdk.id);expect(stock.text).not.toContain(sdk.code);
   const body={projectId:f.projectId,expectedCycle:1,expectedVmRevision:(await f.vmNow(0)).revision,jobId,sdkId:sdk.id,expectedSdkRevision:sdk.revision};
   const placed=await api('POST',`vms/${v.id}/sdk-assign`,{token,body});expect(placed.status).toBe(200);expect(placed.text).not.toContain(sdk.code);
   const after=await db.sdkRecord.findUniqueOrThrow({where:{id:sdk.id}});
   const linked=await api('POST',`vms/${v.id}/sdk-linked`,{token,body:{projectId:f.projectId,expectedCycle:1,jobId,sdkId:sdk.id,expectedSdkRevision:after.revision,accountId:v.earnAppId,evidence:'Kiểm tra thực tế đăng nhập đúng tài khoản trong fixture'}});
   expect(linked.status).toBe(200);expect(linked.json.data.recorded.sdk.linkState).toBe('LINKED');expect(linked.text).not.toContain(sdk.code);
   const account=await db.earnAppAccount.findUniqueOrThrow({where:{id:v.earnAppId}});
   const used=await api('POST',`earnapp-accounts/${v.earnAppId}/used`,{token,body:{projectId:f.projectId,vmId:v.id,expectedCycle:1,jobId,expectedRevision:account.revision,evidence:'Đã đăng ký thật trong fixture'}});
   expect(used.status).toBe(200);expect(used.json.data.recorded.registered).toBe(true);
   const release=await api('POST',`earnapp-accounts/${v.earnAppId}/release`,{token,body:{projectId:f.projectId,vmId:v.id,expectedCycle:1,jobId,expectedRevision:used.json.data.recorded.revision,reason:'Không được trả account đã dùng'}});
   expect(release.status).toBe(422);
  }finally{await cleanup(f);}
 });
 it('binds an ordinary batch key to its content; an unauthorized item does not stop allowed items',async()=>{
  const f=await setup();try{
   const token=await f.token(f.ai,['READ','BALANCE_WRITE']),key=randomUUID(),v=await f.vmNow(0);
   const body={projectId:f.projectId,items:[item(`vms/${v.id}/balance-check`,await balanceBody(f,0)),item('withdrawals/prepare',await prepareBody(f,0,(await f.pp('pp-82')).emails[0].id))]};
   const r=await api('POST','batch',{token,key,body,autoApprove:false});expect(r.status).toBe(200);expect(r.json.data.summary).toEqual({ok:1,refused:1,waiting:0});
   const replacement=await f.token(f.ai,['READ','BALANCE_WRITE']);
   const rotated=await api('POST','batch',{token:replacement,key,body,autoApprove:false});
   expect(rotated.status).toBe(200);expect(rotated.json.data.items[0].body.data.replay).toBe(true);
   const changed=await api('POST','batch',{token,key,body:{...body,items:[item(`vms/${v.id}/balance-check`,await balanceBody(f,0,{amount:'99'}))]},autoApprove:false});
   expect(changed.status).toBe(409);expect(changed.json.error?.code).toBe('IDEMPOTENCY_CONFLICT');
   expect(await db.earnBalanceCheck.count({where:{projectId:f.projectId}})).toBe(1);
  }finally{await cleanup(f);}
 });
 it('five incorrect confirmations lock the approval, which cannot recreate itself under the same key',async()=>{
  const f=await setup();try{
   const token=await f.token(f.ai,['READ','PAYOUT']),key=randomUUID(),body=await prepareBody(f,0,(await f.pp('pp-82')).emails[0].id);
   const pending=await api('POST','withdrawals/prepare',{token,key,body,autoApprove:false}),id=pending.json.error!.details.approvalId;
   const begin=await beginTotpSetup(db,f.scope.userId,{label:'lock test'});
   await confirmTotpSetup(db,f.scope.userId,totpCodeFor(begin.secret,Date.now()-30000),null);
   const admin=await db.user.findUniqueOrThrow({where:{id:f.scope.userId}});
   const wrong=Array.from({length:100},(_,i)=>String(i).padStart(6,'0')).find(x=>![-30000,0,30000].some(d=>totpCodeFor(begin.secret,Date.now()+d)===x))!;
   for(let i=0;i<5;i++)expect((await api('POST',`approvals/${id}/confirm`,{token,body:{projectId:f.projectId,admin:admin.email,totp:wrong},autoApprove:false})).status).toBe(403);
   expect((await db.opsApproval.findUniqueOrThrow({where:{id}})).status).toBe('LOCKED');
   const retry=await api('POST','withdrawals/prepare',{token,key,body,autoApprove:false});expect(retry.status).toBe(403);
   expect(retry.json.error?.code).toBe('APPROVAL_REJECTED');
   expect(await db.opsApproval.count({where:{projectId:f.projectId}})).toBe(1);
  }finally{await cleanup(f);}
 });
 it('replays committed critical items after a partial batch approval has expired',async()=>{
  const f=await setup();try{
   const token=await f.token(f.ai,['READ','PAYOUT']),key=randomUUID();
   const body={projectId:f.projectId,items:[item('withdrawals/prepare',await prepareBody(f,0,(await f.pp('pp-82')).emails[0].id)),item('withdrawals/prepare',await prepareBody(f,1,'missing-email'))]};
   const pending=await api('POST','batch',{token,key,body,autoApprove:false}),approvalId=pending.json.data.approval.approvalId;
   await db.opsApproval.update({where:{id:approvalId},data:{status:'APPROVED',decidedById:f.scope.userId}});
   const first=await api('POST','batch',{token,key,body,autoApprove:false});expect(first.json.data.items[0].status).toBe(200);expect(first.json.data.items[1].status).toBeGreaterThanOrEqual(400);
   await db.opsApproval.update({where:{id:approvalId},data:{expiresAt:new Date(0)}});
   const retry=await api('POST','batch',{token,key,body,autoApprove:false});
   expect(retry.json.data.items[0].status).toBe(200);expect(retry.json.data.items[0].body.data.replay).toBe(true);
   expect(retry.json.data.items[0].body.data.recorded).toEqual(first.json.data.items[0].body.data.recorded);
   expect(retry.json.data.items[1].status).toBe(410);expect(await db.earnPayoutRequest.count({where:{projectId:f.projectId}})).toBe(1);
  }finally{await cleanup(f);}
 });
 it.each(['sdk-linked','account-used'])('%s errors never disclose an already-used SDK code',async operation=>{
  const f=await setup();try{
   const token=await f.token(f.ai,['READ','VM_OPS','ACCOUNT_OPS'] as never),v=await f.vmNow(0);
   const claim=await api('POST',`vms/${v.id}/claim`,{token,body:{projectId:f.projectId,expectedCycle:1,kind:'CHECK'}}),jobId=claim.json.data.recorded.job.id;
   const sdk=await db.sdkRecord.create({data:{projectId:f.projectId,code:'sdk-win-previous-account-'+randomUUID(),vmId:v.id,holderVmId:v.id,linkState:'LINKED'}});
   const account=await db.earnAppAccount.findUniqueOrThrow({where:{id:v.earnAppId}});
   const path=operation==='sdk-linked'?`vms/${v.id}/sdk-linked`:`earnapp-accounts/${v.earnAppId}/used`;
   const body={projectId:f.projectId,expectedCycle:1,jobId,sdkId:sdk.id,expectedSdkRevision:sdk.revision,evidence:'Đã thấy máy đang dùng mã này',...(operation==='sdk-linked'?{accountId:v.earnAppId}:{vmId:v.id,expectedRevision:account.revision})};
   const refused=await api('POST',path,{token,body});expect(refused.status).toBe(409);expect(refused.text).not.toContain(sdk.code);
   expect((await db.earnAppAccount.findUniqueOrThrow({where:{id:v.earnAppId}})).registeredAt).toBeNull();
  }finally{await cleanup(f);}
 });
 it('credentials refuse an ACTIVE job from an older VM round',async()=>{
  const f=await setup();try{
   const token=await f.token(f.ai,['READ','VM_OPS','ACCOUNT_OPS'] as never),v=await f.vmNow(0);
   const claim=await api('POST',`vms/${v.id}/claim`,{token,body:{projectId:f.projectId,expectedCycle:1,kind:'CHECK'}}),jobId=claim.json.data.recorded.job.id;
   await db.vmOperation.upsert({where:{vmId:v.id},create:{projectId:f.projectId,vmId:v.id,cycle:2},update:{cycle:2}});
   const r=await api('POST',`earnapp-accounts/${v.earnAppId}/credentials`,{token,body:{projectId:f.projectId,vmId:v.id,jobId}});
   expect(r.status).toBe(409);expect(r.text).not.toContain('Secret-pw');
  }finally{await cleanup(f);}
 });
});

