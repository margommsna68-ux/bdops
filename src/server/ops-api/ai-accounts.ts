import {Prisma,type AccountLoginType,type PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {decrypt} from '@/lib/encryption';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand} from '../business-management/idempotency';
import {activeVM,checkLink,writeLink} from '../account-store/links';
import {authorizeVM} from '../vm-management/repository';
import {linkSdkForAi} from './sdk-link';
import {ownJob,type OpsCaller} from '../vm-ops/jobs';
import {staleCycle} from '../vm-ops/ops';
import {assertOpsToken} from './context';
import {maskEmail,redactSecrets} from './safety';
// EarnApp account stock for an AI operator (design 23/10/2026 section A, scope ACCOUNT_OPS). Pure services: the API layer wires routes,
// token scope and the ADMIN approval of `credentials`; these functions only check the user's rights (ASSIGN on Server / VM), the
// caller's own ACTIVE job on the VM, the round and revisions, and then go through the SAME writers as the web:
// - hold    = applyLinks' check + write (an EarnAppAccount for the VM; "Đã gán"), the next unused login of the type, oldest import first;
// - used    = markEarnAppRegistered's rule (registeredAt by the token's user), optionally linkVmSdk's body in the same transaction;
// - release = applyLinks with login:null (Bỏ gán), only while the account was never registered.
// States for the AI: UNUSED = an active login (status ACTIVE, not deleted) with no EarnApp account, or one that was released before it
// was ever registered (vmId null, not closed, registeredAt null — the web lists it "Đã dùng" out of caution, the link check still accepts
// it, and only this AI path hands it out again); HELD = on a live VM, not registered; USED = registeredAt set, closed (recreated / SUS
// round) or left on a deleted VM. Blocked / deleted logins are not listed at all. Emails are masked; no secret ever leaves `list`.
type Tx=Prisma.TransactionClient;
export type AiAccountState='UNUSED'|'HELD'|'USED';
export type AiLoginType='GMAIL'|'APPLE'|'APPLE_ID';
const conflict=(message:string,details?:Record<string,unknown>)=>new ProxyDomainError('STALE_PREVIEW',message,'REVISION_CONFLICT',details);
const invalid=(message:string)=>new ProxyDomainError('INVALID_INPUT',message,'VALIDATION');
const loginTypeOf=(t:AiLoginType|undefined):AccountLoginType|undefined=>t===undefined?undefined:t==='APPLE'?'APPLE_ID':t;
const LIMIT_MAX=200;
const stockInclude={batch:{select:{purchasedAt:true}},earnApp:{select:{id:true,vmId:true,revision:true,registeredAt:true,closedAt:true,vm:{select:{id:true,code:true,archivedAt:true,server:{select:{code:true,archivedAt:true}},operation:{select:{cycle:true}}}}}}} as const;
type StockRow=Prisma.GmailAccountGetPayload<{include:typeof stockInclude}>;
function stateOf(g:StockRow):AiAccountState{
  const e=g.earnApp;if(!e)return 'UNUSED';
  if(e.registeredAt||e.closedAt)return 'USED';
  const live=e.vm&&!e.vm.archivedAt&&!e.vm.server.archivedAt;
  if(e.vmId)return live?'HELD':'USED';
  return 'UNUSED';
}
function itemOf(g:StockRow){
  const e=g.earnApp,state=stateOf(g),live=state==='HELD'&&e?.vm?e.vm:null;
  return {id:g.id,accountId:e?.id??null,email:maskEmail(g.email)!,loginType:g.loginType,state,heldBy:live?{vmId:live.id,serverCode:live.server.code,vmCode:live.code,cycle:live.operation?.cycle??1}:null,revision:e?.revision??0,importedAt:g.createdAt.toISOString()};
}
export type AiAccountItem=ReturnType<typeof itemOf>;
/** Opaque cursor = the id of the last item of the previous page (the order is stable, so "after that id" is well defined). */
export async function listAiAccounts(db:PrismaClient|Tx,projectId:string,input:{state?:AiAccountState;type?:AiLoginType;limit?:number;cursor?:string|null}):Promise<{items:AiAccountItem[];nextCursor:string|null}>{
  const limit=Math.min(LIMIT_MAX,Math.max(1,Math.floor(input.limit??50))),type=loginTypeOf(input.type);
  if(input.state&&!['UNUSED','HELD','USED'].includes(input.state))throw invalid('Trạng thái phải là UNUSED, HELD hoặc USED');
  const rows=await db.gmailAccount.findMany({where:{projectId,archivedAt:null,status:'ACTIVE',...(type?{loginType:type}:{})},include:stockInclude,orderBy:[{batch:{purchasedAt:'asc'}},{createdAt:'asc'},{email:'asc'},{id:'asc'}]});
  let list=rows.map(itemOf);if(input.state)list=list.filter(i=>i.state===input.state);
  if(input.cursor){const at=list.findIndex(i=>i.id===input.cursor);if(at<0)throw invalid('Con trỏ trang không còn hợp lệ; đọc lại từ đầu');list=list.slice(at+1);}
  const items=list.slice(0,limit);
  return {items,nextCursor:list.length>limit?items[items.length-1].id:null};
}
/** The next unused login of the type, oldest import first, row-locked so two parallel holds (serialised by the project's command lock
 *  and the serialisable transaction) never pick the same one; null = the stock of that type is empty. */
