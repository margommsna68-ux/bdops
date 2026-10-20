// LOCAL trial only: one bulk bar (Gmail / Apple ID, PayPal, Kho proxy) and imports that hand the person back to the table. Fresh data from
// .runtime/p29-local-setup.ts (written to scratchpad/p30-info.json). Every check reads the saved data. Synthetic data only. Screenshots only.
const {chromium}=require('playwright-core');const fs=require('fs');const path=require('path');const {execSync}=require('child_process');
const base='http://localhost:3010',pass=fs.readFileSync(path.join(__dirname,'.demo-pass'),'utf8').trim(),TRIAL='Proxy & VM — Bản thử';
const I=JSON.parse(fs.readFileSync(path.join(__dirname,'..','p30-info.json'),'utf8')),T=I.tag;
const app='C:/Users/TUNTUN/Desktop/project web new/bdops-proxy-app';
const q=(code)=>JSON.parse(execSync('npx tsx --env-file=.env -e "'+("import {prisma} from '@/lib/prisma';import {decrypt} from '@/lib/encryption';void decrypt;(async()=>{const r=await (async()=>{"+code+"})();console.log(JSON.stringify(r));await prisma.$disconnect();})();").replace(/"/g,'\\"')+'"',{cwd:app,encoding:'utf8'}).trim().split('\n').pop());
const shots=path.join(__dirname,'shots-p30');fs.mkdirSync(shots,{recursive:true});
const out=[];const log=m=>{out.push(m);console.log(m);fs.writeFileSync(path.join(shots,'result-local.txt'),out.join('\n'));};let ok_=0,fail=0;
const check=(c,ok,d='')=>{ok?ok_++:fail++;log((ok?'PASS ':'FAIL ')+c+(d?' — '+d:''));};
(async()=>{
  const b=await chromium.launch({channel:'chrome',headless:true});const errs=[];
  async function session(user,password,o={}){
    const ctx=await b.newContext({viewport:o.vp||{width:1280,height:860},...(o.vp&&o.vp.width<500?{isMobile:true,hasTouch:true,deviceScaleFactor:2}:{})});
    if(o.theme)await ctx.addInitScript(x=>{try{localStorage.setItem('bdops-settings',JSON.stringify({state:{language:'vi',timezone:'Asia/Ho_Chi_Minh',theme:x},version:0}));}catch{}},o.theme);
    const page=await ctx.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errs.push(user+': '+String(e)));
    await page.goto(base+'/login');await page.fill('input[type="text"]',user);await page.fill('input[type="password"]',password);await page.click('button[type="submit"]');await page.waitForURL(u=>!String(u).includes('/login'),{timeout:180000});
    await page.goto(base+'/dashboard');const pin=page.locator('input[placeholder="Enter PIN"]');try{await pin.waitFor({timeout:5000});await pin.fill('123456');await page.getByRole('button',{name:'Unlock'}).click();}catch{}
    await page.waitForTimeout(1500);if(await page.getByRole('heading',{name:'Chọn dự án'}).count()){const t=page.getByText(TRIAL,{exact:true}).first();if(await t.count()){await t.click();await page.waitForTimeout(1500);}}
    return page;
  }
  const shot=(p,n)=>p.screenshot({path:path.join(shots,n+'.png')});
  const step=async(n,fn)=>{try{await fn();}catch(e){fail++;log('FAIL '+n+' — lỗi: '+String(e&&e.message||e).split('\n')[0]);}};
  const A=await session('proxy-trial',pass);
  const g=n=>I.logins[n];
  // ════════ 1. One bulk bar ════════
  await step('B',async()=>{
    await A.goto(base+'/gmails?q=p29-'+T);await A.waitForTimeout(2500);
    const bar=A.getByRole('region',{name:'Thao tác hàng loạt'}),tableY=async()=>A.locator('table.pm-table').first().evaluate(e=>e.getBoundingClientRect().top+window.scrollY);
    const y0=await tableY(),idle=await bar.innerText();
    await A.locator('tr',{hasText:g('g2')}).first().getByRole('checkbox',{name:'Chọn '+g('g2')}).check();await A.locator('tr',{hasText:g('g3')}).first().getByRole('checkbox',{name:'Chọn '+g('g3')}).check();await A.waitForTimeout(300);
    const y1=await tableY(),txt=(await bar.innerText()).replace(/\s+/g,' ');
    check('B1 Gmail/Apple ID: một thanh duy nhất, đếm một lần "Đã chọn 2", Đổi tình trạng + Áp dụng, cuối là Xoá 2 dòng + Bỏ chọn',await A.getByRole('region',{name:'Thao tác hàng loạt'}).count()===1&&(txt.match(/Đã chọn/g)||[]).length===1&&/Đã chọn 2 tài khoản/.test(txt)&&/Áp dụng.*Xoá 2 dòng.*Bỏ chọn/.test(txt)&&!(await A.getByText(/\d+ đã chọn/).count()),txt);
    check('B2 chọn dòng không làm bảng nhảy (vị trí bảng giữ nguyên)',Math.abs(y1-y0)<2&&/Chọn dòng/.test(idle),`y ${y0} → ${y1}`);
    const del=bar.getByRole('button',{name:'Xoá khỏi kho 2 dòng đã chọn'}),st=await del.evaluate(e=>({h:e.getBoundingClientRect().height,color:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor}));
    check('B3 Xoá là nút phụ nhỏ (≤34px), chữ đỏ nhẹ, không nền đỏ',st.h<=34&&/rgb\((180, 35, 24|241, 155, 147)\)/.test(st.color)&&!/rgb\(2[0-9]{2}, [0-9]{1,2}, [0-9]{1,2}\)/.test(st.bg),JSON.stringify(st));
    await shot(A,'b1-login-bar');
    const rowBtn=await A.locator('tr',{hasText:g('g2')}).first().getByRole('button',{name:'Xoá khỏi kho '+g('g2')}).evaluate(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}));
    check('B4 nút xoá từng dòng cùng cỡ nút biểu tượng, có tên rõ',rowBtn.w>=28&&rowBtn.w<=40&&Math.abs(rowBtn.w-rowBtn.h)<3,JSON.stringify(rowBtn));
    await bar.getByRole('combobox',{name:'Tình trạng cho các dòng đã chọn'}).selectOption('SUSPENDED');await bar.getByRole('button',{name:'Áp dụng'}).click();await A.waitForTimeout(2500);
    const s=q(`return (await prisma.gmailAccount.findMany({where:{email:{in:['${g('g2')}','${g('g3')}']}},select:{status:true}})).map(x=>x.status);`);
    check('B5 Áp dụng tình trạng từ thanh: đúng 2 dòng đã chọn',s.every(x=>x==='SUSPENDED')&&s.length===2,JSON.stringify(s));
    await A.locator('tr',{hasText:g('g1')}).first().getByRole('checkbox',{name:'Chọn '+g('g1')}).check();await A.locator('tr',{hasText:g('g3')}).first().getByRole('checkbox',{name:'Chọn '+g('g3')}).check();
    await bar.getByRole('button',{name:/^Xoá khỏi kho 2 dòng/}).click();await A.waitForTimeout(3000);
    const keep=(await bar.innerText()).replace(/\s+/g,' '),row1=await A.locator('tr',{hasText:g('g1')}).first().locator('[role="alert"]').innerText().catch(()=>'');
    check('B6 xoá hàng loạt từ thanh: dòng đang gán bị chặn tại dòng và vẫn được chọn (thanh còn "Đã chọn 1")',/Đã chọn 1 tài khoản/.test(keep)&&/Đang gán cho/.test(row1)&&q(`return !!(await prisma.gmailAccount.findUniqueOrThrow({where:{email:'${g('g3')}'}})).archivedAt;`),keep);
    await A.getByRole('button',{name:'Bỏ chọn'}).click();
    await A.goto(base+'/paypals?q='+T);await A.waitForTimeout(3000);await A.getByRole('checkbox',{name:'Chọn '+I.pps.dp3}).check();
    const ptxt=(await A.getByRole('region',{name:'Thao tác hàng loạt'}).innerText()).replace(/\s+/g,' ');
    check('B7 PayPal: cùng mẫu thanh (Đã chọn 1 PayPal → Đổi tình trạng → Xoá → Bỏ chọn)',/Đã chọn 1 PayPal.*Áp dụng.*Xoá 1 dòng.*Bỏ chọn/.test(ptxt)&&await A.getByRole('region',{name:'Thao tác hàng loạt'}).count()===1,ptxt);await shot(A,'b7-paypal-bar');
    const sub=I.ips.ip1.split('.').slice(0,3).join('.')+'.';
    await A.goto(base+'/infrastructure/proxies?q='+sub);await A.waitForTimeout(3500);const pY=()=>A.locator('table.pm-table').first().evaluate(e=>e.getBoundingClientRect().top+window.scrollY),py0=await pY();
    await A.getByRole('checkbox',{name:'Chọn '+I.ips.ip1}).check();await A.getByRole('checkbox',{name:'Chọn '+I.ips.ip3}).check();await A.waitForTimeout(300);
    const xtxt=(await A.getByRole('region',{name:'Thao tác hàng loạt'}).innerText()).replace(/\s+/g,' '),py1=await pY();
    check('B8 Kho proxy: cùng mẫu thanh, Xoá và Bỏ chọn ở cuối, bảng không nhảy',/Đã chọn 2 proxy.*Đổi nhóm.*Áp dụng.*Copy proxy.*Xoá 2 dòng.*Bỏ chọn/.test(xtxt)&&Math.abs(py1-py0)<2,xtxt+` y ${py0}→${py1}`);await shot(A,'b8-proxy-bar');
  });
  // ════════ 2. Imports hand the person back to the table ════════
  const x2=Date.now().toString(36).slice(-4),mail=n=>`imp-${T}-${x2}-${n}@example.invalid`;
  const costs=()=>q(`return await prisma.costRecord.count({where:{projectId:'${I.project}',voidedAt:null}});`);
  await step('I',async()=>{
    await A.goto(base+'/gmails?state=ASSIGNED');await A.waitForTimeout(2500);
    const open=async()=>{await A.getByRole('button',{name:'Nhập Gmail / Apple ID'}).click();await A.locator('section.acc-import').waitFor();};
    await open();await A.getByRole('radio',{name:'Gmail'}).click();await A.getByLabel('Danh sách tài khoản').fill(`${mail(1)}|pw1\n${mail(2)}|pw2`);
    await A.getByLabel('Nguồn mua').fill('Shop thử');await A.getByRole('button',{name:/^Nhập 2 dòng hợp lệ$/}).waitFor({timeout:15000});
    const c0=costs();await A.getByRole('button',{name:/^Nhập 2 dòng hợp lệ$/}).click();const t=A.getByRole('status').filter({hasText:/Đã nhập 2 tài khoản vào lô/}).last();await t.waitFor();
    check('I1 nhập hết: khung đóng, thông báo "Đã nhập 2 tài khoản…"; bộ lọc Đã gán giữ nguyên nên có nút Xem vừa nhập',!(await A.locator('section.acc-import').count())&&/state=ASSIGNED/.test(A.url())&&await t.getByRole('button',{name:'Xem vừa nhập'}).count()===1);
    await shot(A,'i1-import-done');await t.getByRole('button',{name:'Xem vừa nhập'}).click();await A.waitForTimeout(2500);
    check('I2 Xem vừa nhập mở đúng đợt vừa nhập: thấy 2 tài khoản mới, không dòng nào được chọn',await A.locator('tr',{hasText:mail(1)}).count()===1&&await A.locator('tr',{hasText:mail(2)}).count()===1&&/batch=/.test(A.url())&&(await A.getByRole('region',{name:'Thao tác hàng loạt'}).getAttribute('data-selected'))==='0');
    await open();const fresh=await A.getByLabel('Danh sách tài khoản').inputValue(),src=await A.getByLabel('Nguồn mua').inputValue(),gm=await A.getByRole('radio',{name:'Gmail'}).getAttribute('aria-checked');
    check('I3 mở Nhập lần nữa: lần mua mới (ô dán, nguồn, lô trống), vẫn giữ loại Gmail đã chọn',fresh===''&&src===''&&gm==='true'&&!(await A.getByText(/Nhập bổ sung vào lô/).count()));
    // Partial: one good, one bad → only the bad line stays, then fixing it continues the same batch with no new cost.
    await A.getByLabel('Danh sách tài khoản').fill(`${mail(3)}|pw3\nkhong-phai-email|x`);await A.getByRole('button',{name:/^Nhập 1 dòng hợp lệ$/}).waitFor({timeout:15000});
    await A.getByRole('button',{name:/^Nhập 1 dòng hợp lệ$/}).click();await A.waitForTimeout(3000);
    const left=await A.getByLabel('Danh sách tài khoản').inputValue(),costMid=costs();
    check('I4 nhập một phần: khung còn mở, chỉ giữ dòng lỗi, chuyển sang Nhập bổ sung vào lô vừa tạo',left==='khong-phai-email|x'&&await A.getByText(/Nhập bổ sung vào lô/).count()>0,left);
    await A.getByLabel('Danh sách tài khoản').fill(`${mail(4)}|pw4`);await A.getByRole('button',{name:/^Nhập 1 dòng hợp lệ$/}).waitFor({timeout:15000});await A.getByRole('button',{name:/^Nhập 1 dòng hợp lệ$/}).click();
    await A.getByRole('status').filter({hasText:/Đã nhập 1 tài khoản vào lô/}).last().waitFor();
    const same=q(`const a=await prisma.gmailAccount.findMany({where:{email:{in:['${mail(3)}','${mail(4)}']}},select:{batchId:true}});return new Set(a.map(x=>x.batchId)).size===1&&a.length===2;`);
    check('I5 sửa dòng lỗi: vẫn vào cùng lô, không ghi thêm chi phí, khung đóng sau khi hết dòng',same&&costs()===costMid&&costMid===c0&&!(await A.locator('section.acc-import').count()),`chi phí ${c0}→${costMid}→${costs()}`);
    // Lost answer: the save request fails after the server stored it → keep everything, Thử lại replays (no second batch / account).
    await open();await A.getByLabel('Danh sách tài khoản').fill(`${mail(5)}|pw5`);await A.getByRole('button',{name:/^Nhập 1 dòng hợp lệ$/}).waitFor({timeout:15000});
    let cut=true;await A.route(/importCommit/,async r=>{const res=await r.fetch();if(cut){cut=false;await r.abort();}else await r.fulfill({response:res});});
    await A.getByRole('button',{name:/^Nhập 1 dòng hợp lệ$/}).click();await A.getByRole('button',{name:'Thử lại'}).waitFor();
    check('I6 mất phản hồi: khung không đóng, nội dung giữ nguyên, có Thử lại',await A.locator('section.acc-import').count()===1&&(await A.getByLabel('Danh sách tài khoản').inputValue())===`${mail(5)}|pw5`);
    await A.getByRole('button',{name:'Thử lại'}).click();await A.getByRole('status').filter({hasText:/Đã nhập 1 tài khoản/}).last().waitFor();await A.unroute(/importCommit/);
    const n5=q(`return {acc:await prisma.gmailAccount.count({where:{email:'${mail(5)}'}}),batches:await prisma.accountPurchaseBatch.count({where:{projectId:'${I.project}',logins:{some:{email:'${mail(5)}'}}}})};`);
    check('I7 Thử lại cùng khoá: 1 tài khoản, 1 lô, khung đóng',n5.acc===1&&n5.batches===1&&!(await A.locator('section.acc-import').count()),JSON.stringify(n5));
  });
  await step('IP',async()=>{
    await A.goto(base+'/infrastructure/proxies?group=GENJY');await A.waitForTimeout(3000);await A.getByRole('button',{name:'Nhập mới'}).click();
    const net='198.51.'+(100+Math.floor(Math.random()*120))+'.',d=A.getByRole('dialog');await d.waitFor();
    await d.locator('textarea').first().fill(`${net}11:80:demo:demo-only\n${net}12:80:demo:demo-only`);
    await d.getByLabel('Gói proxy').selectOption('231243');
    await d.locator('.pm-button-primary').last().click();await A.waitForTimeout(4000);
    if(await A.getByRole('dialog').count())await d.locator('.pm-button-primary').last().click();
    const t=A.getByRole('status').filter({hasText:/Đã nhập 2 proxy/}).last();await t.waitFor({timeout:20000});
    check('IP1 nhập proxy mới đủ: dialog đóng, thông báo, có Xem vừa nhập (bộ lọc Genjy riêng đang che)',!(await A.getByRole('dialog').count())&&await t.getByRole('button',{name:'Xem vừa nhập'}).count()===1);
    await t.getByRole('button',{name:'Xem vừa nhập'}).click();await A.waitForTimeout(3000);
    check('IP2 Xem vừa nhập: chỉ 2 proxy của đợt đó, có chip "Đang xem đợt nhập vừa thêm"',await A.locator('tbody tr',{hasText:net}).count()===2&&await A.getByText('Đang xem đợt nhập vừa thêm').count()===1&&/batch=/.test(A.url()));
    await shot(A,'ip2-proxy-batch');
  });
  // ════════ 2b. Khung chi tiết: Apple ID 5 cột → mở → lấy từng thông tin → sửa một trường ════════
  await step('D',async()=>{
    const ax=`det-${T}-${x2}@example.invalid`,L2=`https://example.invalid/2fa?id=Ab${x2}&k=%2F`,LS=`https://example.invalid/sms/Tok${x2}`;
    await A.goto(base+'/gmails');await A.waitForTimeout(2000);await A.getByRole('button',{name:'Nhập Gmail / Apple ID'}).click();await A.getByRole('radio',{name:'Apple ID'}).click();
    await A.getByLabel('Danh sách tài khoản').fill(`${ax}|Pass:${x2}|${L2}|${LS}|0123456789`);await A.getByRole('button',{name:/^Nhập 1 dòng hợp lệ$/}).waitFor({timeout:15000});await A.getByRole('button',{name:/^Nhập 1 dòng hợp lệ$/}).click();
    await A.getByRole('status').filter({hasText:/Đã nhập 1 tài khoản/}).last().waitFor();
    await A.goto(base+'/gmails?q='+encodeURIComponent(ax));await A.waitForTimeout(2500);
    await A.getByRole('button',{name:'Mở chi tiết '+ax}).click();const f=A.getByRole('group',{name:'Chi tiết '+ax});await f.waitFor();
    const labels=await f.locator('.acc-detail-label').allInnerTexts();
    check('D1 bấm email mở khung trong trang: Email đăng nhập, Mật khẩu, Link lấy mã 2FA, Link SMS, Số điện thoại, Ghi chú; mật khẩu che',labels.join('|')==='Email đăng nhập|Mật khẩu|Link lấy mã 2FA|Link SMS|Số điện thoại|Ghi chú'&&/••••••••/.test(await f.innerText())&&!(await f.innerText()).includes('Pass:'),labels.join('|'));
    await shot(A,'d1-detail-masked');
    let opened=null;A.context().on('page',p=>{p.close().catch(()=>{});});await A.context().route('https://example.invalid/**',r=>{opened=r.request().url();return r.abort();});
    await f.getByRole('button',{name:'Xem Mật khẩu '+ax}).click();await f.getByLabel('PIN').fill('123456');await f.getByRole('button',{name:'Mở'}).click();await A.waitForTimeout(1500);
    const pw=await f.locator('[data-field="password"] code').innerText();check('D2 Xem mật khẩu sau PIN: đúng nguyên văn; Ẩn lại được',pw==='Pass:'+x2);
    await f.getByRole('button',{name:'Ẩn Mật khẩu '+ax}).click();check('D3 Ẩn: mật khẩu che lại',(await f.locator('[data-field="password"] code').innerText())==='••••••••');
    await f.getByRole('button',{name:'Lấy mã 2FA',exact:true}).click();await A.waitForTimeout(1500);
    check('D4 Lấy mã 2FA mở đúng link đã nhập (tab mới, chỉ khi bấm)',opened===L2||decodeURIComponent(opened||'')===decodeURIComponent(L2),String(opened));
    await f.getByRole('button',{name:'Sửa'}).click();const save=f.getByRole('button',{name:/^Lưu/});
    check('D5 vào Sửa: Lưu mờ khi chưa đổi; ô mật khẩu để trống = giữ nguyên',await save.isDisabled()&&(await f.getByLabel('Mật khẩu').inputValue())==='');
    await f.getByLabel('Số điện thoại').fill('+84 900 000 002');check('D6 đổi một trường: Lưu bật (Lưu 1 trường)',!(await save.isDisabled())&&/Lưu 1 trường/.test(await save.innerText()));
    await save.click();await A.getByRole('status').filter({hasText:/Đã lưu Số điện thoại/}).last().waitFor();
    const r=q(`const g=await prisma.gmailAccount.findUniqueOrThrow({where:{email:'${ax}'}});return {phone:g.phone,pw:decrypt(g.password),l2:decrypt(g.twoFaLink),ls:decrypt(g.smsLink),type:g.loginType,notes:g.notes};`);
    check('D7 đọc lại DB: chỉ SĐT đổi; mật khẩu, hai link, loại giữ nguyên',r.phone==='+84 900 000 002'&&r.pw==='Pass:'+x2&&r.l2===L2&&r.ls===LS&&r.type==='APPLE_ID',JSON.stringify({...r,pw:r.pw==='Pass:'+x2,l2:r.l2===L2,ls:r.ls===LS}));
    await A.context().unroute('https://example.invalid/**');
  });
  // ════════ 3. Themes and phone ════════
  await step('TH',async()=>{
    for(const [theme,vp] of [['light',null],['dark',null],['golden',null],['bronze',null],['bronze',{width:390,height:844}]]){
      const P=await session('proxy-trial',pass,{theme,vp});await P.goto(base+'/gmails?q=p29-'+T);await P.waitForTimeout(2500);
      await P.locator('tr',{hasText:g('g2')}).first().getByRole('checkbox',{name:'Chọn '+g('g2')}).check();await P.waitForTimeout(300);
      const w=await P.evaluate(()=>({doc:document.documentElement.scrollWidth,vw:window.innerWidth}));
      await shot(P,'th-'+theme+(vp?'-phone':''));check('TH '+theme+(vp?' 390px':'')+': thanh hiện, không tràn ngang trang',await P.getByRole('region',{name:'Thao tác hàng loạt'}).count()===1&&w.doc<=w.vw+1,JSON.stringify(w));
      await P.context().close();
    }
  });
  log(`\nKết quả: ${ok_} đạt, ${fail} lỗi. Lỗi JS: ${errs.length?errs.join(' | '):'không'}`);await b.close();
})();
