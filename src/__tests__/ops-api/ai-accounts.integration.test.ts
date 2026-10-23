import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {businessDB as db,businessFixture} from '../proxy-management/business-fixture';
import {commitStockImport} from '@/server/account-store/inventory';
import {applyLinks} from '@/server/account-store/links';
import {addManagedVMs} from '@/server/vm-management/metadata';
import {claimVmJob,type OpsCaller} from '@/server/vm-ops/jobs';
import {createOpsToken,hashToken} from '@/server/ops-api/tokens';
import {runWithOpsAuth} from '@/server/ops-api/context';
import {ProxyDomainError} from '@/server/proxy-management/types';
import {aiAccountCredentials,holdAiAccount,listAiAccounts,markAiAccountUsed,releaseAiAccount} from '@/server/ops-api/ai-accounts';
afterAll(()=>db.$disconnect());
// EarnApp account stock for an AI operator (design 23/10/2026 section A). The machine and EarnApp are SIMULATED: these tests check what
// MoneyToHome hands out, records and refuses. Synthetic logins (example.invalid), test database only. No secret is ever printed.
// Own setup (not ops-fixture: that one imports the HTTP layer, which is being wired separately): project, 5 VMs each holding a Gmail login,
// 3 unused Gmail logins, 2 Apple IDs, an AI member (USER + Server / VM) and a token of that member (VM_OPS).
async function setup(){
  const f=await businessFixture(),x=randomUUID().slice(0,6),projectId=f.scope.projectId,today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
  await db.project.update({where:{id:projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
  const vms=[f.vm];for(let i=2;i<=5;i++)vms.push(await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_00'+i,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}}));
  await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:Array.from({length:8},(_,i)=>`ops${i+1}-${x}@example.invalid|Secret-pw-${x}`).join('\n'),batch:{purchasedAt:today,priceMode:'NONE'},key:randomUUID()},db);
  const logins=await db.gmailAccount.findMany({where:{projectId},orderBy:{email:'asc'}});
  for(const [i,vm] of vms.entries()){const v=await db.virtualMachine.findUniqueOrThrow({where:{id:vm.id}});await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:v.id,expectedRevision:v.revision,login:logins[i].id}]},db);}
  const ai=randomUUID();await db.user.create({data:{id:ai,email:ai+'@fixture.invalid',username:'ops-'+ai.slice(0,8),password:await bcrypt.hash('Local-pw-'+x,4),pin:await bcrypt.hash('246810',4)}});
  await db.projectMember.create({data:{projectId,userId:ai,role:'USER',allowedModules:['INFRASTRUCTURE'],capabilities:[]}});
  const cleanup=async()=>{await db.operationJournal.deleteMany({where:{projectId}});await db.vmOpsEvent.deleteMany({where:{projectId}});await db.opsToken.deleteMany({where:{userId:ai}});await db.opsAudit.deleteMany({where:{userId:ai}});await db.projectMember.deleteMany({where:{userId:ai}});await f.cleanup();await db.auditLog.deleteMany({where:{userId:ai}});await db.user.deleteMany({where:{id:ai}});};
  return {...f,x,projectId,today,vms,logins,ai,cleanup};
}
async function stock(){
  const f=await setup(),P=f.projectId;
  // Three Gmail logins of the fixture are still unused (ops6..ops8); add two Apple IDs with their links / phone.
  await commitStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text:[`apple1-${f.x}@example.invalid|Apple-pw-1-${f.x}|https://2fa.example.invalid/a1|https://sms.example.invalid/a1|0901000001`,`apple2-${f.x}@example.invalid|Apple-pw-2-${f.x}|https://2fa.example.invalid/a2|https://sms.example.invalid/a2|0901000002`].join('\n'),batch:{purchasedAt:f.today,priceMode:'NONE'},key:randomUUID()},db);
  const made=await createOpsToken(f.scope.userId,{projectId:P,userId:f.ai,name:'ai-accounts',scopes:['READ','VM_OPS'],expiresInDays:30,pin:'123456'},db);
  const tokenRow=await db.opsToken.findFirstOrThrow({where:{tokenHash:hashToken(made.token!)}});
  const caller:OpsCaller={tokenId:tokenRow.id,tokenLabel:'ai-accounts (test)'},other:OpsCaller={tokenId:null,tokenLabel:null};
  const scope={...f.scope,userId:f.ai,role:'USER' as const,capabilities:[]};
  const asAi=<T>(fn:()=>Promise<T>)=>runWithOpsAuth({tokenId:tokenRow.id,userId:f.ai,operation:'VM_OPS'},fn);
  /** A VM added on the web (New VM) with the AI's own ACTIVE PREPARE job on it. */
  const vmWithJob=async(code:string,c:OpsCaller=caller)=>{
    await addManagedVMs(f.scope,f.server.id,[code],db);const v=await db.virtualMachine.findFirstOrThrow({where:{serverId:f.server.id,code}});
    const job=await claimVmJob(scope,{key:randomUUID(),vmId:v.id,expectedCycle:1,kind:'PREPARE'},db,c);
    return {id:v.id,revision:(await db.virtualMachine.findUniqueOrThrow({where:{id:v.id}})).revision,jobId:job.job.id};
  };
  const vmRev=async(id:string)=>(await db.virtualMachine.findUniqueOrThrow({where:{id}})).revision;
  const hold=(v:{id:string;jobId:string},o:Record<string,unknown>={})=>asAi(async()=>holdAiAccount(scope,{key:(o.key as string)??randomUUID(),vmId:v.id,expectedCycle:1,expectedVmRevision:await vmRev(v.id),jobId:v.jobId,loginType:'GMAIL',...o} as never,db,caller));
  const fails=async(p:Promise<unknown>)=>{try{await p;}catch(e){return e as ProxyDomainError;}throw new Error('expected a refusal');};
  const cleanup=async()=>{await db.vmJob.deleteMany({where:{projectId:P}});await db.auditLog.deleteMany({where:{projectId:P}});await f.cleanup();};
  return {...f,P,scope,caller,other,asAi,vmWithJob,vmRev,hold,fails,cleanup};
}
type S=Awaited<ReturnType<typeof stock>>;
const unusedGmail=async(s:S)=>(await listAiAccounts(db,s.P,{state:'UNUSED',type:'GMAIL',limit:50})).items;