async function nextUnusedLogin(tx:Tx,projectId:string,loginType:AccountLoginType){
  let rows:{id:string}[];
  try{rows=await tx.$queryRaw<{id:string}[]>`SELECT g."id" FROM "GmailAccount" g LEFT JOIN "AccountPurchaseBatch" b ON b."id"=g."batchId" LEFT JOIN "EarnAppAccount" e ON e."loginId"=g."id"
    WHERE g."projectId"=${projectId} AND g."archivedAt" IS NULL AND g."status"='ACTIVE' AND g."loginType"=${loginType}::"AccountLoginType"
      AND (e."id" IS NULL OR (e."vmId" IS NULL AND e."closedAt" IS NULL AND e."registeredAt" IS NULL))
    ORDER BY b."purchasedAt" ASC NULLS LAST, g."createdAt" ASC, g."email" ASC, g."id" ASC LIMIT 1 FOR UPDATE OF g SKIP LOCKED`;}
  catch(e){
    // A parallel hold just took (and bumped) the first candidate: under the serialisable transaction the row lock reports 40001 through the
    // raw query (Prisma P2010), which withProxyTransaction does not retry by itself; surfaced as the write conflict it is, it retries with a
    // fresh snapshot and this select then skips that login.
    if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2010'&&String((e.meta as {code?:unknown}|undefined)?.code)==='40001')throw new Prisma.PrismaClientKnownRequestError('Serialization failure while picking the next login',{code:'P2034',clientVersion:e.clientVersion,meta:e.meta});
    throw e;
  }
  return rows[0]?.id??null;
}
/** The VM in hand: the caller's own ACTIVE job on it, the round and (optionally) the VM revision as the caller saw them. */
async function vmInHand(tx:Tx,projectId:string,current:ActorScope,caller:OpsCaller,input:{vmId:string;jobId:string;expectedCycle:number;expectedVmRevision?:number}){
  const job=await ownJob(tx,projectId,current.userId,caller,input.jobId,input.vmId);
  const vm=await activeVM(tx,projectId,input.vmId);if(!vm)throw new ProxyDomainError('NOT_FOUND','VM không còn hoạt động trong dự án','NOT_FOUND');
  const ops=await tx.vmOperation.findUnique({where:{vmId:vm.id},select:{cycle:true}}),cycle=ops?.cycle??1;
  if(cycle!==input.expectedCycle||job.cycle!==cycle)throw new ProxyDomainError('STALE_PREVIEW',staleCycle(cycle),'CYCLE_CHANGED');
  if(input.expectedVmRevision!==undefined&&vm.revision!==input.expectedVmRevision)throw conflict('VM vừa được thay đổi (revision '+vm.revision+'); đọc lại VM rồi gửi lại',{vmRevision:vm.revision});
  return {job,vm,cycle};
}
const accountInclude={login:{select:{id:true,email:true,loginType:true}}} as const;
/** The VM's current (open) EarnApp account, which must be the one the caller names. */
async function currentAccount(tx:Tx,projectId:string,vmId:string,accountId:string){
  const e=await tx.earnAppAccount.findFirst({where:{vmId,projectId},include:accountInclude});
  if(!e)throw invalid('VM chưa có tài khoản EarnApp hiện hành');
  if(e.id!==accountId){
    if(!(await tx.earnAppAccount.findFirst({where:{id:accountId,projectId},select:{id:true}})))throw new ProxyDomainError('NOT_FOUND','Không có tài khoản EarnApp này trong dự án','NOT_FOUND');
    throw new ProxyDomainError('STALE_PREVIEW','Tài khoản hiện hành của VM là tài khoản khác ('+maskEmail(e.login.email)+'); đọc lại VM','ACCOUNT_CHANGED',{accountId:e.id});
  }
  if(e.closedAt)throw invalid('Tài khoản EarnApp của VM đã đóng (tạo lại / SUS)');
  return e;
}
async function opsNote(tx:Tx,projectId:string,actorId:string,vmId:string,cycle:number,note:string,caller:OpsCaller,detail:Record<string,unknown>){
  const ev=await tx.vmOpsEvent.create({data:{projectId,vmId,cycle,kind:'NOTE',note:note.slice(0,500),detail:{...detail,...(caller.tokenLabel?{token:caller.tokenLabel}:{})} as Prisma.InputJsonValue,actorId}});
  return ev.id;
}
const accountView=(e:{id:string;revision:number;login:{id:string;email:string;loginType:AccountLoginType|null}})=>({accountId:e.id,loginId:e.login.id,email:maskEmail(e.login.email)!,loginType:e.login.loginType,revision:e.revision});
/**
 * Hold the next unused login of the type for the VM the caller has in hand (AI_ACCOUNT_HOLD). A VM that already has an open EarnApp
 * account gets that account back with already:true and nothing changes. The assignment itself is applyLinks' own check + write.
 */
