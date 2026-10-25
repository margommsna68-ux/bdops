import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {testClient} from './db-fixture';
import {encrypt} from '@/lib/encryption';
import {copyOperatingCredentials} from '@/server/business-management/accounts';
import {readAccountStore} from '@/server/account-store/read';
import {assertScopedLoginIds} from '@/server/permissions/server-scope';
import type {ActorScope} from '@/server/proxy-management/types';
import type {Prisma} from '@prisma/client';

// DB suite deliberately separate from scoped-human-accounts.test.ts; parent runs this when the test DB is ready.
const db=testClient();afterAll(()=>db.$disconnect());
async function fixture(){
 const projectId=randomUUID(),foreignId=randomUUID(),userId=randomUUID(),adminId=randomUUID();
 await db.project.createMany({data:[{id:projectId,code:projectId,name:'Scoped human fixture',settings:{businessMode:'PROXY_VM'}},{id:foreignId,code:foreignId,name:'Foreign human fixture',settings:{businessMode:'PROXY_VM'}}]});
 await db.user.create({data:{id:userId,email:userId+'@example.invalid',pin:await bcrypt.hash('731294',4)}});
 await db.user.create({data:{id:adminId,email:adminId+'@example.invalid',pin:await bcrypt.hash('846215',4)}});
 await db.projectMember.create({data:{projectId,userId:adminId,role:'ADMIN'}});
 const a=await db.server.create({data:{projectId,code:'Allowed',managed:true}}),b=await db.server.create({data:{projectId,code:'Hidden',managed:true}});
 const member=await db.projectMember.create({data:{userId,projectId,role:'MODERATOR',allowedModules:['INFRASTRUCTURE'],capabilities:['COPY_CREDENTIALS'],serverScope:'SELECTED',allowedServerIds:[a.id]}});
 const vm=async(serverId=a.id)=>db.virtualMachine.create({data:{serverId,code:randomUUID(),managed:true}});
 const login=async(overrides:Partial<Prisma.GmailAccountUncheckedCreateInput>={})=>db.gmailAccount.create({data:{projectId,email:randomUUID()+'@example.invalid',loginType:'GMAIL',password:encrypt('synthetic-own-secret'),...overrides}});
 const scope:ActorScope={projectId,userId,role:'MODERATOR',allowedModules:['INFRASTRUCTURE'],capabilities:['COPY_CREDENTIALS']};
 const cleanup=async()=>{
  await db.auditLog.deleteMany({where:{projectId:{in:[projectId,foreignId]}}});
  await db.earnAppAccount.deleteMany({where:{projectId:{in:[projectId,foreignId]}}});
  await db.virtualMachine.deleteMany({where:{server:{projectId:{in:[projectId,foreignId]}}}});await db.server.deleteMany({where:{projectId:{in:[projectId,foreignId]}}});
  await db.gmailAccount.deleteMany({where:{projectId:{in:[projectId,foreignId]}}});await db.payPalEmail.deleteMany({where:{projectId}});await db.payPalAccount.deleteMany({where:{projectId}});
  await db.projectMember.deleteMany({where:{userId:{in:[userId,adminId]}}});await db.project.deleteMany({where:{id:{in:[projectId,foreignId]}}});await db.user.deleteMany({where:{id:{in:[userId,adminId]}}});
 };
 return {projectId,foreignId,userId,adminId,a,b,member,vm,login,scope,cleanup};
}
describe('human moderator own factor and current server-bound login secrets',()=>{
 it('reveals assigned Gmail and Apple with the moderator own PIN, while projecting no shared PayPal or purchase data',async()=>{
  const f=await fixture();try{
   const pp=await db.payPalAccount.create({data:{projectId:f.projectId,code:'SHARED',primaryEmail:'hidden-primary@example.invalid',password:encrypt('hidden-pp-secret')}});
   const emails=await Promise.all(['allowed','hidden'].map(prefix=>db.payPalEmail.create({data:{projectId:f.projectId,paypalId:pp.id,email:prefix+'@example.invalid',isPrimary:prefix==='hidden',password:encrypt('hidden-email-secret')}})));
   const allowed=await f.login(),hidden=await f.login(),apple=await f.login({loginType:'APPLE_ID',twoFaLink:encrypt('https://example.invalid/private-code')});
   const va=await f.vm(),vb=await f.vm(f.b.id),appleVm=await f.vm();
   await db.earnAppAccount.create({data:{projectId:f.projectId,loginId:allowed.id,vmId:va.id,paypalId:pp.id,paypalEmailId:emails[0].id}});
   await db.earnAppAccount.create({data:{projectId:f.projectId,loginId:hidden.id,vmId:vb.id,paypalId:pp.id,paypalEmailId:emails[1].id}});
   await db.earnAppAccount.create({data:{projectId:f.projectId,loginId:apple.id,vmId:appleVm.id}});
   const view=await readAccountStore(f.scope,db);expect(view.logins.map(l=>l.id).sort()).toEqual([allowed.id,apple.id].sort());
   expect(view.paypals).toEqual([]);expect(view.batches).toEqual([]);expect(view.review).toEqual([]);expect(JSON.stringify(view)).not.toContain('hidden-primary');expect(JSON.stringify(view)).not.toContain('SHARED');
   // A different ADMIN's PIN cannot unlock this moderator's reveal or consume the ADMIN's failure counter.
   await expect(copyOperatingCredentials(f.scope,{kind:'GMAIL',id:allowed.id,pin:'846215'},db)).rejects.toMatchObject({code:'FORBIDDEN'});
   expect((await db.user.findUniqueOrThrow({where:{id:f.userId}})).pinFailedCount).toBe(1);
   expect((await db.user.findUniqueOrThrow({where:{id:f.adminId}})).pinFailedCount).toBe(0);
   expect(await copyOperatingCredentials(f.scope,{kind:'GMAIL',id:allowed.id,pin:'731294'},db)).toMatchObject({secret:'synthetic-own-secret'});
   expect(await copyOperatingCredentials(f.scope,{kind:'GMAIL',id:apple.id,pin:'731294'},db)).toMatchObject({twoFaLink:'https://example.invalid/private-code'});
   const foreign=await f.login({projectId:f.foreignId}),foreignServer=await db.server.create({data:{projectId:f.foreignId,code:'Foreign',managed:true}}),foreignVm=await f.vm(foreignServer.id);
   await db.earnAppAccount.create({data:{projectId:f.foreignId,loginId:foreign.id,vmId:foreignVm.id}});
   for(const id of [hidden.id,(await f.login()).id,foreign.id])await expect(copyOperatingCredentials(f.scope,{kind:'GMAIL',id,pin:'wrong'},db)).rejects.toMatchObject({code:'NOT_FOUND'});
   await expect(copyOperatingCredentials(f.scope,{kind:'PAYPAL',id:pp.id,pin:'wrong'},db)).rejects.toMatchObject({code:'FORBIDDEN'});
   expect((await db.user.findUniqueOrThrow({where:{id:f.userId}})).pinFailedCount).toBe(0);
  }finally{await f.cleanup();}
 });
 it('permits current legacy-only binding but denies cross-server pointers, new EarnApp ownership, closed/archived rows and moved accounts',async()=>{
  const f=await fixture();try{
   const legacy=await f.login({loginType:null}),va=await f.vm(),vb=await f.vm(f.b.id);
   await db.virtualMachine.update({where:{id:va.id},data:{gmailId:legacy.id}});
   await expect(assertScopedLoginIds(db,f.scope,[legacy.id])).resolves.toBeUndefined();
   expect((await readAccountStore(f.scope,db)).logins.map(l=>l.id)).toContain(legacy.id);
   expect((await readAccountStore(f.scope,db)).logins.find(l=>l.id===legacy.id)?.type).toBeNull();
   expect(await copyOperatingCredentials(f.scope,{kind:'GMAIL',id:legacy.id,pin:'731294'},db)).toMatchObject({secret:'synthetic-own-secret'});
   await db.virtualMachine.update({where:{id:vb.id},data:{gmailId:legacy.id}});
   await expect(assertScopedLoginIds(db,f.scope,[legacy.id])).rejects.toMatchObject({code:'NOT_FOUND'});
   expect((await readAccountStore(f.scope,db)).logins).toEqual([]);
   await db.virtualMachine.update({where:{id:vb.id},data:{gmailId:null}});
   const replacement=await f.login(),ea=await db.earnAppAccount.create({data:{projectId:f.projectId,loginId:replacement.id,vmId:va.id}});
   await expect(assertScopedLoginIds(db,f.scope,[legacy.id])).rejects.toMatchObject({code:'NOT_FOUND'});
   // Canonical A binding does not override an active legacy pointer on hidden server B.
   await db.virtualMachine.update({where:{id:vb.id},data:{gmailId:replacement.id}});
   await expect(assertScopedLoginIds(db,f.scope,[replacement.id])).rejects.toMatchObject({code:'NOT_FOUND'});
   await db.virtualMachine.update({where:{id:vb.id},data:{gmailId:null}});
   await db.earnAppAccount.update({where:{id:ea.id},data:{vmId:vb.id}});
   await expect(copyOperatingCredentials(f.scope,{kind:'GMAIL',id:replacement.id,pin:'wrong'},db)).rejects.toMatchObject({code:'NOT_FOUND'});
   await db.earnAppAccount.update({where:{id:ea.id},data:{vmId:va.id,closedAt:new Date()}});
   await expect(assertScopedLoginIds(db,f.scope,[replacement.id])).rejects.toMatchObject({code:'NOT_FOUND'});
   await db.earnAppAccount.update({where:{id:ea.id},data:{closedAt:null}});await db.server.update({where:{id:f.a.id},data:{archivedAt:new Date()}});
   await expect(assertScopedLoginIds(db,f.scope,[replacement.id])).rejects.toMatchObject({code:'NOT_FOUND'});
   await db.server.update({where:{id:f.a.id},data:{archivedAt:null}});await db.gmailAccount.update({where:{id:replacement.id},data:{archivedAt:new Date()}});
   await expect(assertScopedLoginIds(db,f.scope,[replacement.id])).rejects.toMatchObject({code:'NOT_FOUND'});
   await db.projectMember.update({where:{id:f.member.id},data:{allowedServerIds:[]}});
   expect((await readAccountStore(f.scope,db)).logins).toEqual([]);
   expect((await db.user.findUniqueOrThrow({where:{id:f.userId}})).pinFailedCount).toBe(0);
  }finally{await f.cleanup();}
 });
});