describe('AI EarnApp account stock: list',()=>{
  it('masks every email, shows state / holder / revision and never carries a secret',async()=>{
    const s=await stock();try{
      const all=await listAiAccounts(db,s.P,{limit:50});
      expect(all.items.length).toBe(10);expect(all.nextCursor).toBeNull();
      const text=JSON.stringify(all);
      expect(text).not.toMatch(/Secret-pw|Apple-pw|2fa\.example|sms\.example|0901000/);expect(text).not.toMatch(/password|twoFa|smsLink|phone/);
      for(const i of all.items)expect(i.email).toMatch(/^[^@]{1,2}\*\*\*@example\.invalid$/);
      const held=all.items.filter(i=>i.state==='HELD'),unused=all.items.filter(i=>i.state==='UNUSED');
      expect(held.length).toBe(5);expect(unused.length).toBe(5);
      expect(held[0]).toMatchObject({accountId:expect.any(String),loginType:'GMAIL',heldBy:{vmId:s.vms[0].id,serverCode:s.server.code,vmCode:'VM_001',cycle:1},revision:expect.any(Number)});
      expect(unused[0]).toMatchObject({accountId:null,heldBy:null,revision:0});
      // Filters and paging (stable order: oldest import first, then id).
      expect((await listAiAccounts(db,s.P,{type:'APPLE',limit:50})).items.map(i=>i.loginType)).toEqual(['APPLE_ID','APPLE_ID']);
      const p1=await listAiAccounts(db,s.P,{limit:4}),p2=await listAiAccounts(db,s.P,{limit:50,cursor:p1.nextCursor!});
      expect(p1.items.length).toBe(4);expect(p1.nextCursor).toBeTruthy();expect(p2.items.length).toBe(6);
      expect(new Set([...p1.items,...p2.items].map(i=>i.id)).size).toBe(10);
      expect((await listAiAccounts(db,s.P,{state:'USED',limit:50})).items).toEqual([]);
    }finally{await s.cleanup();}
  });
});

