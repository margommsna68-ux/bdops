// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {businessPulse,type PulseInput} from '@/lib/business-pulse';
import {BusinessPulse,type PulsePackage} from '@/components/dashboard/BusinessPulse';
const overviewMock=vi.hoisted(()=>({ops:{data:undefined,error:null,isLoading:false,isFetching:false,isPreviousData:false} as Record<string,unknown>,fin:{data:undefined,error:null,isLoading:false,isFetching:false,isPreviousData:false} as Record<string,unknown>,refetch:vi.fn(),push:vi.fn(),params:'month=2026-09&keep=1',options:[] as {part:string;options:Record<string,unknown>}[]}));
vi.mock('next/navigation',()=>({usePathname:()=>'/dashboard',useRouter:()=>({push:overviewMock.push}),useSearchParams:()=>new URLSearchParams(overviewMock.params)}));
vi.mock('@/lib/trpc',()=>({trpc:{useUtils:()=>({}),businessManagement:{
  overview:{useQuery:(input:{part:string},options:Record<string,unknown>)=>{overviewMock.options.push({part:input.part,options});return {...(input.part==='operations'?overviewMock.ops:overviewMock.fin),refetch:overviewMock.refetch};}},
  activateCash:{useMutation:()=>({isLoading:false,error:null})},
}}}));
vi.mock('@/components/dashboard/OverviewCharts',()=>({CashChart:()=>null,StockChart:()=>null,VmByServerChart:()=>null}));
import {Overview} from '@/components/dashboard/Overview';

const now=new Date('2026-10-26T05:00:00Z'),checked='2026-10-26T04:00:00Z',healthChecked='2026-10-26T04:55:00Z';
const vm=(id:string,amount:string|null,extra:Partial<PulseInput>={}):PulseInput=>({
  id,serverId:'moon-1',server:'MOON-01',code:id,cycle:1,status:'OK',hasAccount:true,hasPaypal:true,payout:false,
  health:{at:healthChecked,earning:true,problem:null},
  money:amount===null?null:{amount,observedAt:checked,failedAt:null},
  points:amount===null?[]:[{at:'2026-10-26T02:00:00Z',amount:'1'},{at:checked,amount}],...extra,
});
const inputs=[
  vm('VM-low','7.99'),vm('VM-soon','8'),vm('VM-soon-edge','9.99'),
  vm('VM-enough','10',{hasAccount:false,hasPaypal:false,payout:true}),
  vm('VM-flat','0',{points:[{at:'2026-10-26T02:00:00Z',amount:'0'},{at:checked,amount:'0'}]}),
  vm('VM-decreased','3',{payout:true,points:[{at:'2026-10-26T02:00:00Z',amount:'10'},{at:checked,amount:'3'}]}),
  vm('VM-unknown',null,{health:null}),
  vm('VM-error','12.3456',{serverId:'moon-2',server:'MOON-02',health:{at:healthChecked,earning:false,problem:'PROXY_AUTH'},points:[]}),
  vm('VM-paused','30',{status:'OFF'}),vm('VM-new','40',{status:'NEW_VM'}),
];
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('React',React);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const render=async(rows=inputs,moneyRead=true,packages:PulsePackage[]=[],costsVisible=true)=>{
  await act(async()=>root.render(<BusinessPulse pulse={businessPulse(rows,moneyRead,now)} packages={packages} costsVisible={costsVisible}/>));
};
const button=(label:string)=>host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click=async(label:string)=>{expect(button(label),label).not.toBeNull();await act(async()=>button(label).click());};
const list=()=>host.querySelector('[aria-label="Danh sách VM đã lọc"]')!;
const codes=()=>Array.from(list().querySelectorAll('a')).map(a=>a.textContent);
const server=async(value:string)=>{const el=host.querySelector<HTMLSelectElement>('[aria-label="Chọn server"]')!;await act(async()=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));});};

