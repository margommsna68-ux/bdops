import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
import {readAccountStore} from '@/server/account-store/read';
import {assertScopedLoginIds,scopedLoginWhere} from '@/server/permissions/server-scope';
import {assertServerWebRequest} from '@/server/permissions/server-web-policy';
import {copyOperatingCredentials} from '@/server/business-management/accounts';
import type {ActorScope} from '@/server/proxy-management/types';

const mocks=vi.hoisted(()=>({load:vi.fn(),factor:vi.fn()}));
vi.mock('@/server/permissions/infrastructure',async importOriginal=>({...await importOriginal<object>(),loadInfrastructureScope:mocks.load}));
vi.mock('@/server/business-management/pin',()=>({verifyBusinessPin:mocks.factor}));
const actor:ActorScope={userId:'mod',projectId:'p',role:'MODERATOR',allowedModules:['INFRASTRUCTURE'],capabilities:['COPY_CREDENTIALS'],businessMode:'PROXY_VM',serverIds:['a']};
const vm={id:'vm-a',code:'VM_001',archivedAt:null,server:{id:'a',code:'A'}};
const login={id:'login-a',email:'apple@example.invalid',loginType:'APPLE_ID',status:'APPLE_LOCKED',loginIssueNote:'Locked',loginIssueAt:new Date('2026-10-25T00:00:00Z'),notes:'Local note',recoveryEmail:null,phone:null,revision:2,createdAt:new Date('2026-10-24T00:00:00Z'),archivedAt:null,password:'cipher-never-return',twoFaCurrent:null,token:null,twoFaLink:'link-cipher-never-return',smsLink:null,earnApp:{id:'ea-a',revision:1,registeredAt:null,vm},vms:[]};
function fixture(){
 const tx={gmailAccount:{findMany:vi.fn(async(_query:unknown)=>[login]),findFirst:vi.fn(async()=>null)},payPalAccount:{findMany:vi.fn(),findFirst:vi.fn()},accountPurchaseBatch:{findMany:vi.fn()},virtualMachine:{findMany:vi.fn()},projectMember:{findUnique:vi.fn(async()=>({serverScope:'SELECTED'})),findFirst:vi.fn()},auditLog:{create:vi.fn()}};
 const db={...tx,$transaction:vi.fn(async fn=>fn(tx))} as unknown as PrismaClient;
 return {db,tx};
}
beforeEach(()=>{vi.clearAllMocks();mocks.load.mockResolvedValue(actor);});
describe('human selected-server login projection and route boundary (no database)',()=>{
 it('returns only login metadata with neutral purchase/PayPal fields and no writes',async()=>{
  const f=fixture(),r=await readAccountStore(actor,f.db);
  expect(r.logins).toHaveLength(1);expect(r.logins[0]).toMatchObject({id:'login-a',place:{serverId:'a',vmId:'vm-a'},batch:null,batchId:null,price:null,priceState:'NONE',earnApp:{id:'ea-a',paypal:null}});
  expect(r.paypals).toEqual([]);expect(r.batches).toEqual([]);expect(r.review).toEqual([]);
  expect(r.rights).toMatchObject({logins:true,paypals:false,admin:false,writeLogins:false,writePaypals:false,money:false,writeCosts:false,copy:true});
  expect(JSON.stringify(r)).not.toContain('cipher-never-return');expect(f.tx.payPalAccount.findMany).not.toHaveBeenCalled();expect(f.tx.accountPurchaseBatch.findMany).not.toHaveBeenCalled();
  expect(f.tx.gmailAccount.findMany.mock.calls[0][0]).toMatchObject({where:scopedLoginWhere(actor)});
 });
 it('returns an empty deleted view without querying stock',async()=>{const f=fixture();expect((await readAccountStore(actor,f.db,{deleted:true})).logins).toEqual([]);expect(f.tx.gmailAccount.findMany).not.toHaveBeenCalled();});
 it('does not hide a valid current legacy binding merely because its historical provider type is null',()=>{expect(scopedLoginWhere(actor)).not.toHaveProperty('loginType');});
 it.each(['USER','VIEWER'])('does not open the human stock projection for %s',async role=>{const f=fixture();mocks.load.mockResolvedValue({...actor,role});await expect(readAccountStore(actor,f.db)).rejects.toMatchObject({code:'FORBIDDEN'});expect(f.tx.gmailAccount.findMany).not.toHaveBeenCalled();});
 it('allows only store and GMAIL secret reads as new scoped surfaces',async()=>{
  const f=fixture();await expect(assertServerWebRequest(f.db,'mod','accountStore.store',{projectId:'p'})).resolves.toBeUndefined();
  await expect(assertServerWebRequest(f.db,'mod','businessManagement.copyAccount',{projectId:'p',kind:'GMAIL',id:'login-a'})).resolves.toBeUndefined();
  for(const path of ['accountStore.updateLogin','accountStore.setStatus','accountStore.importPreview','accountStore.ledger','businessManagement.accounts','businessManagement.saveAccount'])await expect(assertServerWebRequest(f.db,'mod',path,{projectId:'p'})).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(assertServerWebRequest(f.db,'mod','businessManagement.copyAccount',{projectId:'p',kind:'PAYPAL',id:'shared-pp'})).rejects.toMatchObject({code:'FORBIDDEN'});
 });
 it('resolves the exact target against fresh membership, not actor-supplied grants',async()=>{
  const f=fixture();f.tx.gmailAccount.findMany.mockResolvedValue([]);mocks.load.mockResolvedValue({...actor,serverIds:[]});
  await expect(assertScopedLoginIds(f.db,{...actor,serverIds:['forged']},['login-a'])).rejects.toMatchObject({code:'NOT_FOUND'});
  expect(f.tx.gmailAccount.findMany.mock.calls[0][0]).toMatchObject({where:{AND:[{id:{in:['login-a']}},scopedLoginWhere({...actor,serverIds:[]})]}});
 });
 it.each([{kind:'GMAIL' as const,id:'hidden-login',code:'NOT_FOUND'},{kind:'PAYPAL' as const,id:'shared-pp',code:'FORBIDDEN'}])('denies $kind outside the login boundary before checking a wrong factor',async input=>{
  const f=fixture();f.tx.gmailAccount.findMany.mockResolvedValue([]);
  await expect(copyOperatingCredentials(actor,{kind:input.kind,id:input.id,pin:'wrong'},f.db)).rejects.toMatchObject({code:input.code});
  expect(mocks.factor).not.toHaveBeenCalled();expect(f.tx.auditLog.create).not.toHaveBeenCalled();
 });
 it('rechecks the binding after factor verification and before decrypting',async()=>{
  const f=fixture();mocks.factor.mockImplementationOnce(async()=>{f.tx.gmailAccount.findMany.mockResolvedValue([]);});
  await expect(copyOperatingCredentials(actor,{kind:'GMAIL',id:'login-a',pin:'own-factor'},f.db)).rejects.toMatchObject({code:'NOT_FOUND'});
  expect(mocks.factor).toHaveBeenCalledWith(f.db,'mod','own-factor');expect(f.tx.gmailAccount.findFirst).not.toHaveBeenCalled();expect(f.tx.auditLog.create).not.toHaveBeenCalled();
 });
});
