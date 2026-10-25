import React,{act} from 'react';
import type {Root} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({preview:vi.fn(),commit:vi.fn(),add:vi.fn(),quote:vi.fn(),batchCost:vi.fn()}));
vi.mock('@/lib/trpc',()=>({trpc:{accountStore:{importPreview:{useMutation:()=>({mutateAsync:mock.preview,isLoading:false})},importCommit:{useMutation:()=>({mutateAsync:mock.commit,isLoading:false})},addEmails:{useMutation:()=>({mutateAsync:mock.add,isLoading:false})},batchCost:{useMutation:()=>({mutate:mock.batchCost,isLoading:false,error:null})}},businessManagement:{p2pQuote:{useQuery:()=>({refetch:mock.quote})}}}}));
vi.mock('react-hot-toast',()=>({default:{success:vi.fn(),error:vi.fn()}}));
vi.mock('@/components/vm-management/shared',()=>({errorMessage:(e:Error)=>e.message}));
import {ImportPanel,importDraft} from '@/components/account-store/ImportPanel';
import {PurchaseMoneyFields} from '@/components/account-store/PurchaseMoneyFields';
import {BatchCostForm} from '@/components/account-store/AccountStore';
import {emptyPurchase,editQuantity,type PurchaseState} from '@/components/account-store/purchase-money';
let dom:JSDOM,root:Root,host:HTMLDivElement,projectId:string,kind:'LOGIN'|'PAYPAL';
const list='a@example.invalid|secret\nb@example.invalid|secret';
const previewResult=()=>({ready:2,exists:0,errors:0,rows:[{line:1,account:'a@example.invalid',outcome:'READY'},{line:2,account:'b@example.invalid',outcome:'READY'}],batch:{code:'TK-SYNTHETIC',cost:'NONE',existing:false}});
beforeEach(async()=>{
 dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/gmails'});
 for(const [key,value] of Object.entries({React,window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true}))vi.stubGlobal(key,value);
 const {createRoot}=await import('react-dom/client');host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);vi.useFakeTimers();
 projectId='autoquantity-'+Math.random();kind='LOGIN';mock.preview.mockReset().mockResolvedValue(previewResult());mock.commit.mockReset();mock.add.mockReset();mock.quote.mockReset();mock.batchCost.mockReset();
 importDraft(projectId,kind).values={type:'GMAIL',mode:'paste',text:list,money:{...emptyPurchase(),mode:'UNIT',unit:'2'}};
});
afterEach(async()=>{await act(async()=>root.unmount());vi.useRealTimers();dom.window.close();vi.unstubAllGlobals();});
const render=async()=>act(async()=>root.render(<ImportPanel projectId={projectId} kind={kind} canCost onDone={()=>{}} onClose={()=>{}} onDiscard={()=>{}}/>));
const settle=async()=>{await act(async()=>{await vi.advanceTimersByTimeAsync(450);});await act(async()=>{await vi.advanceTimersByTimeAsync(450);});};
function input(label:string){const labels=Array.from(host.querySelectorAll('label'));const el=labels.find(l=>l.textContent?.startsWith(label))?.querySelector('input');if(!el)throw Error('Missing '+label);return el;}
async function change(el:HTMLInputElement|HTMLTextAreaElement,text:string){await act(async()=>{const proto=el.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,text);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
async function click(text:string){const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text);if(!button)throw Error('Missing button '+text);await act(async()=>button.click());}
it('unit price with no entered quantity classifies without money before building the priced preview',async()=>{
 await render();await settle();
 expect(input('Số tài khoản thực mua').value).toBe('2');expect(mock.preview).toHaveBeenCalled();expect(mock.preview.mock.calls.find(([b])=>b.batch?.priceMode==='UNIT')?.[0].batch).toMatchObject({quantity:2,amount:'2',priceMode:'UNIT'});
 expect(host.textContent).toMatch(/4[.,]00/);expect(mock.quote).not.toHaveBeenCalled();
 expect(mock.preview.mock.calls.find(([b])=>b.batch?.priceMode==='UNIT')?.[0].batch.autoQuantity).toBe(true);
});
it('reclassifies and reprices when a new account becomes existing between classification and priced preview',async()=>{
 const changed={...previewResult(),ready:1,exists:1,rows:[previewResult().rows[0],{line:2,account:'b@example.invalid',outcome:'EXISTS'}]};
 let classifications=0;mock.preview.mockImplementation(async body=>body.batch?.priceMode==='NONE'&&++classifications===1?previewResult():changed);
 await render();await settle();
 expect(Array.from(host.querySelectorAll('button')).some(b=>b.textContent==='Nhập 1 dòng hợp lệ'&&!b.disabled)).toBe(false);
 await settle();await settle();
 expect(classifications).toBe(2);expect(input('Số tài khoản thực mua').value).toBe('1');
 expect(mock.preview.mock.calls.filter(([b])=>b.batch?.priceMode==='UNIT').map(([b])=>b.batch.quantity)).toEqual([2,1]);
 mock.commit.mockRejectedValue(new Error('synthetic lost answer'));await click('Nhập 1 dòng hợp lệ');expect(mock.commit.mock.calls[0][0].batch).toMatchObject({quantity:1,autoQuantity:true});
});
it('automatically reclassifies after the backend rejects stale AUTO quantity with CONFLICT',async()=>{
 const changed={...previewResult(),ready:1,exists:1,rows:[previewResult().rows[0],{line:2,account:'b@example.invalid',outcome:'EXISTS'}]};
 let classifications=0,pricedChecks=0;
 mock.preview.mockImplementation(async body=>{
  if(body.batch?.priceMode==='NONE')return ++classifications===1?previewResult():changed;
  if(++pricedChecks===1)throw Object.assign(new Error('AUTO quantity changed'),{data:{code:'CONFLICT'}});
  return changed;
 });
 await render();await settle();await settle();await settle();
 expect(classifications).toBe(2);expect(pricedChecks).toBe(2);expect(input('Số tài khoản thực mua').value).toBe('1');
 expect(mock.preview.mock.calls.filter(([b])=>b.batch?.priceMode==='UNIT').map(([b])=>b.batch.quantity)).toEqual([2,1]);
 expect(Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Nhập 1 dòng hợp lệ')?.disabled).toBe(false);
 expect(host.textContent).not.toContain('AUTO quantity changed');expect(mock.commit).not.toHaveBeenCalled();
});
it('compares READY identities even when their counts are equal',async()=>{
 const first={...previewResult(),ready:1,exists:1,rows:[previewResult().rows[0],{line:2,account:'b@example.invalid',outcome:'EXISTS'}]};
 const second={...first,rows:[{line:1,account:'a@example.invalid',outcome:'EXISTS'},previewResult().rows[1]]};
 let classifications=0;mock.preview.mockImplementation(async body=>body.batch?.priceMode==='NONE'&&++classifications===1?first:second);
 await render();await settle();await settle();await settle();
 expect(classifications).toBe(2);expect(mock.preview.mock.calls.filter(([b])=>b.batch?.priceMode==='UNIT')).toHaveLength(2);
 expect(input('Số tài khoản thực mua').value).toBe('1');
});
it('keeps AUTO blocked after a failed current refresh even with a matching cached classification and priced preview',async()=>{
 await render();await settle();expect(input('Số tài khoản thực mua').value).toBe('2');
 await act(async()=>root.render(<div/>));mock.preview.mockClear();mock.preview.mockRejectedValue(new Error('classification unavailable'));
 await render();await settle();await settle();
 expect(host.textContent).toContain('classification unavailable');expect(mock.preview.mock.calls.every(([b])=>b.batch?.priceMode==='NONE')).toBe(true);
 expect(Array.from(host.querySelectorAll('button')).filter(b=>b.className.includes('pm-button-primary')).every(b=>b.disabled||b.getAttribute('role')==='radio')).toBe(true);
 expect(mock.commit).not.toHaveBeenCalled();
 mock.preview.mockResolvedValue(previewResult());await click('Thử kiểm tra danh sách');await settle();await settle();
 expect(Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Nhập 2 dòng hợp lệ')?.disabled).toBe(false);
});
it('classifies mixed new PP and existing-email additions without money first; only the new PP enters the bill',async()=>{
 kind='PAYPAL';importDraft(projectId,kind).values={text:'PP-NEW new@example.invalid\nPP-OLD extra@example.invalid',money:{...emptyPurchase(),mode:'UNIT',unit:'3'}};
 const classified={ready:1,exists:0,errors:1,add:1,rows:[{line:1,account:'PP-NEW',outcome:'READY'},{line:2,account:'PP-OLD',outcome:'ADD',existingId:'old-pp',newEmails:['extra@example.invalid']},{line:3,account:'bad',outcome:'ERROR',message:'Bad row'}],batch:{code:'PP-SYNTHETIC',cost:'NONE',existing:false}};
 mock.preview.mockResolvedValue(classified);await render();await settle();await settle();
 expect(mock.preview.mock.calls[0][0].batch).toMatchObject({priceMode:'NONE',quantity:null,amount:null});
 expect(input('Số PP thực mua').value).toBe('1');expect(mock.preview.mock.calls.find(([b])=>b.batch?.priceMode==='UNIT')?.[0].batch).toMatchObject({quantity:1,amount:'3'});
 expect(host.textContent).toContain('1 dòng cần sửa');expect(host.textContent).toContain('Bổ sung 1 email vào PP-OLD');expect(host.textContent).toMatch(/3[.,]00/);
});
it('money-free classification still shows row errors and email additions when entered money is invalid',async()=>{
 kind='PAYPAL';importDraft(projectId,kind).values={text:'PP-OLD extra@example.invalid\ninvalid',money:{...emptyPurchase(),mode:'UNIT',unit:'bad'}};
 mock.preview.mockResolvedValue({ready:0,exists:0,errors:1,add:1,rows:[{line:1,account:'PP-OLD',outcome:'ADD',existingId:'old-pp',newEmails:['extra@example.invalid']},{line:2,account:'invalid',outcome:'ERROR',message:'Invalid code'}],batch:{code:'PP-SYNTHETIC',cost:'NONE',existing:false}});
 await render();await settle();expect(mock.preview.mock.calls[0][0].batch.priceMode).toBe('NONE');expect(mock.preview.mock.calls.some(([b])=>b.batch?.priceMode==='UNIT')).toBe(false);expect(host.textContent).toContain('1 dòng cần sửa');expect(host.textContent).toContain('Bổ sung 1 email vào PP-OLD');
});
it('manual actual quantity persists across list edits and remount until reset to list',async()=>{
 await render();await change(input('Số tài khoản thực mua'),'50');mock.preview.mockResolvedValue({...previewResult(),ready:1,rows:[previewResult().rows[0]]});await change(host.querySelector('textarea')!,'a@example.invalid|secret');await settle();
 expect(input('Số tài khoản thực mua').value).toBe('50');expect(importDraft(projectId,kind).values.money).toMatchObject({quantity:'50',quantityMode:'MANUAL'});
 expect(mock.preview.mock.calls.filter(([b])=>b.batch?.priceMode==='UNIT').every(([b])=>b.batch.autoQuantity===undefined)).toBe(true);
 await act(async()=>root.render(<div/>));await render();expect(input('Số tài khoản thực mua').value).toBe('50');
 await click('Dùng số lượng danh sách');await settle();expect(input('Số tài khoản thực mua').value).toBe('1');expect(importDraft(projectId,kind).values.money).toMatchObject({quantityMode:'AUTO'});
});
it('restores auto mode and counts PP codes rather than receiving emails',async()=>{
 kind='PAYPAL';importDraft(projectId,kind).values={text:'Mã PP Email\nPP-1 a@example.invalid b@example.invalid\npp-1 c@example.invalid\nPP-2 d@example.invalid\ninvalid',money:{...emptyPurchase(),mode:'UNIT',unit:'3'}};
 await render();await settle();expect(input('Số PP thực mua').value).toBe('2');expect(mock.preview.mock.calls.find(([b])=>b.batch?.priceMode==='UNIT')?.[0].batch.quantity).toBe(2);
 await act(async()=>root.render(<div/>));mock.preview.mockResolvedValue({...previewResult(),ready:1,rows:[previewResult().rows[0]]});await render();await change(host.querySelector('textarea')!,'PP-1 a@example.invalid');await settle();expect(input('Số PP thực mua').value).toBe('1');
});
it('keeps total actually paid unchanged when the list or manual quantity changes',async()=>{
 importDraft(projectId,kind).values.money={...emptyPurchase(),total:'120'};await render();await change(input('Số tài khoản thực mua'),'50');await change(host.querySelector('textarea')!,'a@example.invalid|secret');await settle();
 expect(input('Tổng tiền thực trả').value).toBe('120');expect(mock.preview.mock.lastCall?.[0].batch).toMatchObject({amount:'120',quantity:50,priceMode:'TOTAL'});
 expect(mock.preview.mock.lastCall?.[0].batch).not.toHaveProperty('autoQuantity');
});
it('freezes automatic quantity during an uncertain save and retries the identical request/key',async()=>{
 mock.commit.mockRejectedValue(new Error('lost response'));await render();await settle();await click('Nhập 2 dòng hợp lệ');
 expect(input('Số tài khoản thực mua').disabled).toBe(true);expect(input('Số tài khoản thực mua').value).toBe('2');await click('Thử lại');
 expect(mock.commit.mock.calls[1][0]).toEqual(mock.commit.mock.calls[0][0]);expect(importDraft(projectId,kind).values.money).toMatchObject({quantity:'2',quantityMode:'AUTO'});
});
it('partial save keeps original purchased quantity while only error lines remain; append has no second cost',async()=>{
 mock.commit.mockResolvedValue({applied:1,exists:0,errors:1,rows:[{line:1,outcome:'READY'},{line:2,outcome:'ERROR'}],batch:{id:'batch-one',code:'TK-SYNTHETIC',costRecorded:true}});
 await render();await settle();await click('Nhập 2 dòng hợp lệ');await settle();
 expect(host.querySelector('textarea')!.value).toBe('b@example.invalid|secret');expect(importDraft(projectId,kind).values.money).toMatchObject({quantity:'2',quantityMode:'AUTO'});
 expect(mock.preview.mock.lastCall?.[0]).toMatchObject({append:{batchId:'batch-one'}});expect(mock.preview.mock.lastCall?.[0]).not.toHaveProperty('batch');
});
it('completes a cost-free partial append after the retained purchase quote expires',async()=>{
 const originalMoney={...emptyPurchase(),mode:'UNIT' as const,unit:'50.000',currency:'VND',rate:'25.000',quote:{rate:'25000',token:'synthetic-quote',fetchedAt:new Date().toISOString(),side:'BUY' as const}};
 importDraft(projectId,kind).values.money=originalMoney;
 mock.commit.mockResolvedValueOnce({applied:1,exists:0,errors:1,rows:[{line:1,outcome:'READY'},{line:2,outcome:'ERROR'}],batch:{id:'batch-one',code:'TK-SYNTHETIC',costRecorded:true}});
 await render();await settle();await click('Nhập 2 dòng hợp lệ');await settle();
 expect(mock.commit.mock.calls[0][0].batch).toMatchObject({priceMode:'UNIT',quantity:2,p2pQuoteToken:'synthetic-quote'});
 expect(host.querySelectorAll('input[inputmode="decimal"]')).toHaveLength(0);
 await act(async()=>{await vi.advanceTimersByTimeAsync(11*60*1000);});
 mock.preview.mockResolvedValue({...previewResult(),ready:1,rows:[{line:1,account:'corrected@example.invalid',outcome:'READY'}]});
 await change(host.querySelector('textarea')!,'corrected@example.invalid|secret');await settle();
 expect(importDraft(projectId,kind).values.money).toMatchObject({...originalMoney,quantity:'2'});
 expect(mock.preview.mock.lastCall?.[0]).toMatchObject({append:{batchId:'batch-one'},text:'corrected@example.invalid|secret'});
 mock.commit.mockResolvedValueOnce({applied:1,exists:0,errors:0,rows:[{line:1,outcome:'READY'}],batch:{id:'batch-one',code:'TK-SYNTHETIC',appended:true,costRecorded:false}});
 await click('Nhập 1 dòng hợp lệ');
 expect(mock.commit).toHaveBeenCalledTimes(2);expect(mock.commit.mock.calls[1][0]).toMatchObject({append:{batchId:'batch-one'},text:'corrected@example.invalid|secret'});
 expect(mock.commit.mock.calls[1][0]).not.toHaveProperty('batch');expect(mock.quote).not.toHaveBeenCalled();
});
it('keeps leftover ADD rows in the same cost-free batch when a priced PP import succeeds without errors',async()=>{
 kind='PAYPAL';importDraft(projectId,kind).values={text:'PP-NEW new@example.invalid\nPP-OLD extra@example.invalid',money:{...emptyPurchase(),mode:'UNIT',unit:'3'}};
 mock.preview.mockResolvedValue({ready:1,exists:0,errors:0,add:1,rows:[{line:1,account:'PP-NEW',outcome:'READY'},{line:2,account:'PP-OLD',outcome:'ADD',existingId:'old-pp',newEmails:['extra@example.invalid']}],batch:{code:'PP-SYNTHETIC',cost:'NONE',existing:false}});
 mock.commit.mockResolvedValueOnce({applied:1,emails:1,exists:0,errors:0,rows:[{line:1,outcome:'READY'},{line:2,outcome:'ADD'}],batch:{id:'batch-mixed',code:'PP-SYNTHETIC',costRecorded:true}});
 await render();await settle();await click('Nhập 1 PP (0 email)');await settle();
 expect(importDraft(projectId,kind).values.money).toMatchObject({unit:'3',quantity:'1'});
 expect(host.querySelector('textarea')!.value).toBe('PP-OLD extra@example.invalid');
 mock.preview.mockResolvedValue({ready:1,emails:1,exists:0,errors:0,rows:[{line:1,account:'PP-CORRECTED',outcome:'READY'}],batch:{code:'PP-SYNTHETIC',existing:true,cost:'RECORDED'}});
 await change(host.querySelector('textarea')!,'PP-CORRECTED extra@example.invalid');await settle();
 mock.commit.mockResolvedValueOnce({applied:1,emails:1,exists:0,errors:0,rows:[{line:1,outcome:'READY'}],batch:{id:'batch-mixed',code:'PP-SYNTHETIC',appended:true,costRecorded:false}});
 await click('Nhập 1 PP (1 email)');
 expect(mock.commit).toHaveBeenCalledTimes(2);expect(mock.commit.mock.calls[0][0].batch).toMatchObject({priceMode:'UNIT',amount:'3',quantity:1});
 expect(mock.commit.mock.calls[1][0]).toMatchObject({append:{batchId:'batch-mixed'},text:'PP-CORRECTED extra@example.invalid'});
 expect(mock.commit.mock.calls[1][0]).not.toHaveProperty('batch');
});
it('existing PP email additions still bypass purchase cost and do not rewrite manual actual quantity',async()=>{
 kind='PAYPAL';importDraft(projectId,kind).values={text:'PP-1 a@example.invalid',money:editQuantity({...emptyPurchase(),mode:'UNIT',unit:'3'},'50')};
 mock.preview.mockResolvedValue({ready:0,exists:0,errors:0,add:1,rows:[{line:1,account:'PP-1',outcome:'ADD',existingId:'old-pp',newEmails:['a@example.invalid']}],batch:{code:'PP-SYNTHETIC',cost:'NONE',existing:false}});
 mock.add.mockResolvedValue({applied:1,errors:0,code:'PP-1'});await render();await settle();await click('Bổ sung 1 email vào PP-1');
 expect(mock.add.mock.calls[0][0]).toMatchObject({paypalId:'old-pp',emails:['a@example.invalid']});expect(mock.add.mock.calls[0][0]).not.toHaveProperty('batch');expect(mock.commit).not.toHaveBeenCalled();expect(input('Số PP thực mua').value).toBe('50');
});
it('waits for matching classification before a priced preview and ignores a slow reply for an old list',async()=>{
 let resolveOld!:(r:ReturnType<typeof previewResult>)=>void;
 mock.preview.mockImplementation(async b=>{if(b.batch?.priceMode==='NONE'&&b.text===list)return new Promise(resolve=>{resolveOld=resolve;});return {...previewResult(),ready:1,rows:[previewResult().rows[0]]};});
 await render();await act(async()=>{await vi.advanceTimersByTimeAsync(450);});
 expect(mock.preview.mock.calls.some(([b])=>b.batch?.priceMode==='UNIT')).toBe(false);
 await change(host.querySelector('textarea')!,'a@example.invalid|secret');await settle();expect(input('Số tài khoản thực mua').value).toBe('1');
 await act(async()=>resolveOld(previewResult()));await settle();expect(input('Số tài khoản thực mua').value).toBe('1');
 expect(mock.preview.mock.calls.filter(([b])=>b.batch?.priceMode==='UNIT').every(([b])=>b.batch.quantity===1)).toBe(true);
});
it('offers the optional suggestion/reset contract to a proxy purchase without account-specific behavior',async()=>{
 let suggested=3;
 function ProxyMoney(){const [value,onChange]=React.useState<PurchaseState>({...emptyPurchase(),mode:'UNIT',unit:'2'});return <PurchaseMoneyFields projectId="proxy-purchase" unitWord="proxy" value={value} onChange={onChange} locked={false} suggestedQuantity={suggested}/>;}
 await act(async()=>root.render(<ProxyMoney/>));expect(input('Số proxy thực mua').value).toBe('3');
 await change(input('Số proxy thực mua'),'50');suggested=4;await act(async()=>root.render(<ProxyMoney/>));expect(input('Số proxy thực mua').value).toBe('50');
 await click('Dùng số lượng danh sách');expect(input('Số proxy thực mua').value).toBe('4');expect(host.textContent).toMatch(/8[.,]00/);
});
it('Ghi chi phí defaults an unpriced PP batch to PP received count, not its email count',async()=>{
 const batch={id:'batch-six-pp',code:'PP-SIX',revision:0,kind:'PAYPAL',received:6,emails:30,paidQuantity:null,purchasedAt:'2026-10-25',cost:'NONE'};
 await act(async()=>root.render(<BatchCostForm projectId={projectId} batch={batch as never} onClose={()=>{}} onSaved={()=>{}}/>));
 expect(input('Số PP thực mua').value).toBe('6');await click('Tính theo giá mỗi PP');await change(input('Giá mỗi PP'),'2');
 expect(host.textContent).toMatch(/12[.,]00/);await act(async()=>{host.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
 expect(mock.batchCost.mock.calls[0][0]).toMatchObject({batchId:batch.id,priceMode:'UNIT',amount:'2',quantity:6});
});
it('Ghi chi phí preserves paid quantity/manual edits across received-count changes until explicit reset',async()=>{
 const batch={id:'batch-paid50',code:'TK-50',revision:0,kind:'LOGIN',received:48,emails:null,paidQuantity:50,purchasedAt:'2026-10-25',cost:'NONE'};
 const show=async()=>act(async()=>root.render(<BatchCostForm projectId={projectId} batch={batch as never} onClose={()=>{}} onSaved={()=>{}}/>));
 await show();expect(input('Số tài khoản thực mua').value).toBe('50');await change(input('Tổng tiền thực trả'),'120');await change(input('Số tài khoản thực mua'),'51');batch.received=47;await show();expect(input('Số tài khoản thực mua').value).toBe('51');expect(input('Tổng tiền thực trả').value).toBe('120');
 await click('Dùng số lượng danh sách');expect(input('Số tài khoản thực mua').value).toBe('47');expect(input('Tổng tiền thực trả').value).toBe('120');
});