describe('business pulse drilldowns',()=>{
  it('prioritizes servers needing attention, collapses to five and preserves expansion on refresh',async()=>{
    const many=Array.from({length:7},(_,i)=>vm(`VM-server-${i}`,'10',{serverId:`s${i}`,server:`Server ${i}`,health:i===6?null:i===5?{at:healthChecked,earning:false,problem:'PROXY_AUTH'}:{at:healthChecked,earning:true,problem:null}}));
    await render(many);
    const names=()=>Array.from(host.querySelectorAll('.bp-server-name button')).map(b=>b.textContent);
    expect(names()).toHaveLength(5);expect(names().slice(0,2)).toEqual(['Server 5','Server 6']);
    await click('Xem cả 7 server');expect(names()).toHaveLength(7);
    await render([...many,vm('VM-extra','11',{serverId:'s6',server:'Server 6',health:null})]);
    expect(names()).toHaveLength(7);expect(names()[0]).toBe('Server 6');
    await click('Server 6 · Đủ tiền rút: 2 VM');expect(codes()).toEqual(['VM-server-6','VM-extra']);
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Chọn server"]')?.value).toBe('s6');
  });
  it('draws mutually exclusive health and money distributions from the same scoped rows',async()=>{
    await render();
    expect(host.querySelector('[aria-label="Phân bố VM hoạt động"]')?.textContent).toContain('75%');
    expect(host.querySelector('[aria-label="Phân bố tiền hôm nay"]')?.getAttribute('data-total')).toBe('8');
    await click('Dưới $8: 3 VM');expect(codes()).toEqual(['VM-low','VM-flat','VM-decreased']);
    await server('moon-2');
    expect(host.querySelector('[aria-label="Phân bố VM hoạt động"]')?.textContent).toContain('0%');
    expect(host.querySelector('[aria-label="Phân bố tiền hôm nay"]')?.getAttribute('data-total')).toBe('1');
    await click('Đủ tiền rút: 1 VM');expect(codes()).toEqual(['VM-error']);
  });
  it('does not draw a zero health rate for paused-only VMs, or financial charts for a restricted reader',async()=>{
    await render([vm('VM-paused','30',{status:'OFF'}),vm('VM-new','40',{status:'NEW_VM'})]);
    expect(host.querySelector('[aria-label="Phân bố VM hoạt động"]')?.textContent).not.toContain('0%');
    expect(host.querySelector('[aria-label="Phân bố VM hoạt động"]')?.textContent).toContain('Chưa hoạt động');
    await render(inputs,false);
    expect(host.querySelector('[aria-label="Phân bố tiền hôm nay"]')).toBeNull();
    expect(host.querySelector('.bp-thresholds')).toBeNull();
    expect(host.querySelector('.bp-server-growth')).toBeNull();
  });
  it('never rounds incomplete verification up to 100 percent healthy',async()=>{
    const many=Array.from({length:2000},(_,i)=>vm(`VM-${i}`,null));
    many[0]={...many[0],health:null};
    await render(many,false);
    expect(host.querySelector('[aria-label="Phân bố VM hoạt động"]')?.textContent).toContain('99,9%');
    await click('Chưa xác minh: 1 VM');expect(codes()).toEqual(['VM-0']);
  });
  it('keeps threshold boundaries and opens the exact VM/server detail',async()=>{
    await render();await click('Đủ tiền rút: 2 VM');expect(codes()).toEqual(['VM-enough','VM-error']);
    expect(list().querySelector('a')?.getAttribute('href')).toBe('/infrastructure/servers/moon-1?vm=VM-enough');
    expect(list().textContent).toContain('Chưa gán EarnApp');expect(list().textContent).toContain('Chưa có email PayPal');expect(list().textContent).toContain('Đã có yêu cầu rút');
    await click('Sắp đủ: 2 VM');expect(codes()).toEqual(['VM-soon','VM-soon-edge']);
  });
  it('uses the selected server for both summary and list, preserving filters across fresh data',async()=>{
    await render();await server('moon-1');await click('Đủ tiền rút: 1 VM');expect(codes()).toEqual(['VM-enough']);
    await render([...inputs,vm('VM-another','11')]);
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Chọn server"]')?.value).toBe('moon-1');
    expect(codes()).toEqual(['VM-enough','VM-another']);expect(button('Đủ tiền rút: 2 VM').getAttribute('aria-pressed')).toBe('true');
  });
  it('totals only the enough VMs in the selected server and updates with the same drilldown rows',async()=>{
    const withdrawal=()=>host.querySelector('[aria-labelledby="bp-withdrawal"]')!;
    await render();expect(withdrawal().textContent).toContain('Tiền trong 2 VM: $22,35');
    await server('moon-1');await click('Đủ tiền rút: 1 VM');expect(codes()).toEqual(['VM-enough']);
    expect(withdrawal().textContent).toContain('Tiền trong 1 VM: $10');expect(withdrawal().textContent).not.toContain('$22,35');
    await render([...inputs,vm('VM-another','11.111111')]);
    expect(codes()).toEqual(['VM-enough','VM-another']);expect(withdrawal().textContent).toContain('Tiền trong 2 VM: $21,11');
  });
  it('sums precise enough balances before rounding and excludes stale, failed, soon and paused amounts',async()=>{
    await render([vm('VM-a','10.004'),vm('VM-b','10.004'),vm('VM-soon','9.99'),vm('VM-paused','30',{status:'OFF'}),
      vm('VM-stale','100',{money:{amount:'100',observedAt:'2026-10-24T04:00:00Z',failedAt:null}}),
      vm('VM-failed','500',{money:{amount:'500',observedAt:checked,failedAt:'2026-10-26T04:30:00Z'}})]);
    expect(host.querySelector('[aria-labelledby="bp-withdrawal"]')?.textContent).toContain('Tiền trong 2 VM: $20,01');
    await click('Đủ tiền rút: 2 VM');expect(codes()).toEqual(['VM-a','VM-b']);
  });
  it('separates paused/new from active health and offers the actual observations',async()=>{
    await render();await click('Đang hoạt động: 8 VM');expect(codes()).toHaveLength(8);expect(codes()).not.toContain('VM-paused');
    await click('Đang kiếm tiền: 6 VM');expect(codes()).toHaveLength(6);
    expect(list().querySelector('time')?.dateTime).toBe(healthChecked);
    await click('Tạm dừng: 1 VM');expect(codes()).toEqual(['VM-paused']);
    await click('Chưa cài: 1 VM');expect(codes()).toEqual(['VM-new']);
  });
  it('shows partial coverage, a real zero, and decreases apart from flat readings',async()=>{
    await render();expect(host.textContent).toContain('5 / 8 VM');
    const growthCard=host.querySelector('[aria-labelledby="bp-growth"]')!;
    expect(growthCard.querySelector('[aria-label="Chưa thấy tăng: 1 VM"]')).not.toBeNull();
    expect(growthCard.querySelector('[aria-label="Chưa đủ lần đọc: 2 VM"]')).not.toBeNull();
    await click('Chưa thấy tăng: 1 VM');expect(codes()).toEqual(['VM-flat']);expect(list().textContent).toContain('$0');
    expect(list().textContent).not.toContain('ngừng kiếm tiền');
    await click('Số dư giảm: 1 VM');expect(codes()).toEqual(['VM-decreased']);expect(list().textContent).toContain('Có yêu cầu rút; đối chiếu lần giảm tiền');
    await click('Chưa đủ lần đọc: 2 VM');expect(codes()).toEqual(['VM-unknown','VM-error']);
  });
  it('labels the latest actual health observation separately from page generation',async()=>{
    await render();expect(host.querySelector<HTMLTimeElement>('[aria-labelledby="bp-health"] time')?.dateTime).toBe(healthChecked);
  });
  it('never turns missing or failed money into zero or withdrawal readiness',async()=>{
    await render([vm('VM-no-money',null,{health:null}),vm('VM-failed','20',{money:{amount:'20',observedAt:checked,failedAt:'2026-10-26T04:30:00Z'}})]);
    expect(host.querySelector('[aria-labelledby="bp-growth"]')?.textContent).toContain('Chưa đủ dữ liệu');
    await click('Chưa đủ lần đọc: 2 VM');expect(list().textContent).toContain('Chưa kiểm tra tiền');expect(list().textContent).toContain('Lần đọc gần nhất thất bại');
    expect(button('Đủ tiền rút: 0 VM')).not.toBeNull();expect(list().textContent).not.toContain('$0');
    expect(host.querySelector('[aria-labelledby="bp-withdrawal"]')?.textContent).not.toContain('$0');
  });
  it('does not render money, thresholds or account/PayPal details without money permission',async()=>{
    await render(inputs,false);expect(host.textContent).not.toMatch(/\$|Sắp đủ|Chưa gán EarnApp|Chưa có email PayPal/);
    await click('Đang hoạt động: 8 VM');expect(list().textContent).not.toMatch(/\$|Đã có yêu cầu rút/);
    expect(host.textContent).toContain('Chưa có quyền xem tiền');
  });
  it('server comparison opens its matching projection rows',async()=>{
    await render();await click('MOON-02 · Có lỗi: 1 VM');expect(codes()).toEqual(['VM-error']);
    expect(list().textContent).toContain('Proxy sai xác thực');
  });
  it('keeps reported web issues distinct from scan errors and unknowns, excludes paused/new, and follows server scope',async()=>{
    await render([
      vm('VM-reported',null,{recordedIssue:'Proxy đã báo Blocked'}),
      vm('VM-both',null,{serverId:'moon-2',server:'MOON-02',recordedIssue:'EarnApp lỗi',health:{at:healthChecked,earning:false,problem:'PROXY_AUTH'}}),
      vm('VM-unknown',null,{health:null}),
      vm('VM-paused',null,{status:'OFF',recordedIssue:'EarnApp lỗi'}),
      vm('VM-new',null,{status:'NEW_VM',recordedIssue:'Chưa có proxy'}),
    ],false);
    await click('Đã báo / chờ xử lý: 2 VM');expect(codes()).toEqual(['VM-reported','VM-both']);
    expect(list().textContent).toContain('Đã ghi trên web: Proxy đã báo Blocked');
    expect(list().textContent).toContain('Đã ghi trên web: EarnApp lỗi');expect(list().textContent).toContain('Proxy sai xác thực');
    expect(button('Đang kiếm tiền: 0 VM')).not.toBeNull();
    await click('Chưa xác minh: 2 VM');expect(codes()).toEqual(['VM-reported','VM-unknown']);
    await click('Có lỗi: 1 VM');expect(codes()).toEqual(['VM-both']);
    await server('moon-1');await click('Đã báo / chờ xử lý: 1 VM');expect(codes()).toEqual(['VM-reported']);
    expect(host.textContent).not.toContain('$');
  });
  it('shows no VMs explicitly, without a fabricated growth amount',async()=>{
    await render([]);expect(host.textContent).toContain('Chưa có VM trong phạm vi được xem');expect(host.textContent).not.toContain('$0');
  });
});

