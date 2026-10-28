import {afterAll,describe,expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {db,api,setup,prepareBody} from './ops-fixture';
import {payloadHashOf} from '@/server/ops-api/approvals';

afterAll(()=>db.$disconnect());
async function fixture(){
 const f=await setup(),token=await f.token(f.ai,['READ','VM_OPS','ACCOUNT_OPS','PAYOUT'] as never),v=await f.vmNow(0);
 const claim=await api('POST',`vms/${v.id}/claim`,{token,body:{projectId:f.projectId,expectedCycle:1,kind:'CHECK'},autoApprove:false});
 expect(claim.status).toBe(200);const jobId=claim.json.data.recorded.job.id;
 const sdk=await db.sdkRecord.create({data:{projectId:f.projectId,code:'sdk-win-direct-'+randomUUID(),holderVmId:v.id,vmId:v.id}});
 const accountPath=`earnapp-accounts/${v.earnAppId}/credentials`,sdkPath=`sdks/${sdk.id}/reveal`,accountBody={projectId:f.projectId,vmId:v.id,jobId};
 const cleanup=async()=>{await db.opsBatchKey.deleteMany({where:{projectId:f.projectId}});await db.opsApproval.deleteMany({where:{projectId:f.projectId}});await db.vmJob.deleteMany({where:{projectId:f.projectId}});await f.cleanup();};
 return {...f,createToken:f.token,token,v,jobId,sdk,accountPath,sdkPath,accountBody,cleanup};
}
describe('owner-authorized unattended inventory access',()=>{
 it('advertises approval only for money commands; account credentials are direct and audited without secrets',async()=>{const f=await fixture();try{
  const me=await api('GET','me',{token:f.token});expect(me.json.data.approvalRequired).toEqual(['WITHDRAWAL_PREPARE']);
  const r=await api('POST',f.accountPath,{token:f.token,pin:null,body:f.accountBody,autoApprove:false});expect(r.status).toBe(200);expect(r.json.data.credentials.password).toMatch(/^Secret-pw-/);
  expect(await db.opsApproval.count({where:{projectId:f.projectId}})).toBe(0);
  const audit=JSON.stringify(await db.auditLog.findMany({where:{projectId:f.projectId,action:'AI_ACCOUNT_CREDENTIALS'}}));expect(audit).toContain(f.v.id);expect(audit).not.toContain(r.json.data.credentials.password);
 }finally{await f.cleanup();}});
 it('reads SDK immediately even with an old pending approval; normal reads stay masked',async()=>{const f=await fixture();try{
  const key=randomUUID(),body={projectId:f.projectId},row=await db.opsToken.findUniqueOrThrow({where:{tokenHash:createHash('sha256').update(f.token).digest('hex')}});
  await db.opsApproval.create({data:{projectId:f.projectId,tokenId:row.id,userId:f.ai,action:'SDK_REVEAL',method:'POST',path:f.sdkPath,objectId:f.sdk.id,requestKey:'ops:'+createHash('sha256').update(f.ai+'\u0000'+f.projectId+'\u0000'+key).digest('hex').slice(0,48),payloadHash:payloadHashOf('POST',f.sdkPath,body),summary:{},expiresAt:new Date(Date.now()+60000)}});
  const r=await api('POST',f.sdkPath,{token:f.token,key,pin:null,body,autoApprove:false});expect(r.status).toBe(200);expect(r.json.data.code).toBe(f.sdk.code);
  const list=await api('GET','sdks?projectId='+f.projectId,{token:f.token});expect(list.text).not.toContain(f.sdk.code);
  expect(await db.opsApproval.count({where:{projectId:f.projectId}})).toBe(1);expect(await db.opsApproval.count({where:{projectId:f.projectId,decidedById:{not:null}}})).toBe(0);
 }finally{await f.cleanup();}});
 it('inventory-only batches finish without an approval while payout still waits',async()=>{const f=await fixture();try{
  const r=await api('POST','batch',{token:f.token,autoApprove:false,body:{projectId:f.projectId,items:[{path:f.accountPath,body:f.accountBody,idempotencyKey:randomUUID()},{path:f.sdkPath,body:{projectId:f.projectId},idempotencyKey:randomUUID()}]}});
  expect(r.status).toBe(200);expect(r.json.data.summary).toEqual({ok:2,waiting:0,refused:0});expect(await db.opsApproval.count({where:{projectId:f.projectId}})).toBe(0);
  const payout=await api('POST','withdrawals/prepare',{token:f.token,autoApprove:false,body:await prepareBody({...f,token:f.createToken},0,(await f.pp('pp-82')).emails[0].id)});expect(payout.status).toBe(202);expect(payout.json.error?.code).toBe('APPROVAL_REQUIRED');
 }finally{await f.cleanup();}});
 it('still refuses missing scopes, wrong jobs, revoked tokens and disabled users',async()=>{const f=await fixture();try{
  const readOnly=await f.createToken(f.ai,['READ']);for(const path of [f.accountPath,f.sdkPath])expect((await api('POST',path,{token:readOnly,autoApprove:false,body:f.accountBody})).status).toBe(403);
  expect((await api('POST',f.accountPath,{token:f.token,autoApprove:false,body:{...f.accountBody,jobId:'missing-job'}})).status).toBeGreaterThanOrEqual(400);
  await db.user.update({where:{id:f.ai},data:{disabledAt:new Date()}});expect((await api('POST',f.accountPath,{token:f.token,autoApprove:false,body:f.accountBody})).status).toBe(403);await db.user.update({where:{id:f.ai},data:{disabledAt:null}});
  await db.opsToken.updateMany({where:{userId:f.ai},data:{revokedAt:new Date()}});expect((await api('POST',f.sdkPath,{token:f.token,autoApprove:false,body:{projectId:f.projectId}})).status).toBe(401);
  expect(await db.auditLog.count({where:{projectId:f.projectId,action:{in:['SDK_REVEAL','AI_ACCOUNT_CREDENTIALS']}}})).toBe(0);
 }finally{await f.cleanup();}});
});
