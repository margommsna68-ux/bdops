import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {previewStockImport,commitStockImport} from '@/server/account-store/inventory';
import {readAccountStore} from '@/server/account-store/read';
import {copyOperatingCredentials} from '@/server/business-management/accounts';
import {decrypt} from '@/lib/encryption';
afterAll(()=>db.$disconnect());
// Apple ID lists as bought (owner brief 20/10/2026): Email | Mật khẩu | Link lấy 2FA | Link SMS | Số điện thoại. Synthetic data only.
const u=()=>randomUUID().slice(0,8);
it('imports the five-column Apple ID list: each field stored in its own place, links and phone verbatim, secrets encrypted',async()=>{
  const f=await businessFixture();try{
    await db.project.update({where:{id:f.scope.projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
    const x=u(),a=`apple-${x}@example.invalid`,g=`apple-${x}@gmail.com`,link2=`https://example.invalid/2fa?id=AbC${x}&x=%2F`,sms=`https://example.invalid/sms/Tok${x}`;
    const text=[`${a}|Pass:Word!${x}|${link2}|${sms}|0123456789`,`${g}\tpw2\t\thttps://example.invalid/sms/B\t+84 912 345 678`,`bad-${x}@example.invalid|pw|ftp://x`,`${a}|again|${link2}|${sms}|1`].join('\n');
    const batch={source:'Shop X',purchasedAt:'2026-10-20',priceMode:'TOTAL' as const,amount:'10',quantity:2,currency:'USDT',rate:null};
    const p=await previewStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text,batch},db);
    expect(p.rows.map(r=>[r.line,r.outcome])).toEqual([[1,'READY'],[2,'READY'],[3,'ERROR'],[4,'ERROR']]);
    expect(p.rows[0]).toMatchObject({hasPassword:true,has2faLink:true,hasSmsLink:true,hasPhone:true});expect(p.rows[2].message).toMatch(/Link lấy 2FA/);
    // Nothing of the secrets or links in the preview rows.
    expect(JSON.stringify(p)).not.toMatch(/Pass:Word|example\.invalid\/2fa|Tok/);
    const key=randomUUID(),done=await commitStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text,batch,key},db);
    expect(done).toMatchObject({applied:2,errors:2});
    const row=await db.gmailAccount.findUniqueOrThrow({where:{email:a}});
    expect(row.loginType).toBe('APPLE_ID');expect(row.phone).toBe('0123456789');expect(row.recoveryEmail).toBeNull();expect(row.notes).toBeNull();expect(row.twoFaCurrent).toBeNull();
    expect(row.password).not.toBe('Pass:Word!'+x);expect(decrypt(row.password!)).toBe('Pass:Word!'+x);
    expect(row.twoFaLink).not.toBe(link2);expect(decrypt(row.twoFaLink!)).toBe(link2);expect(decrypt(row.smsLink!)).toBe(sms);
    const gm=await db.gmailAccount.findUniqueOrThrow({where:{email:g}});expect(gm.loginType).toBe('APPLE_ID');expect(gm.phone).toBe('+84 912 345 678');expect(gm.twoFaLink).toBeNull();expect(decrypt(gm.smsLink!)).toBe('https://example.invalid/sms/B');
    // The stock lists phone and which links exist, never the links; the journal holds digests only.
    const store=await readAccountStore(f.scope,db),l=store.logins.find(r=>r.email===a)!;
    expect(l).toMatchObject({type:'APPLE_ID',phone:'0123456789',links:{twoFa:true,sms:true},credentialsAvailable:true});expect(JSON.stringify(store)).not.toMatch(/example\.invalid\/2fa|Tok/);
    const j=await db.operationJournal.findFirstOrThrow({where:{projectId:f.scope.projectId,commandKey:key}});expect(JSON.stringify(j)).not.toMatch(/Pass:Word|Tok/);
    // A retry replays; a second import of the same list adds no copy, no cost; an existing account keeps its password / links / phone.
    expect(await commitStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text,batch,key},db)).toMatchObject({replay:true,applied:2});
    const again=await previewStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text:`${a}|other|https://example.invalid/new|https://example.invalid/new2|999`,batch},db);
    expect(again.rows[0]).toMatchObject({outcome:'EXISTS'});expect(await db.costRecord.count({where:{projectId:f.scope.projectId,voidedAt:null}})).toBe(1);
    expect(decrypt((await db.gmailAccount.findUniqueOrThrow({where:{email:a}})).twoFaLink!)).toBe(link2);
    // Links are fetched only with the copy right and the PIN; a worker without COPY_CREDENTIALS is refused.
    const copied=await copyOperatingCredentials(f.scope,{kind:'GMAIL',id:row.id,pin:'123456'},db);
    expect(copied).toMatchObject({secret:'Pass:Word!'+x,twoFaLink:link2,smsLink:sms,phone:'0123456789'});
    await expect(copyOperatingCredentials(f.worker,{kind:'GMAIL',id:row.id,pin:'123456'},db)).rejects.toMatchObject({code:'FORBIDDEN'});
    // Gmail keeps the classic pattern (": " columns, recovery email), and APPLE5 is refused for Gmail.
    const gtext=`gm-${x}@example.invalid:pwg:TOTP:rec-${x}@example.invalid`;
    const gp=await previewStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:gtext,batch},db);expect(gp.rows[0]).toMatchObject({outcome:'READY',has2fa:true,hasRecovery:true});
    await expect(previewStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',loginFormat:'APPLE5',text:gtext,batch},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    // The classic pattern stays available for Apple ID as the secondary option.
    const cp=await previewStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',loginFormat:'STANDARD',text:`cl-${x}@example.invalid|pw|2FA|rec-${x}@example.invalid|ghi chú`,batch},db);expect(cp.rows[0]).toMatchObject({outcome:'READY',has2fa:true,hasRecovery:true});
  }finally{await db.operationJournal.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();}
});
