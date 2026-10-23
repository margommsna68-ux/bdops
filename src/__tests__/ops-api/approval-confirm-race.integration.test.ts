import {afterAll,describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db,api,setup,prepareBody} from './ops-fixture';
import * as totp from '@/server/users/totp';
afterAll(()=>db.$disconnect());
describe('CLI approval rechecks immediately before the decision',()=>{
 it.each(['reset-2fa','demote-admin','revoke-token','expired','fifth-wrong'] as const)('%s cannot approve after the code was checked',async change=>{
  const f=await setup();try{
   const token=await f.token(f.ai,['READ','PAYOUT']),key=randomUUID(),body=await prepareBody(f,0,(await f.pp('pp-82')).emails[0].id);
   const held=await api('POST','withdrawals/prepare',{token,key,body,autoApprove:false}),approvalId=held.json.error!.details.approvalId;
   const b=await totp.beginTotpSetup(db,f.scope.userId,{label:'race'});
   await totp.confirmTotpSetup(db,f.scope.userId,totp.totpCodeFor(b.secret,Date.now()-30000),null);
   const admin=await db.user.findUniqueOrThrow({where:{id:f.scope.userId}}),real=totp.checkTotp;
   vi.spyOn(totp,'checkTotp').mockImplementationOnce(async(...args)=>{
    const result=await real(...args);
    if(change==='reset-2fa')await db.user.update({where:{id:admin.id},data:{totpVersion:{increment:1},totpEnabledAt:null}});
    if(change==='demote-admin')await db.projectMember.update({where:{userId_projectId:{userId:admin.id,projectId:f.projectId}},data:{role:'USER'}});
    if(change==='revoke-token')await db.opsToken.updateMany({where:{userId:f.ai},data:{revokedAt:new Date()}});
    if(change==='expired')await db.opsApproval.update({where:{id:approvalId},data:{expiresAt:new Date(0)}});
    if(change==='fifth-wrong')await db.opsApproval.update({where:{id:approvalId},data:{confirmFailed:5,status:'LOCKED'}});
    return result;
   });
   const answer=await api('POST',`approvals/${approvalId}/confirm`,{token,body:{projectId:f.projectId,admin:admin.email,totp:totp.totpCodeFor(b.secret)},autoApprove:false});
   expect(answer.status).toBeGreaterThanOrEqual(400);
   expect((await db.opsApproval.findUniqueOrThrow({where:{id:approvalId}})).status).not.toBe('APPROVED');
  }finally{vi.restoreAllMocks();await db.opsApproval.deleteMany({where:{projectId:f.projectId}});await db.userBackupCode.deleteMany({where:{userId:f.scope.userId}});await f.cleanup();}
 });
});

