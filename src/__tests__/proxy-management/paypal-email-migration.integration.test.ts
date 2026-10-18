import {afterAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {readAccountStore} from '@/server/account-store/read';
afterAll(()=>db.$disconnect());
// The data step of migration 20261018120000_paypal_email_usage, run again on synthetic old-style rows (test database only).
// Each statement only fills empty fields, so running it again leaves already migrated rows as they are.
const sql=readFileSync('prisma/migrations/20261018120000_paypal_email_usage/migration.sql','utf8');
const dataStep=sql.slice(sql.indexOf('-- Data:')).split(/;\s*\n/).map(s=>s.replace(/^\s*--.*$/gm,'').trim()).filter(Boolean);
it('moves an old PayPal link to an email only when the PayPal has exactly one email; otherwise keeps the link and holds the emails',async()=>{
  const f=await businessFixture();try{
    const p=f.scope.projectId,x=randomUUID().slice(0,6),vm2=await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_002',managed:true,proxySlotState:'BLANK'}});
    const login=(n:number)=>db.gmailAccount.create({data:{projectId:p,email:`old${n}-${x}@example.invalid`,loginType:'GMAIL',status:'ACTIVE',businessManaged:true}});
    const pp=(code:string,emails:string[],extra:Record<string,unknown>={})=>db.payPalAccount.create({data:{projectId:p,code,primaryEmail:emails[0],businessManaged:true,...extra,emails:{create:emails.map((email,i)=>({projectId:p,email,isPrimary:i===0}))}}});
    const one=await pp('old-1-'+x,[`one-${x}@example.invalid`]),two=await pp('old-2-'+x,[`two-a-${x}@example.invalid`,`two-b-${x}@example.invalid`]);
    const [l1,l2,l3]=await Promise.all([login(1),login(2),login(3)]);
    const a1=await db.earnAppAccount.create({data:{projectId:p,loginId:l1.id,vmId:f.vm.id,paypalId:one.id}}),a2=await db.earnAppAccount.create({data:{projectId:p,loginId:l2.id,vmId:vm2.id,paypalId:two.id}});
    const a3=await db.earnAppAccount.create({data:{projectId:p,loginId:l3.id}});
    const past=await pp('old-3-'+x,[`three-${x}@example.invalid`],{firstEarnAppId:a3.id});
    for(const s of dataStep)await db.$executeRawUnsafe(s);
    const e1=await db.payPalEmail.findFirstOrThrow({where:{paypalId:one.id}});
    expect((await db.earnAppAccount.findUniqueOrThrow({where:{id:a1.id}})).paypalEmailId).toBe(e1.id);expect(e1).toMatchObject({usedEarnAppId:a1.id,reviewHold:false});
    // Two emails: which one the old account used is not known → link kept on the PayPal, both emails held, nothing guessed.
    expect(await db.earnAppAccount.findUniqueOrThrow({where:{id:a2.id}})).toMatchObject({paypalId:two.id,paypalEmailId:null});
    expect((await db.payPalEmail.findMany({where:{paypalId:two.id}})).map(e=>[e.reviewHold,e.usedEarnAppId])).toEqual([[true,null],[true,null]]);
    // Received before (firstEarnAppId) with one email: that email is used, never offered again.
    expect((await db.payPalEmail.findFirstOrThrow({where:{paypalId:past.id}})).usedEarnAppId).toBe(a3.id);
    // History rows for current links; the store shows the unknown-email link and the holds under Cần đối chiếu.
    expect(await db.earnAppPayout.count({where:{earnAppId:{in:[a1.id,a2.id]}}})).toBe(2);
    const store=await readAccountStore(f.scope,db),row=store.paypals.find(r=>r.id===two.id)!;
    expect(row.counts).toMatchObject({HOLD:2,NEW:0});expect(row.unknownLinks).toHaveLength(1);
    expect(store.review.filter(r=>r.kind==='PAYPAL_EMAIL_HOLD')).toHaveLength(2);expect(store.review.some(r=>r.kind==='PAYPAL_LINK_NO_EMAIL')).toBe(true);
    // Running the data step again changes nothing (no second history row).
    for(const s of dataStep.filter(s=>!s.startsWith('INSERT')))await db.$executeRawUnsafe(s);
    expect(await db.earnAppPayout.count({where:{earnAppId:{in:[a1.id,a2.id]}}})).toBe(2);
  }finally{await f.cleanup();}
});
