// LOCAL trial only: review fixes of 20/10/2026 by real clicks in two sessions (A = proxy-trial, B = p28-b, B2 = a second proxy-trial
// session that recreates VMs), then the view-only and out-of-project accounts. Every check reads the saved data
// (.runtime/p28-local-probe.ts). Screenshots only.
const {chromium}=require('playwright-core');const fs=require('fs');const path=require('path');const {execSync}=require('child_process');
const base='http://localhost:3010',pass=fs.readFileSync(path.join(__dirname,'.demo-pass'),'utf8').trim(),TRIAL='Proxy & VM — Bản thử';
const I=JSON.parse(fs.readFileSync(path.join(__dirname,'..','p28-info.json'),'utf8')),T=I.tag,SV=I.serverCode;
const app='C:/Users/TUNTUN/Desktop/project web new/bdops-proxy-app';
const probe=()=>JSON.parse(execSync('npx tsx --env-file=.env .runtime/p28-local-probe.ts',{cwd:app,encoding:'utf8',env:{...process.env,TAG:T}}).trim().split('\n').pop());
const shots=path.join(__dirname,'shots-p28');fs.mkdirSync(shots,{recursive:true});
const out=[];const log=m=>{out.push(m);console.log(m);fs.writeFileSync(path.join(shots,'result-local.txt'),out.join('\n'));};let ok_=0,fail=0;
const check=(c,ok,d='')=>{ok?ok_++:fail++;log((ok?'PASS ':'FAIL ')+c+(d?' — '+d:''));};
const S=n=>'p28-'+T+'-'+String(n).padStart(4,'0');
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
  const open=async p=>{await p.goto(base+'/infrastructure/servers/'+I.server);await p.locator('tr[data-row]').first().waitFor();await p.waitForTimeout(1500);};
  const paste=async(p,text)=>{await p.getByRole('button',{name:'Dán bảng'}).click();await p.getByRole('tab',{name:'SDK'}).click();await p.getByLabel('Danh sách SDK dán').fill(text);await p.waitForTimeout(2500);};
  const frame=async(p,vm)=>{await p.locator(`[data-cell="${I.vms[vm]}|sdk"]`).click();const d=p.getByRole('dialog',{name:'SDK '+SV+' / '+vm});await d.waitFor();return d;};
  const addIn=async(d,vm,code,amount,note)=>{await d.getByLabel('Mã SDK mới cho '+vm).fill(code);if(amount)await d.getByLabel('Tiền tích luỹ USD của mã mới '+vm).fill(amount);if(note)await d.getByLabel('Ghi chú mã mới '+vm).fill(note);};
  const recreate=async(p,vm)=>{await open(p);await p.getByLabel('Tình trạng '+SV+' / '+vm).selectOption({label:'SUS'});await p.waitForTimeout(2500);
    await p.locator('tr[data-row]',{hasText:vm}).first().getByRole('button',{name:'Ghi nhận đã tạo lại (SUS)'}).click();await p.getByRole('dialog',{name:'Rút tiền '+SV+' / '+vm}).getByRole('button',{name:'Ghi nhận đã tạo lại VM'}).click();await p.waitForTimeout(3000);};
  const A=await session('proxy-trial',pass),B=await session(I.users['p28-b'].username,I.users['p28-b'].password),B2=await session('proxy-trial',pass);
  // ════════ 1. Bản dán thuộc lượt VM cũ ════════
  await step('C1',async()=>{
    await open(A);const text=`VM_010 | ${S(1)} | 10 | ghi A\nVM_002 | ${S(2)} | 3`;await paste(A,text);
    await A.getByText('2 SDK sẽ ghi',{exact:false}).first().waitFor();
    await recreate(B2,'VM_010');check('C1 phiên B2 tạo lại VM_010 → lượt 2',probe().vms.VM_010.cycle===2);
    await A.getByRole('button',{name:'Áp dụng 2 SDK'}).click();await A.getByRole('status').filter({hasText:'Đã lưu'}).waitFor();
    const row1=await A.locator('.vm-bulk-result tr',{hasText:S(1)}).innerText(),p=probe();
    check('C2 dòng của VM đã tạo lại báo tại dòng, không ghi; dòng khác vẫn lưu',/VM đã được tạo lại, kiểm tra lại dòng này/.test(row1)&&!p.sdks[S(1)]&&p.sdks[S(2)]?.vm==='VM_002',row1.replace(/\s+/g,' '));
    check('C3 nội dung dán được giữ',(await A.getByLabel('Danh sách SDK dán').inputValue())===text);await shot(A,'c1-paste-recreated-line');
    await A.getByRole('button',{name:'Kiểm tra lại'}).click();await A.getByRole('button',{name:'Áp dụng 1 SDK'}).waitFor();
    check('C4 Kiểm tra lại: dòng 1 ghép lượt mới (người dùng bấm), dòng 2 giữ nguyên',/Thêm SDK mới/.test(await A.locator('.vm-bulk-result tr',{hasText:S(1)}).innerText())&&/Giữ nguyên/.test(await A.locator('.vm-bulk-result tr',{hasText:S(2)}).innerText()));
    await A.getByRole('button',{name:'Áp dụng 1 SDK'}).click();await A.getByRole('status').filter({hasText:'Đã lưu 1'}).waitFor();
    check('C5 sau khi kiểm lại, lưu đúng vào VM_010 lượt 2',probe().sdks[S(1)]?.vm==='VM_010');
  });
  // ════════ 2. Khung SDK đang mở, nền tải lại sau khi VM được tạo lại ════════
  await step('F',async()=>{
    await open(A);const d=await frame(A,'VM_010');await addIn(d,'VM_010',S(3),'5','ghi khung');
    await recreate(B2,'VM_010');
    await A.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));});await A.waitForTimeout(3500);
    const msg=(await d.locator('[role="alert"]').allInnerTexts()).join(' '),btn=await d.getByRole('button',{name:/^(Thêm|Kiểm tra lại)$/}).innerText();
    log('  (nền tải lại: '+(/lượt 3/.test(msg)?'có':'không')+'; nút: '+btn+')');
    if(btn==='Thêm'){await d.getByRole('button',{name:'Thêm',exact:true}).click();await A.waitForTimeout(2500);}
    const after=probe(),alert=(await d.locator('[role="alert"]').allInnerTexts()).join(' ');
    check('F1 nháp cũ không tự sang lượt mới: không ghi, báo tại khung, giữ mã / tiền / ghi chú',after.vms.VM_010.cycle===3&&!after.sdks[S(3)]&&/tạo lại|lượt/.test(alert)&&(await d.getByLabel('Mã SDK mới cho VM_010').inputValue())===S(3)&&(await d.getByLabel('Tiền tích luỹ USD của mã mới VM_010').inputValue())==='5',alert.slice(0,140));
    await shot(A,'f1-frame-recreated');
    if((await d.getByRole('button',{name:/^(Thêm|Kiểm tra lại)$/}).innerText())==='Kiểm tra lại')await d.getByRole('button',{name:'Kiểm tra lại'}).click();
    await d.getByRole('button',{name:'Thêm',exact:true}).click();await A.waitForTimeout(2500);
    const p=probe();check('F2 người dùng kiểm lại rồi bấm Thêm: lưu vào lượt 3; SDK chưa dùng S1 vẫn ở VM qua các lượt',p.sdks[S(3)]?.vm==='VM_010'&&p.sdks[S(3)].amount==='5'&&p.sdks[S(1)]?.vm==='VM_010'&&p.sdks[S(1)].state==='UNLINKED',JSON.stringify(p.sdks[S(3)]));
    await A.keyboard.press('Escape');
  });
  // ════════ 3. Không ghi đè SDK vừa được người khác thêm ════════
  await step('W',async()=>{
    await open(A);await paste(A,`VM_004 | ${S(4)} | 10 | ghi A`);await A.getByRole('button',{name:'Áp dụng 1 SDK'}).waitFor();
    await open(B);const db_=await frame(B,'VM_004');await addIn(db_,'VM_004',S(4),'20','ghi B');await db_.getByRole('button',{name:'Thêm',exact:true}).click();await B.waitForTimeout(2500);
    check('W0 B lưu trước: 20 USD, ghi B',probe().sdks[S(4)]?.amount==='20');
    await A.getByRole('button',{name:'Áp dụng 1 SDK'}).click();await A.getByRole('status').filter({hasText:'Đã lưu'}).waitFor();
    const row=await A.locator('.vm-bulk-result tr',{hasText:S(4)}).innerText(),p=probe().sdks[S(4)];
    check('W1 Dán bảng: bản dán cũ bị từ chối tại dòng, giữ 20 USD / ghi B của B',/vừa được thêm/.test(row)&&p.amount==='20'&&p.note==='ghi B'&&p.revision===0,row.replace(/\s+/g,' ')+' · '+JSON.stringify(p));await shot(A,'w1-paste-refused');
    await open(A);const da=await frame(A,'VM_005');await addIn(da,'VM_005',S(5),'10','ghi A');await A.waitForTimeout(1500);
    await open(B);const db2=await frame(B,'VM_005');await addIn(db2,'VM_005',S(5),'20','ghi B');await db2.getByRole('button',{name:'Thêm',exact:true}).click();await B.waitForTimeout(2500);
    await da.getByRole('button',{name:/^(Thêm|Kiểm tra lại)$/}).click().catch(()=>{});await A.waitForTimeout(2500);
    const q=probe().sdks[S(5)],txt=(await da.innerText().catch(()=>'')).replace(/\s+/g,' ');
    check('W2 Thêm một mã: A không ghi đè, giữ 20 USD / ghi B',q.amount==='20'&&q.note==='ghi B'&&q.revision===0,JSON.stringify(q));
    check('W3 A thấy lý do ngay tại khung, không mất nội dung đang nhập',/vừa được|đã ở trong danh sách/.test(txt)&&(await da.getByLabel('Ghi chú mã mới VM_005').inputValue().catch(()=>''))==='ghi A',txt.slice(txt.indexOf('Thêm SDK'),txt.indexOf('Thêm SDK')+260));await shot(A,'w3-add-refused');
    await A.keyboard.press('Escape');
    // Same code, same VM, nothing different: "Giữ nguyên", no extra history.
    await open(A);await paste(A,`VM_006 | ${S(6)}`);await A.getByRole('button',{name:'Áp dụng 1 SDK'}).waitFor();
    await open(B);const db3=await frame(B,'VM_006');await addIn(db3,'VM_006',S(6),'7','');await db3.getByRole('button',{name:'Thêm',exact:true}).click();await B.waitForTimeout(2500);
    const ev=probe().sdks[S(6)].events;await A.getByRole('button',{name:'Áp dụng 1 SDK'}).click();await A.getByRole('status').filter({hasText:'Đã lưu'}).waitFor();
    const r6=probe().sdks[S(6)];check('W4 cùng mã, cùng VM, ô trống: Giữ nguyên, không thêm lịch sử',/Giữ nguyên/.test(await A.locator('.vm-bulk-result tr',{hasText:S(6)}).innerText())&&r6.events===ev&&r6.amount==='7'&&r6.revision===0);
  });
  // ════════ 4. Kiểm lại các luồng dán ════════
  await step('P',async()=>{
    await open(A);await paste(A,`VM_008 | ${S(7)} | 1\nVM_008 | ${S(8)}\nVM_002 | ${I.codes.used}`);await A.getByRole('button',{name:'Áp dụng 2 SDK'}).waitFor();
    check('P1 mã đã dùng không cấp lại (báo tại dòng)',/đã dùng/.test(await A.locator('.vm-bulk-result tr',{hasText:I.codes.used}).innerText()));
    await A.getByRole('button',{name:'Áp dụng 2 SDK'}).click();await A.getByRole('status').filter({hasText:'Đã lưu 2'}).waitFor();
    let p=probe();check('P2 nhiều SDK cùng một VM',p.sdks[S(7)]?.vm==='VM_008'&&p.sdks[S(8)]?.vm==='VM_008');
    await open(A);await paste(A,`VM_008 | ${S(7)} | 1\nVM_008 | ${S(8)}`);await A.waitForTimeout(500);
    check('P3 dán lại cùng danh sách: 0 SDK sẽ ghi, giữ nguyên, nút tắt',await A.getByRole('button',{name:'Áp dụng 0 SDK'}).isDisabled()&&probe().sdks[S(7)].events===p.sdks[S(7)].events);
    await open(A);await A.getByRole('button',{name:'Dán bảng'}).click();await A.getByRole('tab',{name:'SDK'}).click();await A.getByRole('radio',{name:'Chỉ SDK, theo khoảng VM'}).click();
    await A.getByLabel('VM bắt đầu').selectOption({label:'VM_011'});await A.getByLabel('Danh sách SDK dán').fill(`${S(9)}\n\n${S(10)}`);await A.waitForTimeout(2500);
    const rows=(await A.locator('.vm-bulk-result tbody tr').allInnerTexts()).map(t=>t.replace(/\s+/g,' '));
    check('P4 theo khoảng: VM_011 thêm, VM_012 dòng trống giữ vị trí, VM_013 không có (không dồn, không tạo)',/VM_011.*Thêm SDK mới/.test(rows[0])&&/VM_012.*Dòng trống/.test(rows[1])&&/VM_013.*Không có VM/.test(rows[2]),rows.join(' / '));
    await A.getByRole('button',{name:'Áp dụng 1 SDK'}).click();await A.getByRole('status').filter({hasText:'Đã lưu 1'}).waitFor();p=probe();
    check('P5 lưu đúng VM_011; không có mã nào vào VM_012',p.sdks[S(9)]?.vm==='VM_011'&&!p.sdks[S(10)]&&!Object.values(p.sdks).some(s=>s.vm==='VM_012'));await shot(A,'p5-range');
  });
  // ════════ 5. Đếm Chưa dùng ════════
  await step('K',async()=>{
    await open(A);const cell=A.locator(`[data-cell="${I.vms.VM_003}|sdk"]`),t=(await cell.innerText()).replace(/\s+/g,' ');
    check('K1 ô SDK: "3 SDK · 1 chưa dùng · 1 chưa xác nhận", mã hiện ra là mã thật sự chưa dùng',/3 SDK · 1 chưa dùng · 1 chưa xác nhận/.test(t)&&(await cell.locator('code').getAttribute('title'))===I.codes.free,t);
    const p=probe().sdks;check('K2 không đổi trạng thái dữ liệu cũ',p[I.codes.unconfirmed].state==='UNCONFIRMED'&&p[I.codes.unconfirmed].revision===0);await shot(A,'k1-counts');
  });
  // ════════ 6. Quyền: chỉ xem và ngoài dự án ════════
  const call=(p,proc,input,get=false)=>p.evaluate(async([proc,input,get])=>{const body=JSON.stringify({0:{json:input}});const r=get?await fetch('/api/trpc/'+proc+'?batch=1&input='+encodeURIComponent(body)):await fetch('/api/trpc/'+proc+'?batch=1',{method:'POST',headers:{'content-type':'application/json'},body});const j=await r.json();return JSON.stringify(j).slice(0,300);},[proc,input,get]);
  await step('V',async()=>{
    const V=await session(I.users['p28-view'].username,I.users['p28-view'].password);await open(V);
    check('V1 chỉ xem: không có nút Dán bảng',!(await V.getByRole('button',{name:'Dán bảng'}).count()));
    const d=await frame(V,'VM_003');const txt=await d.innerText();check('V2 chỉ xem: khung SDK báo Chỉ xem, không có ô thêm, không tick được',/Chỉ xem/.test(txt)&&!(await d.getByLabel('Mã SDK mới cho VM_003').count())&&await d.getByLabel('Đã dùng '+I.codes.free).isDisabled());await shot(V,'v2-viewer-frame');
    const before=JSON.stringify(probe().sdks);
    const r1=await call(V,'vmManagement.sdkListAdd',{projectId:I.project,key:crypto.randomUUID(),vmId:I.vms.VM_002,expectedCycle:1,code:S(20),expectedSdkRevision:null});
    const r2=await call(V,'vmManagement.sdkPasteApply',{projectId:I.project,key:crypto.randomUUID(),items:[{line:1,vmId:I.vms.VM_002,expectedCycle:1,code:S(21),expectedSdkRevision:null}]});
    check('V3 chỉ xem: endpoint thêm / dán bị từ chối, không ghi gì',/FORBIDDEN/.test(r1)&&/FORBIDDEN/.test(r2)&&JSON.stringify(probe().sdks)===before,r1.slice(0,120));
    const O=await session(I.users['p28-out'].username,I.users['p28-out'].password);
    await O.goto(base+'/infrastructure/servers/'+I.server);await O.waitForTimeout(4000);const body=await O.locator('body').innerText();
    check('O1 ngoài dự án: trang Server/VM không hiện server / SDK của dự án thử',!body.includes(SV)&&!body.includes(I.codes.free));
    const o1=await call(O,'vmManagement.sdkPastePreview',{projectId:I.project,mode:'VM',text:`VM_002 | ${S(22)}`,serverId:I.server}),o2=await call(O,'vmManagement.sdkListAdd',{projectId:I.project,key:crypto.randomUUID(),vmId:I.vms.VM_002,expectedCycle:1,code:S(22),expectedSdkRevision:null}),o3=await call(O,'vmManagement.workspace',{projectId:I.project},true);
    check('O2 ngoài dự án: xem trước, thêm và đọc đều bị từ chối, không ghi',[o1,o2,o3].every(r=>/FORBIDDEN|NOT_FOUND|UNAUTHORIZED/.test(r))&&JSON.stringify(probe().sdks)===before,[o1,o2,o3].map(r=>r.slice(0,80)).join(' | '));
  });
  log(`\nKết quả: ${ok_} đạt, ${fail} lỗi. Lỗi JS: ${errs.length?errs.join(' | '):'không'}`);await b.close();
})();
