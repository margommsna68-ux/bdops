import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {commitStockImport,setStockNote} from '@/server/account-store/inventory';
import {readAccountStore} from '@/server/account-store/read';
import {listOperations} from '@/server/operation-history/journal';
afterAll(()=>db.$disconnect());
// Owner brief 20/10/2026: the note of a Gmail / Apple ID is edited in its cell. Only the note changes; revision, rights and history
// stay; a retry of the same save writes once.
it('saves only the note of one login account, checks the revision, keeps line breaks and writes once per key',async()=>{
  const f=await businessFixture();try{
    await db.project.update({where:{id:f.scope.projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
    const email=`note-${randomUUID().slice(0,8)}@example.invalid`;
    await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:`${email}|pw-x`,batch:{purchasedAt:'2026-10-20',priceMode:'NONE'},key:randomUUID()},db);
    const before=await db.gmailAccount.findFirstOrThrow({where:{email}});
    const key=randomUUID(),text='Dòng 1\nDòng 2 rất dài '+'x'.repeat(300);
    const r=await setStockNote(f.scope,{id:before.id,expectedRevision:before.revision,notes:text,key},db);
    expect(r).toMatchObject({changed:true,notes:text,revision:before.revision+1});
    const after=await db.gmailAccount.findUniqueOrThrow({where:{id:before.id}});
    expect(after).toMatchObject({notes:text,password:before.password,status:before.status,batchId:before.batchId});
    expect(await setStockNote(f.scope,{id:before.id,expectedRevision:before.revision,notes:text,key},db)).toMatchObject({replay:true});
    expect((await db.gmailAccount.findUniqueOrThrow({where:{id:before.id}})).revision).toBe(before.revision+1);
    // Same text again = nothing written; an old revision is refused with the text kept by the caller.
    expect(await setStockNote(f.scope,{id:before.id,expectedRevision:after.revision,notes:text,key:randomUUID()},db)).toMatchObject({changed:false});
    await expect(setStockNote(f.scope,{id:before.id,expectedRevision:before.revision,notes:'khác',key:randomUUID()},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    // Clearing is explicit (empty text = no note); too long is refused.
    expect(await setStockNote(f.scope,{id:before.id,expectedRevision:after.revision,notes:'   ',key:randomUUID()},db)).toMatchObject({changed:true,notes:null});
    await expect(setStockNote(f.scope,{id:before.id,expectedRevision:after.revision+1,notes:'y'.repeat(2001),key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect((await readAccountStore(f.scope,db)).logins.find(l=>l.id===before.id)).toMatchObject({notes:null,revision:after.revision+1});
    expect((await listOperations(f.scope,db)).some(o=>o.kind==='ACCOUNT_STOCK_NOTE')).toBe(true);
  }finally{await f.cleanup();}
});
