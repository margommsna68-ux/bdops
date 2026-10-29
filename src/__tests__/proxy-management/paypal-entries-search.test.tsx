// @vitest-environment jsdom
import React,{act} from 'react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {createRoot,type Root} from 'react-dom/client';
const mock=vi.hoisted(()=>({entries:vi.fn()}));
vi.mock('@/lib/trpc',()=>({trpc:{accountStore:{ledgerEntries:{useQuery:mock.entries}}}}));
vi.mock('next/link',()=>({default:({children}:{children:React.ReactNode})=><a>{children}</a>}));
import {Entries} from '@/components/account-store/PaypalStock';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const row=(id:string,tx:string|null)=>({kind:'RECEIPT',id,date:'2026-10-28',amount:'5.00',currency:'USD',counted:true,email:id+'@x.invalid',other:null,place:null,status:'Đã nhận',role:null,review:null,fee:null,received:null,transactionId:tx});
it('filters the PayPal ledger list by a pasted transaction id with its label',async()=>{
  mock.entries.mockReturnValue({data:{rows:[row('a','8JR02442V10816200'),row('b','5XY99999Z00000001'),row('c',null)],totals:{USD:'10.00'},asOf:null,later:0},isLoading:false,error:null});
  await act(async()=>root.render(<Entries projectId="p" p={{id:'pp',code:'pp-1'} as never} direction="IN" month={null} asOf={null} onClose={()=>{}}/>));
  const trs=()=>host.querySelectorAll('tbody tr').length;
  expect(trs()).toBe(3);
  const input=host.querySelector('input[aria-label="Tìm theo mã giao dịch"]') as HTMLInputElement;
  const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  await act(async()=>{set.call(input,'Mã giao dịch: 8jr02442v10816200');input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(trs()).toBe(1);expect(host.textContent).toContain('a@x.invalid');expect(host.textContent).not.toContain('b@x.invalid');
  await act(async()=>{set.call(input,'NOPE');input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(host.textContent).toContain('Không có giao dịch khớp mã này.');
});
