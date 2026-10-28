// @vitest-environment jsdom
import React,{act} from 'react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {createRoot,type Root} from 'react-dom/client';
const mock=vi.hoisted(()=>({find:vi.fn()}));
vi.mock('@/lib/trpc',()=>({trpc:{vmOps:{findByTransaction:{useQuery:mock.find}}}}));
import {TxLookupOffer} from '@/components/vm-management/vm-grid/TxLookupOffer';
import {looksLikeTxId,txQuery} from '@/lib/paypal-tx';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);mock.find.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});

it('recognises PayPal transaction ids, with or without the pasted label, and leaves IP:port alone',()=>{
  expect(looksLikeTxId('8JR02442V10816200')).toBe(true);
  expect(looksLikeTxId('Mã giao dịch: 8JR02442V10816200')).toBe(true);
  expect(txQuery('Mã giao dịch: 8JR02442V10816200')).toBe('8JR02442V10816200');
  expect(txQuery('1.2.3.4:8080')).toBe('1.2.3.4:8080');
  for(const s of ['VM_062','062','moon1','12345678901234','ABCDEFGHIJKLMN','8JR0 2442V10816200','8JR02442V108162001234'])expect(looksLikeTxId(s)).toBe(false);
});

it('offers "Mở VM có giao dịch" when the grid is empty and the query looks like a tx id, then opens that VM',async()=>{
  mock.find.mockReturnValue({data:{vmId:'vm-1',serverId:'s-1',serverCode:'MOON-02',requestId:'r-1',receipt:{transactionId:'8JR02442V10816200',amount:'3.00',currency:'USD',status:'VOIDED'}},isFetching:false,error:null});
  const onOpen=vi.fn();
  await act(async()=>root.render(<TxLookupOffer projectId="p" query="Mã giao dịch: 8JR02442V10816200" empty currentServerId="s-other" onOpen={onOpen}/>));
  expect(mock.find).toHaveBeenLastCalledWith({projectId:'p',transactionId:'8JR02442V10816200'},expect.objectContaining({enabled:true}));
  expect(host.textContent).toContain('VM ở server MOON-02');expect(host.textContent).toContain('đã thu hồi');
  const b=Array.from(host.querySelectorAll('button')).find(x=>x.textContent==='Mở VM có giao dịch 8JR02442V10816200')!;expect(b).toBeTruthy();
  await act(async()=>b.click());expect(onOpen).toHaveBeenCalledWith('vm-1');
});

it('does not ask the server when rows were found or the query is not a tx id; says so when nothing has that id',async()=>{
  mock.find.mockReturnValue({data:undefined,isFetching:false,error:null});
  await act(async()=>root.render(<TxLookupOffer projectId="p" query="8JR02442V10816200" empty={false} onOpen={vi.fn()}/>));
  expect(mock.find).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({enabled:false}));expect(host.textContent).toBe('');
  await act(async()=>root.render(<TxLookupOffer projectId="p" query="moon1" empty onOpen={vi.fn()}/>));
  expect(mock.find).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({enabled:false}));
  await act(async()=>root.render(<TxLookupOffer projectId="p" query="8JR_2442V10816200" empty onOpen={vi.fn()}/>));
  expect(mock.find).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({enabled:false}));expect(host.textContent).toBe('');
  mock.find.mockReturnValue({data:null,isFetching:false,error:null});
  await act(async()=>root.render(<TxLookupOffer projectId="p" query="8JR02442V10816200" empty onOpen={vi.fn()}/>));
  expect(host.textContent).toContain('Không có yêu cầu rút nào có mã giao dịch 8JR02442V10816200');
  expect(host.querySelector('button')).toBeNull();
});