describe('hold: the next unused login of the type for the VM in hand',()=>{
  it('takes the oldest unused login; a second hold on the same VM returns the same account with already:true',async()=>{
    const s=await stock();try{
      const v=await s.vmWithJob('AI_H01'),before=await unusedGmail(s);expect(before.length).toBe(3);
      const r=await s.hold(v);
      expect(r).toMatchObject({already:false,loginId:before[0].id,loginType:'GMAIL',email:before[0].email,revision:expect.any(Number),accountId:expect.any(String)});
      expect(JSON.stringify(r)).not.toMatch(/Secret-pw/);
      const row=await db.earnAppAccount.findUniqueOrThrow({where:{id:r.accountId}});expect(row).toMatchObject({vmId:v.id,loginId:before[0].id,registeredAt:null});
      const again=await s.hold(v);expect(again).toMatchObject({already:true,accountId:r.accountId,loginId:before[0].id});
      expect((await unusedGmail(s)).length).toBe(2);
      // Apple ID on another VM: the first Apple login, Gmail stock untouched.
      const w=await s.vmWithJob('AI_H02'),apple=await s.hold(w,{loginType:'APPLE'});
      expect(apple).toMatchObject({already:false,loginType:'APPLE_ID'});expect((await unusedGmail(s)).length).toBe(2);
      // Replay by key: the first answer, nothing written twice.
      const key=randomUUID(),z=await s.vmWithJob('AI_H03'),rev=await s.vmRev(z.id),h1=await s.hold(z,{key,expectedVmRevision:rev}),h2=await s.hold(z,{key,expectedVmRevision:rev});
      // The same key with another request (the revision moved on) is refused, never answered from the journal.
      expect((await s.fails(s.hold(z,{key}))).code).toBe('KEY_PAYLOAD_MISMATCH');
      expect(h2).toMatchObject({accountId:h1.accountId,loginId:h1.loginId,already:false,replay:true});
      expect(await db.earnAppAccount.count({where:{vmId:z.id}})).toBe(1);
    }finally{await s.cleanup();}
  });
  it('two parallel holds on two VMs get two different logins',async()=>{
    const s=await stock();try{
      const a=await s.vmWithJob('AI_P01'),b=await s.vmWithJob('AI_P02');
      const [ra,rb]=await Promise.all([s.hold(a),s.hold(b)]);
      expect(ra.loginId).not.toBe(rb.loginId);expect(ra.accountId).not.toBe(rb.accountId);
      expect((await unusedGmail(s)).length).toBe(1);
      expect(await db.earnAppAccount.count({where:{loginId:{in:[ra.loginId,rb.loginId]}}})).toBe(2);
    }finally{await s.cleanup();}
  });
  it('is refused without an own ACTIVE job, on a wrong round or a wrong VM revision; nothing written',async()=>{
    const s=await stock();try{
      const v=await s.vmWithJob('AI_R01');
      // Another token's job.
      const o=await s.vmWithJob('AI_R02',s.other);
      expect((await s.fails(s.hold(o))).code).toBe('FORBIDDEN');
      // Job released / expired.
      await db.vmJob.update({where:{id:o.jobId},data:{claimedById:s.ai,tokenId:s.caller.tokenId,expiresAt:new Date(Date.now()-1000)}});
      const e1=await s.fails(s.hold(o));expect(e1.code).toBe('STALE_PREVIEW');expect(e1.reason).toBe('REVISION_CONFLICT');
      // Wrong round.
      const e2=await s.fails(s.hold(v,{expectedCycle:2}));expect(e2.code).toBe('STALE_PREVIEW');expect(e2.reason).toBe('CYCLE_CHANGED');
      // Wrong VM revision.
      const e3=await s.fails(s.hold(v,{expectedVmRevision:(await s.vmRev(v.id))+1}));expect(e3.code).toBe('STALE_PREVIEW');expect(e3.reason).toBe('REVISION_CONFLICT');
      // Job of another VM.
      const e4=await s.fails(s.hold({id:v.id,jobId:o.jobId}));expect(['INVALID_INPUT','STALE_PREVIEW']).toContain(e4.code);
      expect(await db.earnAppAccount.count({where:{vmId:{in:[v.id,o.id]}}})).toBe(0);expect((await unusedGmail(s)).length).toBe(3);
    }finally{await s.cleanup();}
  });
});