export async function holdAiAccount(scope:ActorScope,input:{key:string;vmId:string;expectedCycle:number;expectedVmRevision:number;jobId:string;loginType:AiLoginType},db:PrismaClient=prisma,caller:OpsCaller={}){
  const loginType=loginTypeOf(input.loginType);if(!loginType||!['GMAIL','APPLE_ID'].includes(loginType))throw invalid('Loại tài khoản phải là GMAIL hoặc APPLE');
  const payload={vmId:input.vmId,expectedCycle:input.expectedCycle,expectedVmRevision:input.expectedVmRevision,jobId:input.jobId,loginType};
  return runBusinessCommand(scope,{key:input.key,payload,kind:'AI_ACCOUNT_HOLD',module:'INFRASTRUCTURE',reversible:false},async(tx,images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    const {vm,cycle,job}=await vmInHand(tx,scope.projectId,current,caller,input);
    const open=await tx.earnAppAccount.findFirst({where:{vmId:vm.id,projectId:scope.projectId},include:accountInclude});
    if(open){if(open.closedAt)throw invalid('Tài khoản EarnApp của VM đã đóng (tạo lại / SUS); chủ xử lý trước');return {...accountView(open),already:true,vmId:vm.id,cycle,jobId:job.id};}
    const loginId=await nextUnusedLogin(tx,scope.projectId,loginType);
    if(!loginId)throw new ProxyDomainError('NOT_FOUND','Hết tài khoản '+(loginType==='GMAIL'?'Gmail':'Apple ID')+' chưa dùng trong kho','NOT_FOUND');
    const r=await checkLink(tx,scope.projectId,vm,{login:loginId});
    if(!r.ok)throw conflict(r.message);
    if(r.skip||!r.plan?.target)throw conflict('Không gán được tài khoản: '+r.message);
    try{await writeLink(tx,images,scope.projectId,vm,r.plan,current.userId);}catch(e){if((e as {code?:string}).code==='P2002')throw conflict('Tài khoản vừa được cấp cho VM khác; gửi lại');throw e;}
    const held=await tx.earnAppAccount.findFirstOrThrow({where:{vmId:vm.id},include:accountInclude});
    await opsNote(tx,scope.projectId,current.userId,vm.id,cycle,'AI: giữ tài khoản '+maskEmail(held.login.email)+' cho VM (chưa đăng ký EarnApp)',caller,{jobId:job.id,accountId:held.id,loginId:held.login.id});
    return {...accountView(held),already:false,vmId:vm.id,cycle,jobId:job.id};
  },db);
}
/**
 * The full login behind the VM's current EarnApp account, for the caller's ACTIVE job on that VM only. The decryption is the same as
 * copyOperatingCredentials; the PIN / web copy right is replaced by the token scope and the ADMIN approval the API layer enforces before
 * calling this. Audited with ids only.
 */
