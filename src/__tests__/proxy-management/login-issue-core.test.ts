import {beforeEach,expect,it,vi} from 'vitest';
import type {Prisma,PrismaClient} from '@prisma/client';
import {applyLoginIssue,setStockStatus} from '@/server/account-store/inventory';
import {readBusinessImage,restoreBusinessImage} from '@/server/business-management/operation-images';
import type {BusinessImage} from '@/server/business-management/types';
const mocks=vi.hoisted(()=>({remember:vi.fn(),rows:new Map<string,Record<string,unknown>>()}));
vi.mock('@/server/business-management/idempotency',()=>({runBusinessCommand:async(scope:unknown,_input:unknown,fn:(tx:unknown,images:{remember:typeof mocks.remember},scope:unknown)=>Promise<unknown>)=>fn(tx,{remember:mocks.remember},scope)}));
const scope={projectId:'p',userId:'u',role:'ADMIN' as const,capabilities:[],businessMode:'PROXY_VM'};
const tx={gmailAccount:{findFirst:vi.fn(async({where}:{where:{id:string;projectId:string;archivedAt?:null}})=>{const row=mocks.rows.get(where.id);return row&&row.projectId===where.projectId&&(where.archivedAt===undefined||!row.archivedAt)?{...row}:null;}),update:vi.fn(async({where,data}:{where:{id:string};data:Record<string,unknown>})=>{const old=mocks.rows.get(where.id)!;const row={...old,...data,revision:typeof data.revision==='object'?Number(old.revision)+1:old.revision};mocks.rows.set(where.id,row);return row;})}};
const db=tx as unknown as PrismaClient;
const transaction=tx as unknown as Prisma.TransactionClient;
const row=(id='g',loginType:string|null='GMAIL')=>({id,projectId:'p',loginType,status:'ACTIVE',revision:2,archivedAt:null,loginIssueNote:null,loginIssueAt:null,notes:'normal note',email:id+'@fixture.invalid'});
beforeEach(()=>{vi.clearAllMocks();mocks.rows.clear();mocks.rows.set('g',row());mocks.rows.set('a',row('a','APPLE_ID'));});
it('writes a cleaned issue note and server timestamp without changing account links or normal notes',async()=>{
 const start=Date.now();const updated=await applyLoginIssue(transaction,{projectId:'p',id:'g',expectedRevision:2,status:'GOOGLE_VERIFY',note:'  Need a phone\r\nchallenge  '});
 expect(updated).toMatchObject({status:'GOOGLE_VERIFY',loginIssueNote:'Need a phone\nchallenge',revision:3,notes:'normal note'});
 expect(updated.loginIssueAt).toBeInstanceOf(Date);expect(updated.loginIssueAt!.getTime()).toBeGreaterThanOrEqual(start);
 expect(Object.keys(tx.gmailAccount.update.mock.calls[0][0].data).sort()).toEqual(['loginIssueAt','loginIssueNote','revision','status']);
});
it('rejects wrong type, unknown type, archived, foreign, and stale rows without writing',async()=>{
 for(const [id,status] of [['g','APPLE_LOCKED'],['a','GOOGLE_DISABLED']] as const)await expect(applyLoginIssue(transaction,{projectId:'p',id,expectedRevision:2,status})).rejects.toMatchObject({code:'INVALID_INPUT'});
 mocks.rows.set('missing-type',row('missing-type',null));await expect(applyLoginIssue(transaction,{projectId:'p',id:'missing-type',expectedRevision:2,status:'GOOGLE_VERIFY'})).rejects.toMatchObject({code:'INVALID_INPUT'});
 mocks.rows.set('gone',{...row('gone'),archivedAt:new Date()});
 for(const id of ['gone','missing'])await expect(applyLoginIssue(transaction,{projectId:'p',id,expectedRevision:2,status:'GOOGLE_VERIFY'})).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(applyLoginIssue(transaction,{projectId:'foreign',id:'g',expectedRevision:2,status:'GOOGLE_VERIFY'})).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(applyLoginIssue(transaction,{projectId:'p',id:'g',expectedRevision:1,status:'GOOGLE_VERIFY'})).rejects.toMatchObject({code:'STALE_PREVIEW'});
 expect(tx.gmailAccount.update).not.toHaveBeenCalled();
});
it('defaults empty issue notes and preserves time/revision for an unchanged repeat',async()=>{
 const first=await applyLoginIssue(transaction,{projectId:'p',id:'a',expectedRevision:2,status:'APPLE_LOCKED',note:'   '});expect(first.loginIssueNote).toBeTruthy();
 tx.gmailAccount.update.mockClear();const second=await applyLoginIssue(transaction,{projectId:'p',id:'a',expectedRevision:3,status:'APPLE_LOCKED'});
 expect(second).toMatchObject({revision:3,loginIssueNote:first.loginIssueNote,loginIssueAt:first.loginIssueAt});expect(tx.gmailAccount.update).not.toHaveBeenCalled();
 await applyLoginIssue(transaction,{projectId:'p',id:'a',expectedRevision:3,status:'APPLE_LOCKED',note:'new reason'});expect(tx.gmailAccount.update).toHaveBeenCalledOnce();
});
it('validates note limits before any update',async()=>{
 await expect(applyLoginIssue(transaction,{projectId:'p',id:'g',expectedRevision:2,status:'GOOGLE_VERIFY',note:'x'.repeat(2001)})).rejects.toMatchObject({code:'INVALID_INPUT'});expect(tx.gmailAccount.update).not.toHaveBeenCalled();
});
it('bulk status reports mismatched types per row while applying valid rows, without changing lifecycle links',async()=>{
 const result=await setStockStatus(scope,{kind:'LOGIN',items:[{id:'g',expectedRevision:2},{id:'a',expectedRevision:2}],status:'APPLE_LOCKED',issueNote:'locked by provider',key:'issue-key-1'},db);
 expect(result.rows).toEqual([{id:'g',outcome:'ERROR',message:expect.any(String)},{id:'a',outcome:'APPLIED',message:expect.any(String)}]);expect(result.applied).toBe(1);
 expect(mocks.rows.get('g')).toMatchObject({status:'ACTIVE',revision:2});expect(mocks.rows.get('a')).toMatchObject({status:'APPLE_LOCKED',loginIssueNote:'locked by provider'});expect(mocks.remember).toHaveBeenCalledWith('GMAIL','a');
});
it('same status is SKIP unless issueNote explicitly changes; ACTIVE clears issue metadata',async()=>{
 const at=new Date('2026-10-24T00:00:00Z');mocks.rows.set('g',{...row(),status:'GOOGLE_VERIFY',loginIssueNote:'keep',loginIssueAt:at});
 const input={kind:'LOGIN' as const,items:[{id:'g',expectedRevision:2}],status:'GOOGLE_VERIFY',key:'issue-key-2'};
 expect((await setStockStatus(scope,input,db)).rows[0].outcome).toBe('SKIP');
 expect((await setStockStatus(scope,{...input,issueNote:' keep '},db)).rows[0].outcome).toBe('SKIP');
 expect((await setStockStatus(scope,{...input,issueNote:'changed'},db)).rows[0].outcome).toBe('APPLIED');
 expect((await setStockStatus(scope,{...input,items:[{id:'g',expectedRevision:3}],status:'ACTIVE'},db)).rows[0].outcome).toBe('APPLIED');
 expect(mocks.rows.get('g')).toMatchObject({status:'ACTIVE',loginIssueNote:null,loginIssueAt:null,revision:4});
});
it('captures new issue metadata and restores it as Date; legacy images leave absent fields untouched',async()=>{
 const at=new Date('2026-10-24T00:00:00Z');mocks.rows.set('g',{...row(),status:'GOOGLE_VERIFY',loginIssueNote:'verify',loginIssueAt:at});
 const before=await readBusinessImage(db,'p','GMAIL','g');expect(before).toMatchObject({loginIssueNote:'verify',loginIssueAt:at.toISOString()});
 await restoreBusinessImage(transaction,'p',{resource:'GMAIL',id:'g',before,after:{...before!,status:'ACTIVE',loginIssueNote:null,loginIssueAt:null}} as BusinessImage);
 expect(tx.gmailAccount.update.mock.calls[0][0].data).toMatchObject({loginIssueNote:'verify',loginIssueAt:at});
 tx.gmailAccount.update.mockClear();await restoreBusinessImage(transaction,'p',{resource:'GMAIL',id:'g',before:{status:'ACTIVE',revision:1},after:{status:'BLOCKED',revision:2}});
 expect(tx.gmailAccount.update.mock.calls[0][0].data).not.toHaveProperty('loginIssueNote');expect(tx.gmailAccount.update.mock.calls[0][0].data).not.toHaveProperty('loginIssueAt');
});
