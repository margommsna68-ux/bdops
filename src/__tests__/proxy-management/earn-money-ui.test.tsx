import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
// Review fixes 20/10/2026 on "Tiền / Rút": a balance draft stays with the round + EarnApp it was started for; "Đã về PP" is the money
// really received. Synthetic ids only.
const mock=vi.hoisted(()=>({save:vi.fn(),refetch:vi.fn()}));
vi.mock('@/lib/trpc',()=>({trpc:{vmOps:{
  balanceRecord:{useMutation:()=>({mutateAsync:mock.save,isLoading:false})},
  balanceHistory:{useQuery:()=>({data:{rows:[]},refetch:mock.refetch})}
}}}));
vi.mock('react-hot-toast',()=>({default:{success:vi.fn(),error:vi.fn()}}));
import {BalanceSection,requestLine} from '@/components/vm-management/vm-grid/MoneyParts';
type Root={render:(n:React.ReactNode)=>void;unmount:()=>void};
let dom:JSDOM,container:HTMLDivElement,root:Root,createRoot:(c:Element)=>Root;
const saved=new Map<string,PropertyDescriptor|undefined>();
beforeAll(async()=>{
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/'});
  for(const [k,v] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true})){
    saved.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:v});
  }
  ({createRoot}=await import('react-dom/client') as unknown as {createRoot:(c:Element)=>Root});
});
beforeEach(()=>{
  vi.clearAllMocks();mock.save.mockResolvedValue({rows:[{outcome:'APPLIED',message:'Đã ghi'}]});
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
afterAll(()=>{dom.window.close();for(const [k,d] of saved){if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}});
const initial={vmId:'vm-synthetic',cycle:1,earnAppId:'ea-original',balance:{latest:null,lastOk:null}};
const render=async(changes:object={})=>act(async()=>root.render(<BalanceSection projectId="project-synthetic" vmCode="VM_001" ops={{...initial,...changes} as never} read write onSaved={()=>{}}/>));
const input=()=>container.querySelector('[aria-label="Số dư EarnApp VM_001"]') as HTMLInputElement;
async function fill(value:string){
  const el=input();
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
}
const button=(text:string)=>Array.from(container.querySelectorAll('button')).find(e=>e.textContent===text) as HTMLButtonElement|undefined;
const click=async(text:string)=>act(async()=>button(text)!.click());
describe('balance draft identity',()=>{
  it('a draft started for round 1 / account A is kept and locked when a reload shows round 2 / account B; nothing is sent',async()=>{
    await render();await fill('10');
    await render({cycle:2,earnAppId:'ea-new'});
    expect(input().value).toBe('10');
    expect(button('Lưu kiểm tra')!.disabled).toBe(true);
    expect(container.textContent).toMatch(/đổi tài khoản EarnApp hoặc sang lượt mới/);
    await click('Lưu kiểm tra');expect(mock.save).not.toHaveBeenCalled();
    // Recording for the new account is an explicit new check: empty form, new identity.
    await click('Ghi lần mới');expect(input().value).toBe('');
    await fill('3');await click('Lưu kiểm tra');
    expect(mock.save).toHaveBeenCalledTimes(1);expect(mock.save.mock.calls[0][0].items[0]).toMatchObject({expectedCycle:2,earnAppId:'ea-new',amount:'3'});
  });
  it('a lost answer retries the same content, identity and key',async()=>{
    mock.save.mockRejectedValueOnce(new Error('Mất kết nối'));
    await render();await fill('7');await click('Lưu kiểm tra');
    expect(container.textContent).toMatch(/Mất kết nối/);expect(input().value).toBe('7');
    await click('Lưu kiểm tra');
    const [a,b]=mock.save.mock.calls.map(c=>c[0]);
    expect(b.key).toBe(a.key);expect(b.items).toEqual(a.items);expect(b.items[0]).toMatchObject({expectedCycle:1,earnAppId:'ea-original',amount:'7'});
  });
});
describe('"Đã về PP" label',()=>{
  const line=(money:object)=>requestLine({request:{phase:'RECEIVED',paypal:'pp-synthetic',email:'test@example.invalid',money:{currency:'USD',remaining:'0.00',shortfall:null,...money}},milestone:'RECREATE'} as never)!;
  it('$10 asked, $6 received, settled short $4 → "Đã về PP $6,00" and the settled gap on the second line',()=>{
    const l=line({amount:'10.00',received:'6.00',shortfall:'4.00'});
    expect(l.text).toBe('Đã về PP $6,00');expect(l.sub).toMatch(/Đã chốt thiếu \$4,00/);expect(l.sub).toMatch(/Chờ tạo lại/);
  });
  it('$10 received in full → "Đã về PP $10,00", no gap line',()=>{
    const l=line({amount:'10.00',received:'10.00'});
    expect(l.text).toBe('Đã về PP $10,00');expect(l.sub).not.toMatch(/chốt thiếu/);
  });
});
