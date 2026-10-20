// LOCAL trial only: Apple ID import (five columns) and Xoá khỏi kho / Khôi phục for Gmail / Apple ID, PayPal and proxies, by real
// clicks in several sessions (A = ADMIN proxy-trial, M = MODERATOR p29-mod, D = ADMIN p29-adm demoted mid-way, V = viewer from p28,
// O = ADMIN of another project). Every check reads the saved data (.runtime/p29-local-probe.ts). Synthetic data only. Screenshots only.
const {chromium}=require('playwright-core');const fs=require('fs');const path=require('path');const {execSync}=require('child_process');
const base='http://localhost:3010',pass=fs.readFileSync(path.join(__dirname,'.demo-pass'),'utf8').trim(),TRIAL='Proxy & VM — Bản thử';
const I=JSON.parse(fs.readFileSync(path.join(__dirname,'..','p29-info.json'),'utf8')),P28=JSON.parse(fs.readFileSync(path.join(__dirname,'..','p28-info.json'),'utf8')),T=I.tag,SV=I.serverCode;
const app='C:/Users/TUNTUN/Desktop/project web new/bdops-proxy-app';
const probe=()=>JSON.parse(execSync('npx tsx --env-file=.env .runtime/p29-local-probe.ts',{cwd:app,encoding:'utf8',env:{...process.env,TAG:T,IPS:[1,2,3,4].map(n=>I.ips['ip'+n]).join(',')}}).trim().split('\n').pop());
const shots=path.join(__dirname,'shots-p29');fs.mkdirSync(shots,{recursive:true});
const out=[];const log=m=>{out.push(m);console.log(m);fs.writeFileSync(path.join(shots,'result-local.txt'),out.join('\n'));};let ok_=0,fail=0;
const check=(c,ok,d='')=>{ok?ok_++:fail++;log((ok?'PASS ':'FAIL ')+c+(d?' — '+d:''));};
(async()=>{
  const b=await chromium.launch({channel:'chrome',headless:true});const errs=[];
  async function session(user,password){
    const ctx=await b.newContext({viewport:{width:1280,height:860}}),page=await ctx.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errs.push(user+': '+String(e)));
    await page.goto(base+'/login');await page.fill('input[type="text"]',user);await page.fill('input[type="password"]',password);await page.click('button[type="submit"]');await page.waitForURL(u=>!String(u).includes('/login'),{timeout:180000});
    await page.goto(base+'/dashboard');const pin=page.locator('input[placeholder="Enter PIN"]');try{await pin.waitFor({timeout:5000});await pin.fill('123456');await page.getByRole('button',{name:'Unlock'}).click();}catch{}
    await page.waitForTimeout(1500);if(await page.getByRole('heading',{name:'Chọn dự án'}).count()){const t=page.getByText(TRIAL,{exact:true}).first();if(await t.count()){await t.click();await page.waitForTimeout(1500);}}
    return page;
  }
  const shot=(p,n)=>p.screenshot({path:path.join(shots,n+'.png')});
  const step=async(n,fn)=>{try{await fn();}catch(e){fail++;log('FAIL '+n+' — lỗi: '+String(e&&e.message||e).split('\n')[0]);}};
  const callFull=(p,proc,input,get=false)=>p.evaluate(async([proc,input,get])=>{const body=JSON.stringify({0:{json:input}});const r=get?await fetch('/api/trpc/'+proc+'?batch=1&input='+encodeURIComponent(body)):await fetch('/api/trpc/'+proc+'?batch=1',{method:'POST',headers:{'content-type':'application/json'},body});return JSON.stringify(await r.json());},[proc,input,get]);
  const call=(p,proc,input,get=false)=>p.evaluate(async([proc,input,get])=>{const body=JSON.stringify({0:{json:input}});const r=get?await fetch('/api/trpc/'+proc+'?batch=1&input='+encodeURIComponent(body)):await fetch('/api/trpc/'+proc+'?batch=1',{method:'POST',headers:{'content-type':'application/json'},body});const j=await r.json();return JSON.stringify(j).slice(0,400);},[proc,input,get]);
  const gm=async p=>{await p.goto(base+'/gmails?q=p29-'+T);await p.waitForTimeout(2500);};
  const toastUndo=async p=>{const t=p.getByRole('status').filter({hasText:/Đã xoá|Đã khôi phục/}).last();await t.waitFor();const txt=await t.innerText();await t.getByRole('button',{name:'Hoàn tác'}).click();await p.waitForTimeout(2500);return txt;};
  const A=await session('proxy-trial',pass);
  // ════════ 1. Apple ID: paste as bought ════════
  const ax=`apple-${T}-${Date.now().toString(36).slice(-3)}`,A1=`${ax}-1@example.invalid`,A2=`${ax}-2@gmail.com`,L2=`https://example.invalid/2fa?id=AbC${T}&x=%2Fy`,LS=`https://example.invalid/sms/Tok${T}`;
  await step('AP',async()=>{
    await A.goto(base+'/gmails');await A.waitForTimeout(2000);await A.getByRole('button',{name:'Nhập Gmail / Apple ID'}).click();await A.getByRole('radio',{name:'Apple ID'}).click();
    const help=await A.locator('section.acc-import').innerText();check('AP1 chọn Apple ID: hướng dẫn hiện đúng 5 cột',/Email \| Mật khẩu \| Link lấy 2FA \| Link SMS \| Số điện thoại/.test(help));
    await A.getByRole('tab',{name:'Một tài khoản'}).click();const labels=await A.locator('section.acc-import .acc-import-grid label').allInnerTexts();
    check('AP2 form một tài khoản có đúng 5 trường',labels.slice(0,5).join('|').replace(/\s+/g,' ')==='Email Apple ID|Mật khẩu|Link lấy 2FA|Link SMS|Số điện thoại',labels.slice(0,5).join('|'));
    await A.getByRole('tab',{name:'Dán danh sách'}).click();
    const text=`${A1}|Pass:Word!${T}|${L2}|${LS}|0123456789\n${A2}\tpw2\t\thttps://example.invalid/sms/B\t+84 912 345 678\nbad-${T}@example.invalid|pw|ftp://x||`;
    await A.getByLabel('Danh sách tài khoản').fill(text);await A.getByRole('button',{name:/^Nhập \d+ dòng hợp lệ$/}).waitFor({timeout:15000});
    const rows=(await A.locator('.vm-bulk-table tbody tr').allInnerTexts()).map(x=>x.replace(/\s+/g,' '));
    check('AP3 tự kiểm tra: 2 hợp lệ (có link 2FA, link SMS, SĐT), 1 lỗi link báo tại dòng; không bắt sửa cấu trúc',/Hợp lệ/.test(rows[0])&&/link 2FA, link SMS, SĐT/.test(rows[0])&&/Hợp lệ/.test(rows[1])&&/Link lấy 2FA/.test(rows[2]),rows.join(' / '));
    const tbl=await A.locator('.vm-bulk-table').innerText();check('AP4 bảng kiểm tra không lộ mật khẩu / link',!tbl.includes('Pass:Word')&&!tbl.includes('example.invalid/2fa'));
    await shot(A,'ap3-apple-preview');await A.getByRole('button',{name:/^Nhập \d+ dòng hợp lệ$/}).click();await A.getByRole('status').filter({hasText:/Đã nhập 2/}).first().waitFor();
  });
  // Read back the Apple rows directly (probe keys are the part after the tag, i.e. "1" / "2" of apple-<tag>-N).
  await step('AP5',async()=>{
    const r=JSON.parse(execSync('npx tsx --env-file=.env -e "'+`import {prisma} from '@/lib/prisma';import {decrypt} from '@/lib/encryption';(async()=>{const rows=await prisma.gmailAccount.findMany({where:{email:{startsWith:'${ax}'}},orderBy:{email:'asc'}});console.log(JSON.stringify(rows.map(r=>({email:r.email,type:r.loginType,phone:r.phone,rec:r.recoveryEmail,notes:r.notes,tf:r.twoFaCurrent,pw:r.password?decrypt(r.password):null,l2:r.twoFaLink?decrypt(r.twoFaLink):null,ls:r.smsLink?decrypt(r.smsLink):null,enc:r.twoFaLink}))));await prisma.$disconnect();})();`.replace(/"/g,'\\"')+'"',{cwd:app,encoding:'utf8'}).trim().split('\n').pop());
    const a1=r.find(x=>x.email===A1),a2=r.find(x=>x.email===A2);
    check('AP5 đọc lại đủ và đúng: loại Apple ID, mật khẩu, link (hoa/thường, tham số, mã hoá %2F), SĐT 0 đầu; không vào Email khôi phục / Ghi chú / 2FA',!!a1&&a1.type==='APPLE_ID'&&a1.pw==='Pass:Word!'+T&&a1.l2===L2&&a1.ls===LS&&a1.phone==='0123456789'&&a1.rec===null&&a1.notes===null&&a1.tf===null&&a1.enc!==L2,JSON.stringify({...a1,pw:'…',l2:a1?.l2===L2,ls:a1?.ls===LS}));
    check('AP6 Apple ID dùng email gmail.com vẫn là Apple ID; SĐT giữ dấu +',!!a2&&a2.type==='APPLE_ID'&&a2.phone==='+84 912 345 678'&&a2.l2===null&&a2.ls==='https://example.invalid/sms/B');
    await A.getByLabel('Danh sách tài khoản').fill(`${A1}|other|https://example.invalid/new|https://example.invalid/new2|999`);await A.waitForTimeout(2500);
    const row=(await A.locator('.vm-bulk-table tbody tr').first().innerText()).replace(/\s+/g,' ');check('AP7 nhập lại: Đã có, không ghi đè mật khẩu / link / SĐT; nút Nhập tắt',/Đã có/.test(row)&&/không ghi đè/.test(row)&&await A.getByRole('button',{name:'Không có dòng mới để nhập'}).isDisabled());
    await A.getByRole('button',{name:'Bỏ nháp'}).click();
  });
  await step('AU',async()=>{
    await A.goto(base+'/gmails?q='+encodeURIComponent(A1));await A.waitForTimeout(2500);const row=A.locator('tr',{hasText:A1}).first();const txt=(await row.innerText()).replace(/\s+/g,' ');
    check('AU1 dòng hiện SĐT gọn và hai thao tác Lấy 2FA / SMS; không hiện URL',/0123456789/.test(txt)&&await row.getByRole('button',{name:'Lấy 2FA '+A1}).count()===1&&await row.getByRole('button',{name:'SMS '+A1}).count()===1&&!txt.includes('example.invalid/2fa'),txt.slice(0,120));
    await shot(A,'au1-apple-row');
    let fetched=0;A.on('response',r=>{if(r.url().includes('copyAccount'))fetched++;});
    await row.getByRole('button',{name:'Lấy 2FA '+A1}).click();const dlg=A.getByRole('dialog').last();await dlg.waitFor();check('AU2 bấm Lấy 2FA: hỏi PIN trước, chưa gọi link',/PIN/.test(await dlg.innerText())&&fetched===0);
    await dlg.locator('input[type="password"]').fill('123456');await dlg.getByRole('button',{name:'Lấy link'}).click();await A.getByTestId('account-link').waitFor();
    const shown=await A.getByTestId('account-link').innerText(),href=await A.getByRole('link',{name:'Mở trong tab mới'}).getAttribute('href');
    check('AU3 sau PIN: link đúng nguyên văn, có nút Mở (tab mới) và Copy; không tự mở',shown===L2&&href===L2);await shot(A,'au3-apple-link');await A.keyboard.press('Escape');await A.getByRole('button',{name:'Đóng'}).last().click().catch(()=>{});
    // Rights: the viewer (p28 fixture) sees no action and the API refuses; a project outsider too.
    const V=await session(P28.users['p28-view'].username,P28.users['p28-view'].password);await V.goto(base+'/gmails?q='+encodeURIComponent(A1));await V.waitForTimeout(2500);
    const id=(await callFull(A,'accountStore.store',{projectId:I.project},true)).match(/"id":"([^"]+)","email":"apple/)?.[1]||'';
    const vr=await call(V,'businessManagement.copyAccount',{projectId:I.project,kind:'GMAIL',id,pin:'123456'});
    check('AU4 người chỉ xem: không có nút Lấy 2FA / SMS; API copy bị từ chối',!(await V.getByRole('button',{name:'Lấy 2FA '+A1}).count())&&/FORBIDDEN/.test(vr),vr.slice(0,100));
    const O=await session(I.users['p29-out'].username,I.users['p29-out'].password);const orr=await call(O,'businessManagement.copyAccount',{projectId:I.project,kind:'GMAIL',id,pin:'123456'});
    check('AU5 người ngoài dự án: API copy bị từ chối',/FORBIDDEN|NOT_FOUND/.test(orr),orr.slice(0,100));
  });
  // ════════ 2. Xoá kho tài khoản ════════
  const g=n=>I.logins[n];
  await step('DL',async()=>{
    await gm(A);const row=n=>A.locator('tr',{hasText:g(n)}).first();
    check('DL0 mỗi dòng có nút thùng rác "Xoá khỏi kho"',await row('g2').getByRole('button',{name:'Xoá khỏi kho '+g('g2')}).count()===1);
    await row('g2').getByRole('button',{name:'Xoá khỏi kho '+g('g2')}).click();const t=await toastUndo(A);
    check('DL1 xoá một dòng: bấm là ghi, thông báo có Hoàn tác; Hoàn tác trả lại',/Đã xoá 1 tài khoản/.test(t)&&probe().logins.g2.deleted===false,t);
    await row('g1').getByRole('button',{name:'Xoá khỏi kho '+g('g1')}).click();await A.waitForTimeout(2500);const err=await row('g1').locator('[role="alert"]').innerText();
    check('DL2 dòng đang gán VM: báo tại dòng "Đang gán cho Server / VM" kèm link mở máy, không bỏ gán',/Đang gán cho .*VM_001/.test(err)&&(await row('g1').getByRole('link',{name:'Mở'}).getAttribute('href')||'').includes(I.vms.VM_001)&&probe().logins.g1.vm===I.vms.VM_001,err);
    await shot(A,'dl2-login-blocked');
    for(const n of ['g1','g2','g3'])await row(n).getByRole('checkbox',{name:'Chọn '+g(n)}).check();
    await A.getByRole('button',{name:'Xoá 3 dòng'}).click();await A.getByRole('status').filter({hasText:/Đã xoá 2 tài khoản/}).last().waitFor();await A.waitForTimeout(2000);
    const p=probe().logins;check('DL3 xoá hàng loạt: 2 xoá, 1 chặn; dòng bị chặn giữ tick và lý do',p.g2.deleted&&p.g3.deleted&&!p.g1.deleted&&await row('g1').getByRole('checkbox',{name:'Chọn '+g('g1')}).isChecked()&&!(await A.locator('tr',{hasText:g('g2')}).count()));
    check('DL4 tiền mua, số lượng, lô không đổi',probe().batch.paid==='10'&&probe().batch.qty===4&&probe().batch.lines===4);
    await A.getByRole('button',{name:'Đã xoá'}).click();await A.waitForTimeout(2500);
    check('DL5 bộ lọc Đã xoá liệt kê g2, g3; URL state=DELETED',await A.locator('tr',{hasText:g('g2')}).count()===1&&await A.locator('tr',{hasText:g('g3')}).count()===1&&/state=DELETED/.test(A.url()));
    await A.reload();await A.waitForTimeout(2500);check('DL6 tải lại giữ bộ lọc Đã xoá và từ khoá',/state=DELETED/.test(A.url())&&await A.locator('tr',{hasText:g('g2')}).count()===1);
    await shot(A,'dl5-login-deleted');
    await A.locator('tr',{hasText:g('g2')}).first().getByRole('button',{name:'Khôi phục '+g('g2')}).click();await A.getByRole('status').filter({hasText:/Đã khôi phục 1/}).last().waitFor();await A.waitForTimeout(1500);
    await A.locator('tr',{hasText:g('g3')}).first().getByRole('checkbox',{name:'Chọn '+g('g3')}).check();await A.getByRole('button',{name:'Khôi phục 1 dòng'}).click();await A.getByRole('status').filter({hasText:/Đã khôi phục 1/}).last().waitFor();await A.waitForTimeout(1500);
    const q=probe().logins;check('DL7 khôi phục đơn và hàng loạt; dữ liệu giữ nguyên (mật khẩu còn)',!q.g2.deleted&&!q.g3.deleted&&q.g2.hasPassword);
    await A.goto(base+'/gmails?q=p29-'+T+'&page=5');await A.waitForTimeout(2500);check('DL8 trang không tồn tại được kẹp về trang hợp lệ',!/page=/.test(A.url()));
  });
  await step('DP',async()=>{
    await A.goto(base+'/paypals?q='+T);await A.waitForTimeout(3000);const row=n=>A.locator('tr',{hasText:I.pps[n]}).first();
    await row('dp1').getByRole('button',{name:'Xoá khỏi kho '+I.pps.dp1}).click();await A.waitForTimeout(2500);const e1=await row('dp1').locator('[role="alert"]').innerText();
    check('DP1 PayPal có email đang nhận cho VM: chặn, nêu VM, link mở máy',/đang nhận cho .*VM_001/.test(e1)&&!probe().pps.dp1.deleted,e1);
    await row('dp2').getByRole('button',{name:'Xoá khỏi kho '+I.pps.dp2}).click();await A.waitForTimeout(2500);const e2=await row('dp2').locator('[role="alert"]').innerText();
    check('DP2 PayPal còn số dư theo sổ: chặn, nêu số tiền, dẫn tới tiền ra',/Còn lại theo sổ 15\.00 USD/.test(e2)&&(await row('dp2').getByRole('link',{name:'Mở'}).getAttribute('href')||'').includes('show=out'),e2);
    await shot(A,'dp2-paypal-blocked');
    await row('dp3').getByRole('button',{name:'Xoá khỏi kho '+I.pps.dp3}).click();const t=await toastUndo(A);
    check('DP3 PayPal tự do: xoá được, Hoàn tác trả lại; email và sổ không đổi',/Đã xoá 1 PayPal/.test(t)&&!probe().pps.dp3.deleted&&probe().funds===1&&probe().pps.dp3.emails.every(e=>!e[1]));
  });
  // ════════ 3. Quyền: MODERATOR, hạ quyền giữa chừng, ngoài dự án ════════
  await step('R',async()=>{
    const M=await session(I.users['p29-mod'].username,I.users['p29-mod'].password);await gm(M);
    check('R1 MODERATOR: không có thùng rác, không có chip Đã xoá; vẫn sửa tình trạng được',!(await M.getByRole('button',{name:/^Xoá khỏi kho/}).count())&&!(await M.getByRole('button',{name:'Đã xoá'}).count())&&await M.getByLabel('Tình trạng '+g('g3')).count()===1);
    const l3=probe().logins.g3,id3=(await callFull(M,'accountStore.store',{projectId:I.project},true)).match(new RegExp('"id":"([^"]+)","email":"'+g('g3')))?.[1]||'x';const mr=await call(M,'accountStore.deleteStock',{projectId:I.project,kind:'LOGIN',items:[{id:id3,expectedRevision:l3.rev}],key:crypto.randomUUID()});
    check('R2 MODERATOR gọi API xoá: bị từ chối',/FORBIDDEN/.test(mr),mr.slice(0,120));
    const D=await session(I.users['p29-adm'].username,I.users['p29-adm'].password);await gm(D);const had=await D.locator('tr',{hasText:g('g3')}).first().getByRole('button',{name:'Xoá khỏi kho '+g('g3')}).count();
    execSync(`npx tsx --env-file=.env -e "import {prisma} from '@/lib/prisma';(async()=>{const u=await prisma.user.findUniqueOrThrow({where:{username:'${I.users['p29-adm'].username}'}});await prisma.projectMember.update({where:{userId_projectId:{userId:u.id,projectId:'${I.project}'}},data:{role:'MODERATOR'}});await prisma.$disconnect();})();"`,{cwd:app,encoding:'utf8'});
    await D.locator('tr',{hasText:g('g3')}).first().getByRole('button',{name:'Xoá khỏi kho '+g('g3')}).click();await D.waitForTimeout(2500);const body=await D.locator('body').innerText();
    check('R3 ADMIN bị hạ quyền sau khi mở trang: bấm Xoá bị từ chối, không ghi',had===1&&/quyền|FORBIDDEN/i.test(body)&&!probe().logins.g3.deleted);
    const O=await session(I.users['p29-out'].username,I.users['p29-out'].password);const orr=await call(O,'accountStore.deleteStock',{projectId:I.project,kind:'LOGIN',items:[{id:'x',expectedRevision:0}],key:crypto.randomUUID()}),os=await call(O,'accountStore.store',{projectId:I.project,deleted:true},true);
    check('R4 ngoài dự án: API xoá và đọc danh sách đã xoá bị từ chối',/FORBIDDEN|NOT_FOUND/.test(orr)&&/FORBIDDEN|NOT_FOUND/.test(os));
  });
  // ════════ 4. Kho proxy ════════
  const ip=n=>I.ips['ip'+n],SUB=ip(1).split('.').slice(0,3).join('.')+'.';
  await step('PX',async()=>{
    const px=async(q,extra='')=>{await A.goto(base+'/infrastructure/proxies?q='+q+extra);await A.waitForTimeout(3000);};
    await px(ip(1));await A.getByRole('button',{name:'Xoá khỏi kho '+ip(1)}).click();await A.waitForTimeout(2500);const e1=await A.locator('tr',{hasText:ip(1)}).first().locator('[role="alert"]').innerText();
    check('PX1 proxy còn vị trí VM (Chờ cài chưa bắt đầu): chặn tại dòng, link mở VM, không huỷ giao',/Đang gán cho .*VM_002/.test(e1)&&await A.getByRole('link',{name:/^Mở .*VM_002/}).count()===1&&probe().proxies[ip(1)].holds===1,e1);
    await shot(A,'px1-proxy-blocked');
    await px(ip(2));await A.getByRole('button',{name:'Xoá khỏi kho '+ip(2)}).click();const t=await toastUndo(A);
    check('PX2 proxy LIVE không có VM: xoá được (không hỏi lý do / xác nhận), Hoàn tác trả về LIVE',/Đã xoá 1 proxy/.test(t)&&probe().proxies[ip(2)].state==='LIVE'&&!probe().proxies[ip(2)].retiredAt,t);
    await px(SUB);for(const n of [1,2,3])await A.getByRole('checkbox',{name:'Chọn '+ip(n)}).check();
    await A.getByRole('button',{name:'Xoá 3 dòng'}).click();await A.getByRole('status').filter({hasText:/Đã xoá 2 proxy/}).last().waitFor();await A.waitForTimeout(2500);
    const p=probe().proxies;check('PX3 xoá hàng loạt: 2 xoá (giữ IP, user/pass), 1 chặn còn tick',p[ip(2)].state==='RETIRED'&&p[ip(3)].state==='RETIRED'&&p[ip(2)].hasCred&&p[ip(1)].state==='LIVE'&&await A.getByRole('checkbox',{name:'Chọn '+ip(1)}).isChecked());
    await px(SUB,'&tab=history&state=RETIRED');check('PX4 bộ lọc Đã xoá (Lịch sử IP) liệt kê 2 dòng với nhãn Đã xoá',await A.locator('tr',{hasText:ip(2)}).count()===1&&/Đã xoá/.test(await A.locator('tr',{hasText:ip(2)}).first().innerText()));
    await shot(A,'px4-proxy-deleted');
    await A.getByRole('button',{name:'Khôi phục '+ip(3)}).click();await A.getByRole('status').filter({hasText:/Đã khôi phục 1 proxy/}).last().waitFor();await A.waitForTimeout(2000);
    await A.getByRole('checkbox',{name:'Chọn '+ip(2)}).check();await A.getByRole('button',{name:'Khôi phục 1 dòng'}).click();await A.getByRole('status').filter({hasText:/Đã khôi phục 1 proxy/}).last().waitFor();await A.waitForTimeout(2000);
    const q=probe().proxies;check('PX5 khôi phục đơn và hàng loạt về đúng trạng thái trước (NEW / LIVE)',q[ip(3)].state==='NEW'&&q[ip(2)].state==='LIVE');
    const M=await session(I.users['p29-mod'].username,I.users['p29-mod'].password);await M.goto(base+'/infrastructure/proxies?q='+ip(3));await M.waitForTimeout(3000);
    await M.getByRole('button',{name:'Sửa '+ip(3)}).click();await M.waitForTimeout(800);const ed=await M.locator('[role="group"][aria-label="Sửa proxy '+ip(3)+'"]').innerText();
    const mr=await call(M,'proxyManagement.editPreview',{projectId:I.project,items:[{endpointId:I.ips.p3,manage:{kind:'RETIRE',reason:'Xoá khỏi kho'}}],idempotencyKey:crypto.randomUUID()});
    check('PX6 MODERATOR (có quyền nhập): không có thùng rác, bút sửa không còn Ngừng quản lý; API xoá bị từ chối',!(await M.getByRole('button',{name:'Xoá khỏi kho '+ip(3)}).count())&&!/Ngừng quản lý|Xoá khỏi kho/.test(ed)&&/FORBIDDEN/.test(mr),mr.slice(0,100));
  });
  log(`\nKết quả: ${ok_} đạt, ${fail} lỗi. Lỗi JS: ${errs.length?errs.join(' | '):'không'}`);await b.close();
})();