export async function aiAccountCredentials(scope:ActorScope,input:{vmId:string;jobId:string;accountId:string},db:PrismaClient=prisma,caller:OpsCaller={}){
  return db.$transaction(async tx=>{
    const current=await authorizeVM(scope,'ASSIGN',tx);
    await assertOpsToken(tx,scope);
    const {job,vm}=await (async()=>{const job=await ownJob(tx,scope.projectId,current.userId,caller,input.jobId,input.vmId);const vm=await activeVM(tx,scope.projectId,input.vmId);if(!vm)throw new ProxyDomainError('NOT_FOUND','VM không còn hoạt động trong dự án','NOT_FOUND');return {job,vm};})();
    const operation=await tx.vmOperation.findUnique({where:{vmId:vm.id},select:{cycle:true}});
    if(job.cycle!==(operation?.cycle??1))throw new ProxyDomainError('STALE_PREVIEW',staleCycle(operation?.cycle??1),'CYCLE_CHANGED');
    const e=await currentAccount(tx,scope.projectId,vm.id,input.accountId);
    const g=await tx.gmailAccount.findFirst({where:{id:e.login.id,projectId:scope.projectId,archivedAt:null}});
    if(!g)throw new ProxyDomainError('NOT_FOUND','Tài khoản đăng nhập không còn trong kho','NOT_FOUND');
    let out:{email:string;password:string|null;twoFa:string|null;token:string|null;twoFaLink:string|null;smsLink:string|null;phone:string|null};
    try{out={email:g.email,password:g.password?decrypt(g.password):null,twoFa:g.twoFaCurrent?decrypt(g.twoFaCurrent):null,token:g.token?decrypt(g.token):null,twoFaLink:g.twoFaLink?decrypt(g.twoFaLink):null,smsLink:g.smsLink?decrypt(g.smsLink):null,phone:g.phone};}
    catch{throw invalid('Thông tin đăng nhập cũ cần kiểm tra và ghi lại trên web trước');}
    if(!out.password&&!out.twoFa&&!out.token&&!out.twoFaLink&&!out.smsLink)throw invalid('Tài khoản chưa ghi thông tin đăng nhập');
    await tx.auditLog.create({data:{projectId:scope.projectId,userId:current.userId,action:'AI_ACCOUNT_CREDENTIALS',entity:'EarnAppAccount',entityId:e.id,changes:{accountId:e.id,loginId:g.id,vmId:vm.id,jobId:job.id,...(caller.tokenId?{tokenId:caller.tokenId}:{}),...(caller.tokenLabel?{token:caller.tokenLabel}:{})}}});
    return out;
  });
}
/**
 * The account was really registered / signed in on EarnApp (AI_ACCOUNT_USED): registeredAt by the token's user (markEarnAppRegistered's
 * rule), the evidence as a note in the VM history (secrets redacted), and with `sdkId` the current SDK linked to this account in the
 * same transaction (linkVmSdk's body). Never inferred from money or SDK; replay returns the first answer.
 */
