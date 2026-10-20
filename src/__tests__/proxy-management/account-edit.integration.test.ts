import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {commitStockImport} from '@/server/account-store/inventory';
import {updateLogin} from '@/server/account-store/edit';
import {readAccountStore} from '@/server/account-store/read';
import {applyLinks} from '@/server/account-store/links';
import {copyOperatingCredentials} from '@/server/business-management/accounts';
import {undoOperation} from '@/server/operation-history/undo';
import {decrypt} from '@/lib/encryption';
afterAll(()=>db.$disconnect());
// Khung chi tiết Gmail / Apple ID (owner brief 20/10/2026). Synthetic accounts only (example.invalid, fake links).
it('Apple ID: import 5 columns → read each field behind the PIN → edit one field → every other field, link, batch and cost unchanged',async()=>{
  const f=await businessFixture();try{
    await db.project.update({where:{id:f.scope.projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
    const x=randomUUID().slice(0,8),a=`edit-${x}@example.invalid`,L2=`https://example.invalid/2fa?id=Ab${x}`,LS=`https://example.invalid/sms/T${x}`;
    await commitStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text:`${a}|Pw:${x}|${L2}|${LS}|0123456789`,batch:{source:'Shop',purchasedAt:'2026-10-20',priceMode:'TOTAL',amount:'5',quantity:1,currency:'USDT',rate:null},key:randomUUID()},db);
    const row0=await db.gmailAccount.findUniqueOrThrow({where:{email:a}}),costs=await db.costRecord.count({where:{projectId:f.scope.projectId,voidedAt:null}});
    await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:f.vm.id,login:row0.id,expectedRevision:(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).revision}]},db);
    const row=await db.gmailAccount.findUniqueOrThrow({where:{email:a}});
    // List: flags only, no secret, no link.
    const list=(await readAccountStore(f.scope,db)).logins.find(l=>l.email===a)!;expect(list).toMatchObject({phone:'0123456789',links:{twoFa:true,sms:true},has:{password:true,twoFa:false,token:false}});expect(JSON.stringify(list)).not.toMatch(/Pw:|example\.invalid\/(2fa|sms)/);
    expect(await copyOperatingCredentials(f.scope,{kind:'GMAIL',id:row.id,pin:'123456'},db)).toMatchObject({email:a,secret:'Pw:'+x,twoFaLink:L2,smsLink:LS,phone:'0123456789'});
    // Edit the phone only; an untouched (masked) password / link is simply not sent and stays.
    const r=await updateLogin(f.scope,{id:row.id,expectedRevision:row.revision,changes:{phone:'+84 900 000 001'},key:randomUUID()},db);expect(r).toMatchObject({changed:true,fields:['Số điện thoại']});
    const after=await db.gmailAccount.findUniqueOrThrow({where:{id:row.id},include:{earnApp:true}});
    expect({phone:after.phone,pw:decrypt(after.password!),l2:decrypt(after.twoFaLink!),ls:decrypt(after.smsLink!),batch:after.batchId,type:after.loginType,vm:after.earnApp?.vmId}).toEqual({phone:'+84 900 000 001',pw:'Pw:'+x,l2:L2,ls:LS,batch:row.batchId,type:'APPLE_ID',vm:f.vm.id});
    expect(await db.costRecord.count({where:{projectId:f.scope.projectId,voidedAt:null}})).toBe(costs);
    // Same value again: nothing written. Empty text is never a clear; null (explicit) clears; email must stay unique; journal holds no secret.
    expect(await updateLogin(f.scope,{id:row.id,expectedRevision:after.revision,changes:{phone:'+84 900 000 001'},key:randomUUID()},db)).toMatchObject({changed:false});
    await expect(updateLogin(f.scope,{id:row.id,expectedRevision:after.revision,changes:{password:''},key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT',message:expect.stringMatching(/Mật khẩu: để trống không phải là xoá/)});
    await expect(updateLogin(f.scope,{id:row.id,expectedRevision:after.revision,changes:{twoFaLink:'ftp://x'},key:randomUUID()},db)).rejects.toMatchObject({message:expect.stringMatching(/Link lấy mã 2FA/)});
    const other=`other-${x}@example.invalid`;await db.gmailAccount.create({data:{projectId:f.scope.projectId,email:other,loginType:'GMAIL',businessManaged:true}});
    await expect(updateLogin(f.scope,{id:row.id,expectedRevision:after.revision,changes:{email:other.toUpperCase()},key:randomUUID()},db)).rejects.toMatchObject({message:expect.stringMatching(/Email đăng nhập: đã có trong kho/)});
    const k=randomUUID(),cleared=await updateLogin(f.scope,{id:row.id,expectedRevision:after.revision,changes:{smsLink:null,password:'New:'+x},key:k},db);expect(cleared.fields).toEqual(['Mật khẩu','Link SMS']);
    const j=await db.operationJournal.findFirstOrThrow({where:{projectId:f.scope.projectId,commandKey:k}});expect(JSON.stringify(j)).not.toContain('New:'+x);
    const c2=await db.gmailAccount.findUniqueOrThrow({where:{id:row.id}});expect(c2.smsLink).toBeNull();expect(decrypt(c2.password!)).toBe('New:'+x);expect(decrypt(c2.twoFaLink!)).toBe(L2);
    // Two people on the same row: the one who read the older revision is refused, nothing overwritten. Undo restores the previous values.
    await expect(updateLogin(f.worker,{id:row.id,expectedRevision:after.revision,changes:{notes:'B'},key:randomUUID()},db)).rejects.toMatchObject({code:'FORBIDDEN'}); // a USER has no stock write right
    await expect(updateLogin(f.scope,{id:row.id,expectedRevision:after.revision,changes:{notes:'cũ'},key:randomUUID()},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    await undoOperation(f.scope,j.id,'',db);const back=await db.gmailAccount.findUniqueOrThrow({where:{id:row.id}});expect(decrypt(back.password!)).toBe('Pw:'+x);expect(decrypt(back.smsLink!)).toBe(LS);
    // Rights to read secrets: the worker (no COPY_CREDENTIALS) is refused.
    await expect(copyOperatingCredentials(f.worker,{kind:'GMAIL',id:row.id,pin:'123456'},db)).rejects.toMatchObject({code:'FORBIDDEN'});
  }finally{await db.operationJournal.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();}
});