describe('proxy payment reminders',()=>{
  const packages:PulsePackage[]=[{id:'p1',code:'Gói A',daysLeft:2,dueAt:'2026-10-28',amount:'12.3456',currency:'USD',link:'/infrastructure/proxies?pay=p1'},
    {id:'p2',code:'Gói B',daysLeft:-1,dueAt:'2026-10-25',amount:null,currency:'USD',link:'/infrastructure/proxies?pay=p2'}];
  it('shows recorded due dates, days, rounded cost and missing costs with real links',async()=>{
    await render(inputs,true,packages);const section=host.querySelector('[aria-labelledby="bp-packages"]')!;
    expect(section.textContent).toContain('28/10/2026');expect(section.textContent).toContain('Còn 2 ngày');expect(section.textContent).toContain('Quá hạn 1 ngày');
    expect(section.textContent).toContain('$12,35');expect(section.textContent).toContain('Chưa ghi chi phí');
    expect(section.querySelector('a[href="/infrastructure/proxies?pay=p1"]')).not.toBeNull();
  });
  it('does not confuse restricted cost with a missing or zero price',async()=>{
    await render(inputs,true,packages,false);const text=host.querySelector('[aria-labelledby="bp-packages"]')!.textContent;
    expect(text).toContain('Chi phí được ẩn');expect(text).not.toMatch(/\$|12,35|Chưa ghi chi phí/);
  });
  it.each([
    ['USD_PAYPAL','12.3456','$12,35 PayPal'],
    ['VND','12345.6789','12.345,68 ₫'],
    ['USDT','12.3456','12,35 USDT'],
    ['USD','0','$0'],
  ])('renders the recorded %s currency with at most two decimals',async(currency,amount,expected)=>{
    await render(inputs,true,[{...packages[0],currency,amount}]);
    expect(host.querySelector('.bp-package-cost')?.textContent).toBe(expected);
    await render(inputs,true,[{...packages[0],currency,amount}],false);
    expect(host.querySelector('.bp-package-cost')?.textContent).toBe('Chi phí được ẩn');
  });
});

