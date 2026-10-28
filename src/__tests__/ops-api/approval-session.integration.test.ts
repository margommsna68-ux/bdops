import {afterAll,afterEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db,api,setup,prepareBody,type F} from './ops-fixture';
import {expectConforms} from './openapi-conform';
import {beginTotpSetup,confirmTotpSetup,totpCodeFor} from '@/server/users/totp';
import {listApprovals,pendingApprovalCount} from '@/server/ops-api/approvals';
import {APPROVAL_SESSION_MS,activeSession,approveAllPending,closeApprovalSession,openApprovalSession} from '@/server/ops-api/approval-session';
afterAll(()=>db.$disconnect());
afterEach(()=>{vi.useRealTimers();});
// Owner decision 28/10/2026: one ADMIN TOTP opens a 15-minute window in which the token's withdrawal prepares are approved at once.
// Only Date is faked: each new code is taken after moving the clock one TOTP step (30 s) forward, so checkTotp sees a fresh step.
let clock=0;
function startClock(){clock=Date.now();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(clock);}
function tick(ms:number){clock+=ms;vi.setSystemTime(clock);}
async function enableTotp(userId:string){const b=await beginTotpSetup(db,userId,{label:'s'});await confirmTotpSetup(db,userId,totpCodeFor(b.secret,Date.now()-30000),null);return b.secret;}
const fresh=(secret:string)=>{tick(30000);return totpCodeFor(secret,Date.now());};
async function ready(){
  // Tokens are made with the ADMIN's PIN, which confirming 2FA retires: make them first.
  startClock();const f=await setup(),admin=await db.user.findUniqueOrThrow({where:{id:f.scope.userId}});
  const t=await f.token(f.ai,['READ','PAYOUT']),tokenId=(await db.opsToken.findFirstOrThrow({where:{userId:f.ai},orderBy:{createdAt:'desc'}})).id;
  const other=await f.token(f.ai,['READ','PAYOUT']),secret=await enableTotp(admin.id);
  return {f,admin,secret,t,tokenId,other};
}
const open=(f:F,t:string,admin:string,totp:string,key=randomUUID())=>api('POST','approval-sessions',{token:t,key,body:{projectId:f.projectId,admin,totp},autoApprove:false});
const prepare=async(f:F,t:string,i:number,email:number,key=randomUUID())=>{const body=await prepareBody(f,i,(await f.pp('pp-82')).emails[email].id);return {key,body,r:await api('POST','withdrawals/prepare',{token:t,key,body,autoApprove:false})};};
async function done(f:F){vi.useRealTimers();await db.opsApproval.deleteMany({where:{projectId:f.projectId}});await db.opsApprovalSession.deleteMany({where:{projectId:f.projectId}});await db.userBackupCode.deleteMany({where:{userId:f.scope.userId}});await db.projectMember.deleteMany({where:{projectId:f.g.scope.projectId,userId:f.scope.userId}});await f.cleanup();}
describe('15-minute approval session',()=>{
  it('opening a session approves pending prepares and later ones run at once',async()=>{
    const {f,admin,secret,t,tokenId}=await ready();try{
      const p1=await prepare(f,t,0,0);expect(p1.r.status).toBe(202);
      const code=fresh(secret),o=await open(f,t,admin.email,code);
      expect(o.status).toBe(200);expect(o.json.data.approvedPending).toBe(1);expectConforms('POST','approval-sessions',o);
      expect(new Date(o.json.data.expiresAt).getTime()).toBe(Date.now()+APPROVAL_SESSION_MS);
      const again=await api('POST','withdrawals/prepare',{token:t,key:p1.key,body:p1.body,autoApprove:false});expect(again.status).toBe(200);
      const p2=await prepare(f,t,1,1);expect(p2.r.status).toBe(200);
      const rows=await db.opsApproval.findMany({where:{projectId:f.projectId},orderBy:{requestedAt:'asc'}});
      expect(rows).toHaveLength(2);
      for(const r of rows){expect(r.status).toBe('CONSUMED');expect(r.sessionId).toBe(o.json.data.sessionId);expect(r.decidedById).toBe(admin.id);expect(r.decisionNote).toMatch(/^Duyệt theo phiên \d\d:\d\d$/);}
      const me=await api('GET','me',{token:t});expect(me.status).toBe(200);expectConforms('GET','me',me);
      expect(me.json.data.approvalSession).toMatchObject({open:true,expiresAt:o.json.data.expiresAt});expect(me.json.data.approvalSession.approvedBy).toBeTruthy();
      const s=await db.opsApprovalSession.findUniqueOrThrow({where:{id:o.json.data.sessionId}});expect(s).toMatchObject({tokenId,approvedById:admin.id,via:'CLI',closedAt:null});
      // The code is never kept: not in the OpsAudit, the AuditLog or the session row.
      const audits=await db.auditLog.findMany({where:{projectId:f.projectId,action:{startsWith:'OPS_SESSION'}}});expect(audits.map(a=>a.action)).toContain('OPS_SESSION_OPEN');
      const trace=JSON.stringify([audits,await db.opsAudit.findMany({where:{tokenId}}),s]);expect(trace).not.toContain(code);
    }finally{await done(f);}
  });
  it('a batch with prepare items runs inside a session; session routes are refused inside a batch',async()=>{
    const {f,admin,secret,t}=await ready();try{
      const o=await open(f,t,admin.email,fresh(secret));expect(o.json.data.approvedPending).toBe(0);
      const emails=(await f.pp('pp-82')).emails;
      const items=[0,1].map(i=>({method:'POST',path:'withdrawals/prepare',idempotencyKey:'sess-item-'+i+'-'+f.x}));
      const bodies=await Promise.all([0,1].map(i=>prepareBody(f,i,emails[i].id)));
      const b=await api('POST','batch',{token:t,body:{projectId:f.projectId,items:items.map((it,i)=>({...it,body:bodies[i]}))},autoApprove:false});
      expect(b.status).toBe(200);expect(b.json.data.summary).toMatchObject({ok:2,waiting:0});
      const row=await db.opsApproval.findFirstOrThrow({where:{projectId:f.projectId,action:'BATCH'}});expect(row.status).toBe('CONSUMED');expect(row.sessionId).toBe(o.json.data.sessionId);
      const bad=await api('POST','batch',{token:t,body:{projectId:f.projectId,items:[{method:'POST',path:'approval-sessions',idempotencyKey:'sess-bad-'+f.x,body:{admin:admin.email,totp:'123456'}},{method:'POST',path:'approval-sessions/close',idempotencyKey:'sess-bad2-'+f.x,body:{}}]},autoApprove:false});
      expect(bad.json.data.items.map((x:{status:number})=>x.status)).toEqual([422,422]);
    }finally{await done(f);}
  });
  it('session ends after 15 minutes',async()=>{
    const {f,admin,secret,t}=await ready();try{
      expect((await open(f,t,admin.email,fresh(secret))).status).toBe(200);
      tick(APPROVAL_SESSION_MS+1000);
      expect((await prepare(f,t,0,0)).r.status).toBe(202);
      expect((await api('GET','me',{token:t})).json.data.approvalSession).toEqual({open:false,expiresAt:null,approvedBy:null});
    }finally{await done(f);}
  });
  it.each(['demote','reset-2fa','disable','lock'] as const)('%s of the admin ends the session now',async change=>{
    const {f,admin,secret,t}=await ready();try{
      expect((await open(f,t,admin.email,fresh(secret))).status).toBe(200);
      if(change==='demote')await db.projectMember.update({where:{userId_projectId:{userId:admin.id,projectId:f.projectId}},data:{role:'MODERATOR'}});
      if(change==='reset-2fa')await db.user.update({where:{id:admin.id},data:{totpVersion:{increment:1}}});
      if(change==='disable')await db.user.update({where:{id:admin.id},data:{disabledAt:new Date()}});
      if(change==='lock')await db.user.update({where:{id:admin.id},data:{totpLockedAt:new Date()}});
      expect((await prepare(f,t,0,0)).r.status).toBe(202);
      expect((await api('GET','me',{token:t})).json.data.approvalSession.open).toBe(false);
    }finally{await done(f);}
  });
  it('revoking the token ends the session now; a session never covers another token',async()=>{
    const {f,admin,secret,t,tokenId,other}=await ready();try{
      expect((await open(f,t,admin.email,fresh(secret))).status).toBe(200);
      expect((await prepare(f,other,0,0)).r.status).toBe(202);
      await db.opsToken.update({where:{id:tokenId},data:{revokedAt:new Date()}});
      expect(await db.$transaction(tx=>activeSession(tx,{projectId:f.projectId,tokenId}))).toBeNull();
      expect((await prepare(f,t,1,1)).r.status).toBe(401);
    }finally{await done(f);}
  });
  it('closing the session restores 202',async()=>{
    const {f,admin,secret,t,tokenId}=await ready();try{
      expect((await open(f,t,admin.email,fresh(secret))).status).toBe(200);
      const c=await api('POST','approval-sessions/close',{token:t,body:{projectId:f.projectId},autoApprove:false});
      expect(c.status).toBe(200);expect(c.json.data.closed).toBe(1);expectConforms('POST','approval-sessions/close',c);
      expect((await prepare(f,t,0,0)).r.status).toBe(202);
      expect(await db.auditLog.count({where:{projectId:f.projectId,action:'OPS_SESSION_CLOSE'}})).toBe(1);
      // Web close by an ADMIN (Khóa phiên ngay) of a reopened session.
      expect((await open(f,t,admin.email,fresh(secret))).status).toBe(200);
      expect(await closeApprovalSession(db,{projectId:f.projectId,tokenId,actorId:admin.id})).toEqual({closed:1});
      expect((await prepare(f,t,1,1)).r.status).toBe(202);
    }finally{await done(f);}
  });
  it('opening again closes the earlier session of the token',async()=>{
    const {f,admin,secret,t,tokenId}=await ready();try{
      const a=await open(f,t,admin.email,fresh(secret)),b=await open(f,t,admin.email,fresh(secret));
      expect(a.status).toBe(200);expect(b.status).toBe(200);
      const rows=await db.opsApprovalSession.findMany({where:{tokenId}});expect(rows.filter(r=>!r.closedAt).map(r=>r.id)).toEqual([b.json.data.sessionId]);
    }finally{await done(f);}
  });
  it('same TOTP step cannot open twice',async()=>{
    const {f,admin,secret,t}=await ready();try{
      const code=fresh(secret);
      expect((await open(f,t,admin.email,code)).status).toBe(200);
      const second=await open(f,t,admin.email,code);expect(second.status).toBe(403);expect(second.text).not.toContain(code);
      expect(await db.opsApprovalSession.count({where:{projectId:f.projectId}})).toBe(1);
    }finally{await done(f);}
  });
  it('a wrong code counts toward the admin lock; a non-admin name burns nothing',async()=>{
    const {f,admin,secret,t}=await ready();try{
      const plain=await db.user.findUniqueOrThrow({where:{id:f.plain}});
      expect((await open(f,t,plain.email,'000000')).status).toBe(403);
      expect((await db.user.findUniqueOrThrow({where:{id:admin.id}})).totpFailedCount).toBe(0);
      for(let i=0;i<3;i++){tick(1000);expect((await open(f,t,admin.email,'000000')).status).toBe(403);}
      const u=await db.user.findUniqueOrThrow({where:{id:admin.id}});expect(u.totpLockedAt).not.toBeNull();
      expect((await open(f,t,admin.email,fresh(secret))).status).toBe(403);
      expect(await db.opsApprovalSession.count({where:{projectId:f.projectId}})).toBe(0);
    }finally{await done(f);}
  });
  it('approveAllPending approves every pending row with one code; stale held actions neither show nor get approved',async()=>{
    const {f,admin,secret,t,tokenId}=await ready();try{
      const p1=await prepare(f,t,0,0),p2=await prepare(f,t,1,1);expect([p1.r.status,p2.r.status]).toEqual([202,202]);
      const stale=await db.opsApproval.create({data:{projectId:f.projectId,tokenId,userId:f.ai,action:'WITHDRAWAL_STATUS',method:'POST',path:'withdrawals/x/status',requestKey:'stale-'+f.x,payloadHash:'h',summary:{},expiresAt:new Date(Date.now()+60000)}});
      expect((await listApprovals(db,f.projectId)).map(r=>r.id)).not.toContain(stale.id);
      expect(await pendingApprovalCount(db,f.projectId)).toBe(2);
      await expect(approveAllPending(db,{projectId:f.projectId,actorId:f.plain,code:fresh(secret)})).rejects.toThrow(/ADMIN/);
      expect(await approveAllPending(db,{projectId:f.projectId,actorId:admin.id,code:fresh(secret)})).toEqual({approved:2});
      expect((await db.opsApproval.findUniqueOrThrow({where:{id:stale.id}})).status).toBe('PENDING');
      expect((await api('POST','withdrawals/prepare',{token:t,key:p1.key,body:p1.body,autoApprove:false})).status).toBe(200);
      expect((await api('POST','withdrawals/prepare',{token:t,key:p2.key,body:p2.body,autoApprove:false})).status).toBe(200);
    }finally{await done(f);}
  });
  it('web open needs the acting ADMIN own code and a token of the project',async()=>{
    const {f,admin,secret,tokenId}=await ready();try{
      await expect(openApprovalSession(db,{projectId:f.projectId,tokenId,admin:'',totp:fresh(secret),via:'WEB',actorId:f.plain})).rejects.toThrow(/ADMIN/);
      await db.projectMember.create({data:{projectId:f.g.scope.projectId,userId:admin.id,role:'ADMIN'}});
      await expect(openApprovalSession(db,{projectId:f.g.scope.projectId,tokenId,admin:'',totp:fresh(secret),via:'WEB',actorId:admin.id})).rejects.toThrow();
      const s=await openApprovalSession(db,{projectId:f.projectId,tokenId,admin:'',totp:fresh(secret),via:'WEB',actorId:admin.id});
      expect(s.approvedPending).toBe(0);expect((await db.opsApprovalSession.findUniqueOrThrow({where:{id:s.sessionId}})).via).toBe('WEB');
    }finally{await done(f);}
  });
});
