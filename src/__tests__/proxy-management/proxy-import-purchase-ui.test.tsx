import React,{act} from 'react';
import type {Root} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({preview:vi.fn(),commit:vi.fn(),close:vi.fn(),imported:vi.fn(),quote:vi.fn(),writeCosts:true}));
vi.mock('@/lib/trpc',()=>({trpc:{proxyManagement:{catalog:{useQuery:()=>({data:[],refetch:vi.fn()})},groups:{useQuery:()=>({data:[],refetch:vi.fn()})},preview:{useMutation:()=>({mutateAsync:mock.preview,isLoading:false})},commit:{useMutation:()=>({mutateAsync:mock.commit,isLoading:false})}},businessManagement:{cashAccess:{useQuery:()=>({data:{writeCosts:mock.writeCosts}})},p2pQuote:{useQuery:()=>({refetch:mock.quote})}}}}));
vi.mock('@/components/ui/dialog',()=>({Dialog:({children}:any)=><div>{children}</div>,DialogContent:({children}:any)=><div>{children}</div>,DialogHeader:({children}:any)=><header>{children}</header>,DialogTitle:({children}:any)=><h2>{children}</h2>,DialogDescription:({children}:any)=><p>{children}</p>}));
vi.mock('@/components/proxy-management/RegistryEdit',()=>({GroupChoiceSelect:({disabled}:any)=><select aria-label="Từ nhóm" disabled={disabled}><option>TUT</option></select>}));
vi.mock('@/components/proxy-management/HistoryPanel',()=>({HistoryPanel:()=>null}));
import {BatchDialog,countFullProxyQuantity} from '@/components/proxy-management/BatchDialog';
const first='203.0.113.10:5432:fake:fake',second='203.0.113.11:5432:fake:fake',third='203.0.113.12:5432:fake:fake';
const ready=(row=1)=>({row,outcome:'READY',newIp:'203.0.113.'+(row+9),message:'Hợp lệ',sourceRefs:[],packageCode:'KNOWN'});
const preview=(rows:any[]=[ready()])=>({token:'preview-original',kind:'NEW',rows,ready:rows.filter(r=>r.outcome==='READY').length,errors:rows.filter(r=>r.outcome==='ERROR').length,duplicates:0,skipped:0,expiresAt:'2099-01-01'});
const withPurchase=(p:any,input:any)=>input.purchase?{...p,purchase:{purchasedAt:input.purchase.purchasedAt,priceMode:input.purchase.priceMode,quantity:input.purchase.quantity??p.ready,total:input.purchase.amount,usdt:input.purchase.amount,currency:input.purchase.currency}}:p;
const pricedInputs=()=>mock.preview.mock.calls.map(call=>call[0]).filter(input=>input.purchase);
let dom:JSDOM,root:Root,host:HTMLDivElement;
beforeEach(async()=>{dom=new JSDOM('<html><body></body></html>',{url:'http://localhost'});for(const [key,value] of Object.entries({React,window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true}))vi.stubGlobal(key,value);host=document.createElement('div');document.body.appendChild(host);const {createRoot}=await import('react-dom/client');root=createRoot(host);vi.clearAllMocks();mock.writeCosts=true;mock.preview.mockImplementation(async input=>withPurchase(preview(),input));mock.commit.mockResolvedValue({batchId:'batch-original',rows:[ready()],applied:1,errors:0,skipped:0,replay:false});mock.quote.mockResolvedValue({data:{rate:'25820',token:'quote',side:'BUY',fetchedAt:new Date().toISOString()}});});
afterEach(async()=>{await act(async()=>root.unmount());dom.window.close();vi.unstubAllGlobals();});
const render=async(kind:'NEW'|'BLOCKED'|'REPLACE'|'SHEET'='NEW')=>act(async()=>root.render(<BatchDialog projectId="synthetic-project" kind={kind} onClose={mock.close} onSaved={()=>{}} onImported={mock.imported}/>));
const button=(name:string)=>{const el=Array.from(host.querySelectorAll('button')).find(e=>e.textContent===name);if(!el)throw Error('Missing button '+name);return el;};
const click=async(name:string)=>act(async()=>button(name).click());
const labelInput=(name:string)=>{const el=Array.from(host.querySelectorAll('label')).find(e=>e.textContent?.startsWith(name))?.querySelector('input,select,textarea');if(!el)throw Error('Missing field '+name);return el as HTMLInputElement;};
const cost=()=>labelInput('Ghi chi phí mua proxy');
const paste=()=>host.querySelector('textarea')!;
async function fill(el:HTMLInputElement|HTMLTextAreaElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
async function choose(label:string,value:string){await act(async()=>{const el=labelInput(label);el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});}
const enableCost=async()=>act(async()=>cost().click());
it('counts only normalized full unique proxy endpoints, not blanks, invalid rows, bare IPs or repeated credentials',()=>{
  expect(countFullProxyQuantity(`${first}\n\ninvalid\n203.0.113.20\n203.000.113.010:05432:fake:fake\n${second}\n203.0.113.10:5432:other:other`)).toBe(2);
  expect(countFullProxyQuantity('')).toBe(0);
});
it('cost is optional and absent outside NEW; importing without it sends no purchase payload',async()=>{
  await render('BLOCKED');expect(host.textContent).not.toContain('Ghi chi phí mua proxy');await render('NEW');await fill(paste(),first);await click('Kiểm tra và lưu');expect(mock.preview.mock.calls[0][0]).not.toHaveProperty('purchase');
});
it('unit price multiplies auto quantity and a manual quantity stays sticky until reset to the list',async()=>{
  await render();await fill(paste(),first+'\n'+second);await enableCost();await click('Tính theo giá mỗi proxy');await fill(labelInput('Giá mỗi proxy'),'1,25');
  expect(labelInput('Số proxy thực mua').value).toBe('2');expect(host.textContent).toContain('2 proxy × 1.25 USDT = 2.50 USDT');
  await fill(paste(),first+'\n'+second+'\n'+third);expect(labelInput('Số proxy thực mua').value).toBe('3');
  await fill(labelInput('Số proxy thực mua'),'5');await fill(paste(),first);expect(labelInput('Số proxy thực mua').value).toBe('5');
  await click('Dùng số lượng danh sách');expect(labelInput('Số proxy thực mua').value).toBe('1');await click('Kiểm tra và lưu');
  expect(pricedInputs()[0].purchase).toMatchObject({priceMode:'UNIT',amount:'1.25',currency:'USDT'});expect(pricedInputs()[0].purchase.quantity).toBeUndefined();
});
it('TOTAL remains the amount actually paid when the automatic quantity changes',async()=>{
  await render();await fill(paste(),first);await enableCost();await fill(labelInput('Tổng tiền thực trả'),'10');await fill(paste(),first+'\n'+second);expect(labelInput('Tổng tiền thực trả').value).toBe('10');
  mock.preview.mockImplementation(async input=>withPurchase(preview([ready(),ready(2)]),input));await click('Kiểm tra và lưu');expect(pricedInputs()[0].purchase).toMatchObject({priceMode:'TOTAL',amount:'10',currency:'USDT'});expect(host.querySelector('[data-testid="proxy-purchase-preview"]')?.textContent).toContain('2 proxy');
});
it('lost commit replies freeze all original content and retry exactly the original token and key',async()=>{
  await render();await fill(paste(),first);await enableCost();await fill(labelInput('Tổng tiền thực trả'),'10');mock.commit.mockRejectedValueOnce(new Error('Failed to fetch'));await click('Kiểm tra và lưu');
  expect(paste().disabled).toBe(true);expect(labelInput('Tổng tiền thực trả').disabled).toBe(true);expect(cost().disabled).toBe(true);expect(labelInput('Gói proxy').disabled).toBe(true);expect(labelInput('Ngày nhận').disabled).toBe(true);expect(button('Huỷ').disabled).toBe(true);
  await fill(paste(),second);expect(paste().value).toBe(first);await click('Lưu 1 dòng hợp lệ');expect(mock.preview).toHaveBeenCalledTimes(2);expect(mock.commit.mock.calls[1][0]).toEqual(mock.commit.mock.calls[0][0]);
});
it('partial success records purchase once; correcting and retrying refused rows never sends purchase again',async()=>{
  const bad={row:2,outcome:'ERROR',newIp:'',message:'Sai định dạng',sourceRefs:[],packageCode:'KNOWN'};
  mock.preview.mockImplementationOnce(async()=>preview([ready(),bad])).mockImplementationOnce(async input=>withPurchase(preview([ready(),bad]),input));mock.commit.mockResolvedValueOnce({batchId:'batch-original',rows:[ready(),bad],applied:1,errors:1,skipped:0,replay:false});
  await render();await fill(paste(),first+'\nbad line');await enableCost();await click('Tính theo giá mỗi proxy');await fill(labelInput('Giá mỗi proxy'),'2');await click('Kiểm tra và lưu');await click('Lưu 1 dòng hợp lệ');
  expect(paste().value).toBe('bad line');expect(host.textContent).toContain('không ghi thêm chi phí');expect(host.textContent).not.toContain('Ghi chi phí mua proxy');
  await fill(paste(),second);mock.commit.mockRejectedValueOnce(new Error('Lost reply'));await click('Kiểm tra và lưu');expect(mock.preview.mock.calls[2][0]).not.toHaveProperty('purchase');
  await click('Lưu 1 dòng hợp lệ');expect(mock.commit.mock.calls[2][0]).toEqual(mock.commit.mock.calls[1][0]);expect(pricedInputs()).toHaveLength(1);expect(pricedInputs()[0].purchase).toMatchObject({amount:'2'});
});
it('shared currency/rate validation blocks incomplete purchase and preserves both PayPal USD rates',async()=>{
  await render();await fill(paste(),first);await enableCost();await fill(labelInput('Tổng tiền thực trả'),'25');await choose('Đồng tiền','PPUSD');
  expect(button('Kiểm tra và lưu').disabled).toBe(true);await fill(labelInput('1 USD PayPal = ? VND'),'24.000');await fill(labelInput('1 USDT = ? VND'),'25.820');await click('Kiểm tra và lưu');
  expect(pricedInputs()[0].purchase).toMatchObject({amount:'25',currency:'PPUSD',paypalVndRate:'24000',vndUsdtRate:'25820'});
});
it('an already-owned input reduces the matched auto count and cannot bill the earlier quantity; actual invoice override stays explicit',async()=>{
  const duplicate={...ready(2),outcome:'ERROR',code:'CURRENT_IP',message:'Đã có trong kho'};
  mock.preview.mockImplementation(async input=>withPurchase(preview([ready(),duplicate]),input));
  await render();await fill(paste(),first+'\n'+second);await enableCost();await click('Tính theo giá mỗi proxy');await fill(labelInput('Giá mỗi proxy'),'3');await click('Kiểm tra và lưu');
  expect(labelInput('Số proxy thực mua').value).toBe('1');expect(pricedInputs()).toHaveLength(0);expect(mock.commit).not.toHaveBeenCalled();expect(button('Lưu 1 dòng hợp lệ').disabled).toBe(true);expect(host.textContent).toContain('Chưa ghi chi phí');
  await fill(labelInput('Số proxy thực mua'),'5');await click('Kiểm tra và lưu');expect(pricedInputs()[0].purchase).toMatchObject({amount:'3',quantity:5});expect(mock.commit).not.toHaveBeenCalled();
});
it('if stock changes between the count-only and priced previews, no stale priced quantity can be committed',async()=>{
  mock.preview.mockImplementationOnce(async()=>preview([ready(),ready(2)])).mockImplementationOnce(async input=>({...withPurchase(preview([ready(),{...ready(2),outcome:'ERROR',code:'CURRENT_IP',message:'Vừa nhập ở nơi khác'}]),input),purchase:{quantity:2,total:'6',usdt:'6',currency:'USDT'}}));
  await render();await fill(paste(),first+'\n'+second);await enableCost();await click('Tính theo giá mỗi proxy');await fill(labelInput('Giá mỗi proxy'),'3');await click('Kiểm tra và lưu');
  expect(mock.commit).not.toHaveBeenCalled();expect(button('Lưu 1 dòng hợp lệ').disabled).toBe(true);expect(labelInput('Số proxy thực mua').value).toBe('1');
});
it('import-only users never see or send purchase fields',async()=>{
  mock.writeCosts=false;await render();expect(host.textContent).not.toContain('Ghi chi phí mua proxy');await fill(paste(),first);await click('Kiểm tra và lưu');expect(pricedInputs()).toHaveLength(0);expect(mock.quote).not.toHaveBeenCalled();
});
it.each(['CONFLICT','BAD_REQUEST'])('a first definitive %s refusal unlocks editing and requires a fresh preview before writing',async code=>{
  await render();await fill(paste(),first);await enableCost();await fill(labelInput('Tổng tiền thực trả'),'10');
  mock.commit.mockRejectedValueOnce(Object.assign(new Error('Bản kiểm tra chưa hợp lệ'),{data:{code,httpStatus:code==='CONFLICT'?409:400}}));await click('Kiểm tra và lưu');
  expect(paste().disabled).toBe(false);expect(labelInput('Tổng tiền thực trả').disabled).toBe(false);expect(button('Kiểm tra và lưu').disabled).toBe(false);
  const old=mock.commit.mock.calls[0][0];await fill(labelInput('Tổng tiền thực trả'),'20');await click('Kiểm tra và lưu');
  expect(mock.commit.mock.calls[1][0].idempotencyKey).not.toBe(old.idempotencyKey);expect(pricedInputs().at(-1).purchase.amount).toBe('20');
});
it('a 502 followed by a 403 remains UNKNOWN and frozen, preserving the first token/key through a later replay',async()=>{
  await render();await fill(paste(),first);await enableCost();await fill(labelInput('Tổng tiền thực trả'),'10');
  mock.commit.mockRejectedValueOnce(Object.assign(new Error('Gateway lost reply'),{data:{code:'INTERNAL_SERVER_ERROR',httpStatus:502}})).mockRejectedValueOnce(Object.assign(new Error('Quyền vừa bị thu hồi'),{data:{code:'FORBIDDEN',httpStatus:403}}));
  await click('Kiểm tra và lưu');const original=mock.commit.mock.calls[0][0];await click('Lưu 1 dòng hợp lệ');
  expect(paste().disabled).toBe(true);expect(cost().disabled).toBe(true);expect(labelInput('Tổng tiền thực trả').disabled).toBe(true);expect(mock.commit.mock.calls[1][0]).toEqual(original);
  await click('Lưu 1 dòng hợp lệ');expect(mock.commit.mock.calls[2][0]).toEqual(original);expect(mock.preview).toHaveBeenCalledTimes(2);expect(pricedInputs()).toHaveLength(1);
});