export async function markAiAccountUsed(scope:ActorScope,input:{key:string;vmId:string;expectedCycle:number;jobId:string;accountId:string;expectedRevision:number;sdkId?:string|null;expectedSdkRevision?:number|null;evidence:string},db:PrismaClient=prisma,caller:OpsCaller={}){
  const evidence=(redactSecrets(String(input.evidence??'').trim())??'').slice(0,300);if(!evidence)throw invalid('Ghi căn cứ (đã đăng ký / đăng nhập EarnApp thế nào)');
  if(input.sdkId&&(input.expectedSdkRevision===undefined||input.expectedSdkRevision===null))throw invalid('Gửi expectedSdkRevision cùng sdkId');
  const payload={vmId:input.vmId,expectedCycle:input.expectedCycle,jobId:input.jobId,accountId:input.accountId,expectedRevision:input.expectedRevision,sdkId:input.sdkId??null,expectedSdkRevision:input.sdkId?input.expectedSdkRevision:null,evidence};
  return runBusinessCommand(scope,{key:input.key,payload,kind:'AI_ACCOUNT_USED',module:'INFRASTRUCTURE',reversible:false},async(tx,images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    const {vm,cycle,job}=await vmInHand(tx,scope.projectId,current,caller,input);
    const e=await currentAccount(tx,scope.projectId,vm.id,input.accountId);
    let changed=false;
    if(!e.registeredAt){
      if(e.revision!==input.expectedRevision)throw conflict('Tài khoản vừa được sửa (revision '+e.revision+'); đọc lại',{revision:e.revision});
      await images.remember('EARNAPP',e.id);await tx.earnAppAccount.update({where:{id:e.id},data:{registeredAt:new Date(),registeredById:current.userId,revision:{increment:1}}});changed=true;
    }
    let sdk:{id:string;linkState:string;revision:number;changed:boolean}|null=null;
    if(input.sdkId){
      const r=await linkSdkForAi(tx,images,current,{vmId:vm.id,sdkId:input.sdkId,expectedSdkRevision:input.expectedSdkRevision!,earnAppId:e.id,expectedCycle:cycle});
      const fresh=await tx.sdkRecord.findUniqueOrThrow({where:{id:input.sdkId},select:{id:true,linkState:true,revision:true}});sdk={...fresh,changed:r.changed};
    }
    const noteId=changed?await opsNote(tx,scope.projectId,current.userId,vm.id,cycle,'AI: tài khoản '+maskEmail(e.login.email)+' đã đăng ký EarnApp — '+evidence+(sdk?.changed?' (SDK đã nối)':''),caller,{jobId:job.id,accountId:e.id,loginId:e.login.id,...(sdk?{sdkId:sdk.id}:{})}):null;
    const after=await tx.earnAppAccount.findUniqueOrThrow({where:{id:e.id},include:accountInclude});
    return {...accountView(after),registered:true,changed,noteId,sdk,vmId:vm.id,cycle,jobId:job.id};
  },db);
}
/** Give a never-registered account back to the stock (AI_ACCOUNT_RELEASE): applyLinks' "Bỏ gán" for the VM in hand, with the reason
 *  in the VM history. A registered account is never released ("đã dùng"). */
export async function releaseAiAccount(scope:ActorScope,input:{key:string;vmId:string;expectedCycle:number;jobId:string;accountId:string;expectedRevision:number;reason:string},db:PrismaClient=prisma,caller:OpsCaller={}){
  const reason=(redactSecrets(String(input.reason??'').trim())??'').slice(0,300);if(!reason)throw invalid('Ghi lý do trả tài khoản');
  const payload={vmId:input.vmId,expectedCycle:input.expectedCycle,jobId:input.jobId,accountId:input.accountId,expectedRevision:input.expectedRevision,reason};
  return runBusinessCommand(scope,{key:input.key,payload,kind:'AI_ACCOUNT_RELEASE',module:'INFRASTRUCTURE',reversible:false},async(tx,images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    const {vm,cycle,job}=await vmInHand(tx,scope.projectId,current,caller,input);
    const e=await currentAccount(tx,scope.projectId,vm.id,input.accountId);
    if(e.registeredAt)throw invalid('Tài khoản đã dùng; không trả về kho');
    if(e.revision!==input.expectedRevision)throw conflict('Tài khoản vừa được sửa (revision '+e.revision+'); đọc lại',{revision:e.revision});
    const r=await checkLink(tx,scope.projectId,vm,{login:null});
    if(!r.ok)throw conflict(r.message);
    if(r.skip||!r.plan)throw conflict('Không bỏ gán được: '+r.message);
    await writeLink(tx,images,scope.projectId,vm,r.plan,current.userId);
    const noteId=await opsNote(tx,scope.projectId,current.userId,vm.id,cycle,'AI: trả tài khoản '+maskEmail(e.login.email)+' về kho (chưa đăng ký EarnApp) — '+reason,caller,{jobId:job.id,accountId:e.id,loginId:e.login.id});
    return {released:true,accountId:e.id,loginId:e.login.id,email:maskEmail(e.login.email)!,loginType:e.login.loginType,noteId,vmId:vm.id,cycle,jobId:job.id};
  },db);
}
