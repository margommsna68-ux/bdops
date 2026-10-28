import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
vi.stubGlobal('React',React);
vi.mock('@/components/business-management/shared',()=>({BusinessDialog:({children}:any)=>children,SaveBar:()=>null,ErrorNotice:()=>null,useBusinessKey:()=>()=> 'key'}));
const mocks=vi.hoisted(()=>({save:vi.fn(),refetch:vi.fn(),queries:vi.fn()}));
const query=vi.hoisted(()=> (input?:unknown)=>{mocks.queries(input);return {data:undefined,isFetching:false,refetch:mocks.refetch};});
vi.mock('@/lib/trpc',()=>({trpc:{businessManagement:{p2pQuote:{useQuery:query},cashInfrastructureChoices:{useQuery:query},lastCashRate:{useQuery:query},nettedChoices:{useQuery:query},saveCashCost:{useMutation:()=>({isLoading:false,mutate:mocks.save})}},proxyManagement:{saveCatalog:{useMutation:()=>({isLoading:false})}}}}));
import {CostForm} from '@/components/business-management/UsdtCostsWorkspace';
import {PurchaseMoneyFields} from '@/components/account-store/PurchaseMoneyFields';
import {emptyPurchase} from '@/components/account-store/purchase-money';
import {PackageForm,priceLabel} from '@/components/proxy-management/PackageDialog';
describe('cost currency controls',()=>{
 it('offers exactly the owner currencies for a new purchase, with two blank PayPal rates',()=>{
  const html=renderToStaticMarkup(<PurchaseMoneyFields projectId="p" unitWord="PP" value={{...emptyPurchase(),currency:'PPUSD'}} onChange={()=>{}} locked={false}/>);
  expect([...html.matchAll(/<option[^>]*value="([^"]+)"/g)].map(m=>m[1])).toEqual(['VND','PPUSD','USDT']);
  expect(html).toContain('1 USD PayPal = ? VND');expect(html).toContain('1 USDT = ? VND');
  expect(html).not.toContain('value="24,000"');
 });
 it('new packages use the owner currencies; legacy USD is offered only for an existing USD package',()=>{
  const props={projectId:'p',onClose:()=>{},onSaved:()=>{}};
  const html=renderToStaticMarkup(<PackageForm {...props} row={null}/>);
  expect([...html.matchAll(/<option[^>]*value="([^"]+)"/g)].map(m=>m[1])).toEqual(['VND','PPUSD','USDT']);
  const old=renderToStaticMarkup(<PackageForm {...props} row={{priceCurrency:'USD'} as never}/>);
  expect(old).toContain('value="USD"');
 });
 it('cost forms expose two chain rates and restrict new currencies while preserving legacy USD edits',()=>{
  const props={projectId:'p',onClose:()=>{},onSaved:()=>{}};
  const html=renderToStaticMarkup(<CostForm {...props} preset={{category:'IP_PROXY',proxyAccountId:'pkg',currency:'PPUSD',amount:'250'}}/>);
  expect(html).toContain('1 USD PayPal = ? VND');expect(html).toContain('1 USDT = ? VND');
  expect(html).not.toContain('value="USD"');
  const old=renderToStaticMarkup(<CostForm {...props} row={{currency:'USD',amount:'250',rate:'1',date:'2026-10-23'} as never}/>);
  expect(old).toContain('value="USD"');
 });
 it('requires a new currency choice when paying a legacy USD package instead of silently using USD',()=>{
  const html=renderToStaticMarkup(<CostForm projectId="p" onClose={()=>{}} onSaved={()=>{}} preset={{category:'IP_PROXY',proxyAccountId:'pkg',currency:'USD',amount:'250'}}/>);
  expect(html).toContain('Chọn đồng tiền');
  expect(html).not.toContain('value="USD"');
 });
 it('preserves stored chain rates when editing and retains only the VND quote across PayPal-rate edits',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost'});
  const saved=new Map<string,PropertyDescriptor|undefined>();
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){
   saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const {createRoot}=await import('react-dom/client'),root=createRoot(document.getElementById('root')!);
  try{
   mocks.save.mockClear();mocks.refetch.mockResolvedValue({data:{rate:'25820',token:'sealed-vnd',fetchedAt:new Date().toISOString(),side:'BUY'}});
   await act(async()=>root.render(<CostForm projectId="p" onClose={()=>{}} onSaved={()=>{}} row={{id:'cost',currency:'PPUSD',amount:'250',rate:'1.075833333333',paypalVndRate:'24000',vndUsdtRate:'25820',date:'2026-10-23'} as never}/>));
   const field=(label:string)=>Array.from(document.querySelectorAll('label')).find(n=>n.textContent?.startsWith(label))!.querySelector('input')!;
   const fill=async(label:string,value:string)=>act(async()=>{const el=field(label);Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
   expect(field('1 USD PayPal = ? VND').value).toBe('24,000');expect(field('1 USDT = ? VND').value).toBe('25,820');
   expect(mocks.queries).toHaveBeenCalledWith({projectId:'p',currency:'VND',side:'BUY'});
   const fetch=Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='Lấy giá Binance P2P')!;
   await act(async()=>fetch.click());
   await fill('1 USD PayPal = ? VND','23,500');
   const submit=async()=>act(async()=>{document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
   await submit();
   expect(mocks.save.mock.calls.at(-1)![0]).toMatchObject({currency:'PPUSD',paypalVndRate:'23500',vndUsdtRate:'25820',p2pQuoteToken:'sealed-vnd',rate:undefined});
   await fill('1 USDT = ? VND','26,000');await submit();
   expect(mocks.save.mock.calls.at(-1)![0]).toMatchObject({paypalVndRate:'23500',vndUsdtRate:'26000',p2pQuoteToken:undefined,rate:undefined});
   await act(async()=>fetch.click());
   const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+600000);
   try{
    await fill('1 USD PayPal = ? VND','23,600');
    expect(document.body.textContent).toContain('Giá Binance đã hết hạn');
    const count=mocks.save.mock.calls.length;await submit();expect(mocks.save).toHaveBeenCalledTimes(count);
    const manual=Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='Giữ tỷ giá, ghi là nhập tay')!;
    await act(async()=>manual.click());await submit();
    expect(mocks.save.mock.calls.at(-1)![0]).toMatchObject({paypalVndRate:'23600',vndUsdtRate:'25820',p2pQuoteToken:undefined});
   }finally{clock.mockRestore();}
  }finally{await act(async()=>root.unmount());dom.window.close();for(const [key,value] of saved){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}}
 });
 it('formats PayPal and free package prices without hiding zero',()=>{
  expect(priceLabel({price:'250',priceCurrency:'PPUSD',cycleMonths:1})).toBe('$250.00 PayPal / 1 tháng');
  expect(priceLabel({price:'0',priceCurrency:'USDT',cycleMonths:1})).toBe('0.00 USDT / 1 tháng');
 });
});

it('preserves the immutable ordinary USD of an existing collector source',()=>{
 const html=renderToStaticMarkup(<CostForm projectId="p" source={{id:'s',currency:'USD',amount:'12',date:'2026-10-23'} as never} onClose={()=>{}} onSaved={()=>{}}/>);
 expect(html).toContain('value="USD" selected');expect(new JSDOM(html).window.document.querySelector('select')?.disabled).toBe(true);
});
