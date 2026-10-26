// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({query:vi.fn(),refetch:vi.fn()}));
vi.mock('next/link',()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock('@/lib/trpc',()=>({trpc:{vmOps:{payoutDashboard:{useQuery:mock.query}}}}));
import {PayoutSummary} from '@/components/dashboard/PayoutSummary';
const card=(amount:string,vms:number)=>({vms,requests:vms+1,amounts:[{currency:'USD',amount}]});
const data=()=>({available:true,day:'2026-10-26',updatedAt:'2026-10-26T09:00:00Z',cards:{sent:card('32.12',2),waiting:card('14.00',1),received:card('6.00',1),attention:card('12.00',1)}});
let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);mock.query.mockReset().mockReturnValue({data:data(),error:null,isLoading:false,isFetching:false,refetch:mock.refetch});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const render=(serverId='')=>act(async()=>root.render(<PayoutSummary projectId="project" serverId={serverId}/>));
it('shows four distinct metrics with exact server and day drilldowns',async()=>{await render('moon');expect(host.textContent).toContain('$32.12');expect(host.textContent).toContain('$6.00');expect(host.textContent).toContain('2 VM');expect(host.textContent).toContain('Giờ Việt Nam');for(const view of ['SENT_TODAY','WAITING','RECEIVED_TODAY','ATTENTION']){const a=host.querySelector<HTMLAnchorElement>(`a[href*="view=${view}"]`)!;expect(a).toBeTruthy();const url=new URL(a.href);expect(url.searchParams.get('server')).toBe('moon');if(view.endsWith('TODAY'))expect(url.searchParams.get('day')).toBe('2026-10-26');expect(url.searchParams.has('from')).toBe(false);}expect(mock.query.mock.calls[0][0]).toEqual({projectId:'project',serverId:'moon'});});
it('keeps receipt currencies separate',async()=>{const d=data();d.cards.received.amounts.push({currency:'USDT',amount:'2.00'});mock.query.mockReturnValue({data:d});await render();const a=host.querySelector('a[href*="RECEIVED_TODAY"]')!;expect(a.textContent).toContain('$6.00');expect(a.textContent).toContain('2.00 USDT');expect(a.textContent).not.toContain('$8.00');});
it('never shows cached money after error or no-rights response',async()=>{mock.query.mockReturnValue({data:data(),error:{message:'Denied'},refetch:mock.refetch});await render();expect(host.textContent).not.toContain('$32.12');expect(host.querySelector('[role="alert"]')).toBeTruthy();mock.query.mockReturnValue({data:{available:false}});await render();expect(host.textContent).toBe('');});
it('loading does not pretend there are zero requests',async()=>{mock.query.mockReturnValue({isLoading:true});await render();expect(host.textContent).toContain('Đang tải');expect(host.textContent).not.toContain('$0.00');expect(host.querySelector('a[href*="view="]')).toBeNull();});
it('an empty successful read shows zero without inventing currency',async()=>{const d=data();for(const c of Object.values(d.cards)){c.vms=0;c.requests=0;c.amounts=[];}mock.query.mockReturnValue({data:d});await render();expect(host.querySelectorAll('.ps-metric')).toHaveLength(4);expect(host.textContent).toContain('0 VM');expect(host.textContent).toContain('Chưa có khoản nhận');expect(host.textContent).not.toContain('$0.00');});