describe('Overview integration',()=>{
  const overviewData=()=>({generatedAt:now.toISOString(),month:'2026-09',rights:{admin:false,cashEnabled:true,costs:true},operations:{pulse:businessPulse(inputs,true,now),packages:[],totals:{servers:2,vms:10,ASSIGNED:10,BLOCKED:0,REVIEW:0,MISSING:0},servers:[],gaps:{noSdk:0,noAccount:0,noPaypal:0},stock:{total:0,rows:[],ready:{autofill:0,sharedManual:0}}},finance:{enabled:true,records:0,blockingCount:0,received:'0',cost:'0',net:'0',series:[]}});
  const overview=async()=>act(async()=>root.render(<Overview projectId="synthetic-project"/>));
  beforeEach(()=>{overviewMock.ops={data:overviewData(),error:null,isLoading:false,isFetching:false};overviewMock.fin={data:overviewData(),error:null,isLoading:false,isFetching:false};overviewMock.options=[];overviewMock.push.mockClear();});
  it('collapses legacy sections and refreshes operations without resetting a selected inline list',async()=>{
    await overview();expect(host.querySelector('.business-pulse')).not.toBeNull();
    const summaries=Array.from(host.querySelectorAll('details')).filter(d=>/Kho proxy|Tài chính/.test(d.querySelector('summary')?.textContent??''));
    expect(summaries).toHaveLength(2);expect(summaries.every(d=>!d.open)).toBe(true);
    expect(overviewMock.options.find(o=>o.part==='operations')?.options.refetchInterval).toBe(30000);
    await server('moon-1');await click('Sắp đủ: 2 VM');
    overviewMock.ops={...overviewMock.ops,data:{...overviewData(),generatedAt:'2026-10-26T05:00:30Z'}};
    await overview();expect(codes()).toEqual(['VM-soon','VM-soon-edge']);
    expect(host.textContent).toContain('Làm mới trang');expect(list().querySelector('time')?.dateTime).toBe(healthChecked);
    expect(overviewMock.push).not.toHaveBeenCalled();
  });
  it('places both errors above retained data and clearly labels the stale view',async()=>{
    overviewMock.ops.error={message:'internal diagnostic'};overviewMock.fin.error={message:'finance diagnostic'};
    await overview();const alerts=Array.from(host.querySelectorAll('[role="alert"]'));
    expect(alerts).toHaveLength(2);for(const alert of alerts){expect(alert.textContent).toContain('có thể đã cũ');expect(alert.compareDocumentPosition(host.querySelector('.business-pulse')!)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();}
    expect(host.textContent).not.toContain('internal diagnostic');
  });
  it('keeps unrelated URL state when the finance month changes',async()=>{
    await overview();const details=Array.from(host.querySelectorAll('details')).find(d=>d.querySelector('summary')?.textContent==='Tài chính theo tháng')!;
    await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'));});
    const month=host.querySelector<HTMLInputElement>('[aria-label="Tháng tài chính"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(month,'2026-08');month.dispatchEvent(new Event('input',{bubbles:true}));});
    expect(overviewMock.push).toHaveBeenCalledWith('/dashboard?month=2026-08&keep=1',{scroll:false});
    overviewMock.fin={...overviewMock.fin,isPreviousData:true,isFetching:true};await overview();
    expect(host.querySelector<HTMLDetailsElement>('details:has(summary)')?.open).toBe(false);
    const pending=Array.from(host.querySelectorAll('details')).find(d=>d.querySelector('summary')?.textContent==='Tài chính theo tháng');
    expect(pending?.open).toBe(true);expect(pending?.textContent).toContain('Đang tải tài chính');
    overviewMock.fin={...overviewMock.fin,isPreviousData:false,isFetching:false};await overview();
    expect(host.querySelector<HTMLInputElement>('[aria-label="Tháng tài chính"]')).not.toBeNull();
  });
  it('initial loading and first-load failure do not display zero summaries',async()=>{
    overviewMock.ops={data:undefined,error:null,isLoading:true,isFetching:true};overviewMock.fin={data:undefined,error:null,isLoading:true,isFetching:true};
    await overview();expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();expect(host.querySelector('.business-pulse')).toBeNull();
    overviewMock.ops={data:undefined,error:{message:'offline'},isLoading:false,isFetching:false};await overview();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(host.textContent).not.toMatch(/\$0|có thể đã cũ/);
  });
});
