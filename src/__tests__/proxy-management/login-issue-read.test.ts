import {expect,it,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
import {readAccountStore,readVmAccounts} from '@/server/account-store/read';
const scope={projectId:'p',userId:'u',role:'ADMIN' as const,capabilities:[],businessMode:'PROXY_VM'};
vi.mock('@/server/permissions/infrastructure',async importOriginal=>({...await importOriginal<typeof import('@/server/permissions/infrastructure')>(),loadInfrastructureScope:async()=>scope}));
vi.mock('@/server/permissions/server-scope',async importOriginal=>({...await importOriginal<typeof import('@/server/permissions/server-scope')>(),assertUnrestrictedServers:async()=>{},vmWhere:()=>({})}));
const at=new Date('2026-10-24T01:02:03Z');
const login={id:'login',email:'issue@example.invalid',loginType:'GMAIL',status:'GOOGLE_DISABLED',revision:7,loginIssueNote:'Disabled by Google',loginIssueAt:at,archivedAt:null,notes:'keep',createdAt:at,batchId:null,password:'cipher-secret',twoFaCurrent:null,token:null,twoFaLink:null,smsLink:null,phone:null,recoveryEmail:null,_count:{vms:0},earnApp:null};
const gm=vi.fn(async(_input:{select:Record<string,unknown>})=>[login]);
const db={gmailAccount:{findMany:gm},payPalAccount:{findMany:async()=>[]},accountPurchaseBatch:{findMany:async()=>[]},virtualMachine:{findMany:vi.fn(async()=>[])}};
it('account store exposes issue metadata as safe values while lifecycle and secret flags remain separate',async()=>{
 const r=(await readAccountStore(scope,db as unknown as PrismaClient)).logins[0];
 expect(r).toMatchObject({status:'GOOGLE_DISABLED',state:'BLOCKED',loginIssueNote:login.loginIssueNote,loginIssueAt:at.toISOString(),revision:7});expect(JSON.stringify(r)).not.toContain('cipher-secret');
 expect(gm.mock.calls[0][0].select).toMatchObject({loginIssueNote:true,loginIssueAt:true});
});
it('VM login projection exposes issue metadata and its own revision without credential data',async()=>{
 const vmDb={virtualMachine:{findMany:vi.fn(async(_input:{select:{earnApp:{select:{login:{select:Record<string,unknown>}}}}})=>[{id:'vm',gmail:null,earnApp:{id:'earn',revision:4,registeredAt:null,login,paypal:null,paypalEmail:null}}])}};
 const r=(await readVmAccounts(scope,vmDb as unknown as PrismaClient))[0];
 expect(r.earnApp?.login).toMatchObject({id:'login',status:'GOOGLE_DISABLED',revision:7,loginIssueNote:login.loginIssueNote,loginIssueAt:at.toISOString()});expect(JSON.stringify(r)).not.toContain('cipher-secret');
 expect(vmDb.virtualMachine.findMany.mock.calls[0][0].select.earnApp.select.login.select).toMatchObject({loginIssueNote:true,loginIssueAt:true,revision:true});
});
