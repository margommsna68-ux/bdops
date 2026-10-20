import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {businessDB as db,businessFixture} from '../proxy-management/business-fixture';
import {commitStockImport} from '@/server/account-store/inventory';
import {applyLinks} from '@/server/account-store/links';
import {handleOpsRequest} from '@/server/ops-api/api';
import {createOpsToken} from '@/server/ops-api/tokens';
// Shared synthetic setup of the ops API tests (example.invalid, test database only).
export {db};
export const AI_PIN='246810',ADMIN_PIN='123456';
type Call={token?:string|null;pin?:string|null;key?:string|null;body?:unknown;xff?:string};
export async function api(method:'GET'|'POST',path:string,o:Call={}){
  const [p]=path.split('?'),headers:Record<string,string>={'x-forwarded-for':o.xff??'203.0.113.7'};
  if(o.token!==null&&o.token!==undefined)headers.authorization='Bearer '+o.token;
  if(method==='POST'){headers['content-type']='application/json';if(o.pin!==null)headers['x-ops-pin']=o.pin??AI_PIN;if(o.key!==null)headers['idempotency-key']=o.key??randomUUID();}
  const res=await handleOpsRequest(new Request('http://local.invalid/api/ops/v1/'+path,{method,headers,body:method==='POST'?JSON.stringify(o.body??{}):undefined}),p,db);
  const text=await res.text();return {status:res.status,headers:res.headers,text,json:JSON.parse(text) as {ok:boolean;data:any;error:{code:string;message:string;details?:any}|null}};
}
export async function setup(){
  const f=await businessFixture(),x=randomUUID().slice(0,6),projectId=f.scope.projectId,today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
  await db.project.update({where:{id:projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
  const vms=[f.vm];for(let i=2;i<=5;i++)vms.push(await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_00'+i,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}}));
  await commitStockImport(f.scope,{kind:'PAYPAL',text:[`pp-82 ${[1,2,3].map(n=>`p82-${n}-${x}@example.invalid`).join(' ')}`,`pp-60 p60-1-${x}@example.invalid p60-2-${x}@example.invalid`].join('\n'),batch:{purchasedAt:today,priceMode:'NONE'},key:randomUUID()},db);
  await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:Array.from({length:8},(_,i)=>`ops${i+1}-${x}@example.invalid|Secret-pw-${x}`).join('\n'),batch:{purchasedAt:today,priceMode:'NONE'},key:randomUUID()},db);
  const logins=await db.gmailAccount.findMany({where:{projectId},orderBy:{email:'asc'}});
  for(const [i,vm] of vms.entries()){const v=await db.virtualMachine.findUniqueOrThrow({where:{id:vm.id}});await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:v.id,expectedRevision:v.revision,login:logins[i].id}]},db);}
  const pp=async(code:string)=>db.payPalAccount.findFirstOrThrow({where:{projectId,code},include:{emails:{orderBy:{email:'asc'}}}});
  // Members: ai (USER + Server / VM + the three narrow rights), plain (USER + Server / VM only), viewer.
  const pw=await bcrypt.hash('Local-pw-'+x,4),pin=await bcrypt.hash(AI_PIN,4),users:string[]=[];
  const member=async(role:'USER'|'VIEWER',caps:string[])=>{const id=randomUUID();users.push(id);await db.user.create({data:{id,email:id+'@fixture.invalid',username:'ops-'+id.slice(0,8),password:pw,pin}});await db.projectMember.create({data:{projectId,userId:id,role,allowedModules:['INFRASTRUCTURE'],capabilities:caps}});return id;};
  const ai=await member('USER',['EARN_BALANCE','EARN_PAYOUT','PAYPAL_RECEIPT_RECORD']),ai2=await member('USER',['EARN_PAYOUT']),plain=await member('USER',[]),viewer=await member('VIEWER',[]);
  const g=await businessFixture();await db.project.update({where:{id:g.scope.projectId},data:{settings:{businessMode:'PROXY_VM'}}});await db.projectMember.create({data:{projectId:g.scope.projectId,userId:ai,role:'USER',allowedModules:['INFRASTRUCTURE'],capabilities:['EARN_BALANCE']}});
  const token=async(userId:string,scopes:('READ'|'BALANCE_WRITE'|'PAYOUT'|'RECEIPT')[],extra:Partial<Parameters<typeof createOpsToken>[1]>={})=>(await createOpsToken(f.scope.userId,{projectId,userId,name:'test',scopes,expiresInDays:30,pin:ADMIN_PIN,...extra},db)).token;
  const vmNow=async(i:number)=>{const v=await db.virtualMachine.findUniqueOrThrow({where:{id:vms[i].id},include:{earnApp:true,operation:true}});return {id:v.id,revision:v.revision,cycle:v.operation?.cycle??1,earnAppId:v.earnApp!.id};};
  const cleanup=async()=>{
    for(const p of [projectId,g.scope.projectId]){await db.earnBalanceCheck.deleteMany({where:{projectId:p}});await db.operationJournal.deleteMany({where:{projectId:p}});await db.vmOpsEvent.deleteMany({where:{projectId:p}});}
    await db.opsToken.deleteMany({where:{userId:{in:users}}});await db.opsAudit.deleteMany({where:{userId:{in:users}}});await db.projectMember.deleteMany({where:{userId:{in:users}}});
    await f.cleanup();await g.cleanup();await db.auditLog.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});
  };
  return {...f,g,x,projectId,today,vms,logins,pp,ai,ai2,plain,viewer,token,vmNow,cleanup};
}
export type F=Awaited<ReturnType<typeof setup>>;
export const balanceBody=async(f:F,i:number,o:Record<string,unknown>={})=>{const v=await f.vmNow(i);return {projectId:f.projectId,expectedVmRevision:v.revision,expectedCycle:v.cycle,earnAppAccountId:v.earnAppId,status:'OK',amount:'10.00',currency:'USD',withdrawable:null,checkedAt:new Date().toISOString(),...o};};
export const prepareBody=async(f:F,i:number,emailId:string,o:Record<string,unknown>={})=>{const v=await f.vmNow(i);return {projectId:f.projectId,vmId:v.id,expectedVmRevision:v.revision,expectedCycle:v.cycle,earnAppAccountId:v.earnAppId,paypalEmailId:emailId,amount:'10.00',currency:'USD',requestedAt:new Date().toISOString(),...o};};
export const statusBody=async(f:F,i:number,w:{id:string;revision:number},o:Record<string,unknown>={})=>{const v=await f.vmNow(i);return {projectId:f.projectId,vmId:v.id,expectedVmRevision:v.revision,expectedCycle:v.cycle,earnAppAccountId:v.earnAppId,expectedRequestRevision:w.revision,status:'SUBMITTED_ON_EARNAPP',evidenceNote:'Thấy trong lịch sử rút EarnApp',observedAt:new Date().toISOString(),...o};};
export const reqRev=async(id:string)=>(await db.earnPayoutRequest.findUniqueOrThrow({where:{id}})).revision;