describe('credentials: the real secret of the held account only, audited without it',()=>{
  it('returns password / 2FA links / phone for the VM\'s current account under this token\'s job; refuses anything else',async()=>{
    const s=await stock();try{
      const v=await s.vmWithJob('AI_C01'),h=await s.hold(v,{loginType:'APPLE'});
      const c=await s.asAi(()=>aiAccountCredentials(s.scope,{vmId:v.id,jobId:v.jobId,accountId:h.accountId},db,s.caller));
      expect(c).toMatchObject({email:expect.stringMatching(/^apple[12]-.*@example\.invalid$/),password:expect.stringMatching(/^Apple-pw-[12]-/),twoFaLink:expect.stringMatching(/^https:\/\/2fa\.example\.invalid\//),smsLink:expect.stringMatching(/^https:\/\/sms\.example\.invalid\//),phone:expect.stringMatching(/^0901000/)});
      expect(Object.keys(c).sort()).toEqual(['email','password','phone','smsLink','token','twoFa','twoFaLink']);
      const audit=await db.auditLog.findFirstOrThrow({where:{projectId:s.P,action:'AI_ACCOUNT_CREDENTIALS'}});
      expect(JSON.stringify(audit.changes)).not.toMatch(/Apple-pw|2fa\.example|sms\.example|0901000|@example/);
      expect(audit.changes).toMatchObject({accountId:h.accountId,loginId:h.loginId,vmId:v.id,jobId:v.jobId});
      // Another account of the project (held by VM_001 in setup) is never handed out through this job.
      const foreign=await db.earnAppAccount.findUniqueOrThrow({where:{vmId:s.vms[0].id}});
      const e1=await s.fails(s.asAi(()=>aiAccountCredentials(s.scope,{vmId:v.id,jobId:v.jobId,accountId:foreign.id},db,s.caller)));expect(['NOT_FOUND','INVALID_INPUT','STALE_PREVIEW']).toContain(e1.code);
      const e2=await s.fails(s.asAi(()=>aiAccountCredentials(s.scope,{vmId:s.vms[0].id,jobId:v.jobId,accountId:foreign.id},db,s.caller)));expect(['INVALID_INPUT','FORBIDDEN']).toContain(e2.code);
      // Another token: refused.
      const e3=await s.fails(aiAccountCredentials(s.scope,{vmId:v.id,jobId:v.jobId,accountId:h.accountId},db,s.other));expect(e3.code).toBe('FORBIDDEN');
      expect(await db.auditLog.count({where:{projectId:s.P,action:'AI_ACCOUNT_CREDENTIALS'}})).toBe(1);
    }finally{await s.cleanup();}
  });
});

describe('used: registeredAt by the token, evidence in the VM history, SDK linked in the same command',()=>{
  it('marks the account used, links the current SDK, refuses a wrong revision, replays by key',async()=>{
    const s=await stock();try{
      const v=await s.vmWithJob('AI_U01'),h=await s.hold(v);
      const sdk=await db.sdkRecord.create({data:{projectId:s.P,code:'AISDK-'+s.x+'-00000001',vmId:v.id,holderVmId:v.id,linkState:'UNLINKED',createdById:s.scope.userId}});
      const bad=await s.fails(s.asAi(async()=>markAiAccountUsed(s.scope,{key:randomUUID(),vmId:v.id,expectedCycle:1,jobId:v.jobId,accountId:h.accountId,expectedRevision:h.revision+5,evidence:'x'},db,s.caller)));
      expect(bad.code).toBe('STALE_PREVIEW');expect(bad.reason).toBe('REVISION_CONFLICT');
      expect((await db.earnAppAccount.findUniqueOrThrow({where:{id:h.accountId}})).registeredAt).toBeNull();
      const key=randomUUID(),input={key,vmId:v.id,expectedCycle:1,jobId:v.jobId,accountId:h.accountId,expectedRevision:h.revision,sdkId:sdk.id,expectedSdkRevision:sdk.revision,evidence:'Đăng ký EarnApp xong, dashboard hiện thiết bị; password: abc123'};
      const r=await s.asAi(()=>markAiAccountUsed(s.scope,input,db,s.caller));
      expect(r).toMatchObject({changed:true,accountId:h.accountId,registered:true,sdk:{id:sdk.id,linkState:'LINKED',changed:true}});
      const acc=await db.earnAppAccount.findUniqueOrThrow({where:{id:h.accountId}});expect(acc.registeredAt).toBeTruthy();expect(acc.registeredById).toBe(s.ai);
      expect(await db.sdkRecord.findUniqueOrThrow({where:{id:sdk.id}})).toMatchObject({linkState:'LINKED',linkedEarnAppId:h.accountId,linkedVmId:v.id,linkedCycle:1});
      const note=await db.vmOpsEvent.findFirstOrThrow({where:{vmId:v.id,kind:'NOTE',note:{contains:'đã đăng ký'}}});
      expect(note.note).toMatch(/AI: tài khoản .*\*\*\*@example\.invalid đã đăng ký EarnApp/);expect(note.note).not.toMatch(/abc123/);expect(note.detail).toMatchObject({jobId:v.jobId,accountId:h.accountId});
      expect((await listAiAccounts(db,s.P,{state:'USED',limit:50})).items.map(i=>i.accountId)).toEqual([h.accountId]);
      // Replay: same answer, no second note.
      const again=await s.asAi(()=>markAiAccountUsed(s.scope,input,db,s.caller));expect(again).toMatchObject({changed:true,replay:true,accountId:h.accountId});
      expect(await db.vmOpsEvent.count({where:{vmId:v.id,kind:'NOTE',note:{contains:'đã đăng ký'}}})).toBe(1);
      // A used account is never released.
      const rel=await s.fails(s.asAi(()=>releaseAiAccount(s.scope,{key:randomUUID(),vmId:v.id,expectedCycle:1,jobId:v.jobId,accountId:h.accountId,expectedRevision:acc.revision,reason:'nhầm'},db,s.caller)));
      expect(rel.code).toBe('INVALID_INPUT');expect(rel.message).toMatch(/đã dùng/);
      expect((await db.earnAppAccount.findUniqueOrThrow({where:{id:h.accountId}})).vmId).toBe(v.id);
    }finally{await s.cleanup();}
  });
});

describe('release: an unused account goes back to the stock',()=>{
  it('unassigns the held account with a note; the login is UNUSED again and the next hold takes it first; wrong account / revision refused',async()=>{
    const s=await stock();try{
      const v=await s.vmWithJob('AI_L01'),h=await s.hold(v);expect((await unusedGmail(s)).length).toBe(2);
      const wrong=await s.fails(s.asAi(()=>releaseAiAccount(s.scope,{key:randomUUID(),vmId:v.id,expectedCycle:1,jobId:v.jobId,accountId:'nope',expectedRevision:h.revision,reason:'x'},db,s.caller)));
      expect(wrong.code).toBe('NOT_FOUND');
      const stale=await s.fails(s.asAi(()=>releaseAiAccount(s.scope,{key:randomUUID(),vmId:v.id,expectedCycle:1,jobId:v.jobId,accountId:h.accountId,expectedRevision:h.revision+1,reason:'x'},db,s.caller)));
      expect(stale.code).toBe('STALE_PREVIEW');expect(stale.reason).toBe('REVISION_CONFLICT');
      const key=randomUUID(),r=await s.asAi(()=>releaseAiAccount(s.scope,{key,vmId:v.id,expectedCycle:1,jobId:v.jobId,accountId:h.accountId,expectedRevision:h.revision,reason:'Đăng ký EarnApp thất bại: tài khoản bị khoá'},db,s.caller));
      expect(r).toMatchObject({released:true,accountId:h.accountId,loginId:h.loginId});
      expect((await db.earnAppAccount.findUniqueOrThrow({where:{id:h.accountId}})).vmId).toBeNull();
      const note=await db.vmOpsEvent.findFirstOrThrow({where:{vmId:v.id,kind:'NOTE',note:{contains:'trả tài khoản'}}});expect(note.note).toMatch(/về kho.*bị khoá/);
      const unused=await unusedGmail(s);expect(unused.length).toBe(3);expect(unused.map(i=>i.id)).toContain(h.loginId);
      // Replay returns the first answer; a second real release is a no-op on a VM without account.
      expect(await s.asAi(()=>releaseAiAccount(s.scope,{key,vmId:v.id,expectedCycle:1,jobId:v.jobId,accountId:h.accountId,expectedRevision:h.revision,reason:'Đăng ký EarnApp thất bại: tài khoản bị khoá'},db,s.caller))).toMatchObject({released:true,replay:true});
      // The released login is offered again (oldest first) and reuses its EarnApp row.
      const w=await s.vmWithJob('AI_L02'),h2=await s.hold(w);expect(h2.loginId).toBe(h.loginId);expect(h2.accountId).toBe(h.accountId);
      expect((await db.earnAppAccount.findUniqueOrThrow({where:{id:h.accountId}})).vmId).toBe(w.id);
    }finally{await s.cleanup();}
  });
});
