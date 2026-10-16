import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
vi.mock('next/navigation',()=>({useSearchParams:()=>({get:()=>null,toString:()=>''}),useRouter:()=>({replace:()=>{}}),usePathname:()=>'/infrastructure/proxies'}));
vi.mock('@/lib/trpc',()=>{
  const q=(data:unknown)=>({useQuery:()=>({data,isLoading:false,error:null,refetch:async()=>({})})}),m=()=>({useMutation:()=>({mutateAsync:async()=>null,mutate:()=>{},isLoading:false,reset:()=>{},data:undefined,error:null})});
  return {trpc:{useUtils:()=>({businessManagement:{invalidate:async()=>{}},vmManagement:{invalidate:async()=>{}}}),proxyManagement:{catalog:q([]),saveCatalog:m()},businessManagement:{cashAccess:q({writeCosts:true}),cashInfrastructureChoices:q({servers:[],packages:[]}),lastCashRate:q(null),p2pQuote:q(null),nettedChoices:q([]),saveCashCost:m()}}};
});
import {PackageTable,packageHeading,type PackageRow} from '@/components/proxy-management/PackageDialog';
import {PackageChoice} from '@/components/proxy-management/BatchDialog';
const pkg=(o:Partial<PackageRow>):PackageRow=>({id:'a',code:'240292',label:'240292',site:'proxiware.com',note:null,price:'120',priceCurrency:'USD',cycleMonths:1,nextDueDate:'2026-10-19',lastPaidAt:null,disabled:false,revision:1,proxyCount:350,due:{state:'DUE_SOON' as const,daysLeft:3},reminderDays:7,renewalStoppedAt:null,renewalStopNote:null,reminder:true,priceHidden:false,...o});
it('package table lists site, price per cycle, due date with days left, proxy count and payment action',()=>{
  vi.stubGlobal('React',React);try{
    const html=renderToStaticMarkup(<PackageTable packages={[pkg({}),pkg({id:'b',code:'Account VietPhe',site:'vietphe.net',price:null,nextDueDate:'2026-10-01',due:{state:'OVERDUE',daysLeft:-15},proxyCount:200})]} canManage canPay onEdit={()=>{}} onPay={()=>{}}/>);
    expect(html).toContain('proxiware.com');expect(html).toContain('120 USD / 1 tháng');expect(html).toContain('19/10/2026');expect(html).toContain('còn 3 ngày');expect(html).toContain('350');
    expect(html).toContain('quá hạn 15 ngày');expect(html).toContain('Chưa có giá');expect((html.match(/Ghi thanh toán/g)||[]).length).toBe(2);expect(html).toContain('nhắc trước 7 ngày');
    const loading=renderToStaticMarkup(<PackageTable packages={[]} loading canManage canPay onEdit={()=>{}} onPay={()=>{}}/>);expect(loading).toContain('Đang tải gói');expect(loading).not.toContain('Chưa có gói proxy');
  }finally{vi.unstubAllGlobals();}
});
it('package heading for the registry group shows site, price and due state',()=>{
  expect(packageHeading(pkg({}))).toBe('proxiware.com · 120 USD / 1 tháng · đến hạn 19/10/2026 (còn 3 ngày)');
  expect(packageHeading(pkg({site:null,price:null,nextDueDate:null,due:{state:'NONE',daysLeft:null}}))).toBe('Chưa đặt ngày đến hạn');
  expect(packageHeading(pkg({nextDueDate:'2026-10-01',due:{state:'OVERDUE',daysLeft:-15}}))).toContain('quá hạn 15 ngày');
});
it('package choice on import offers auto detection, existing packages and a new package with name and site',()=>{
  vi.stubGlobal('React',React);try{
    const packages=[{id:'a',code:'240292'},{id:'b',code:'Account VietPhe'}];
    const auto=renderToStaticMarkup(<PackageChoice packages={packages} value={{mode:'AUTO'}} onChange={()=>{}}/>);
    expect(auto).toContain('Tự nhận theo user/pass');expect(auto).toContain('240292');expect(auto).toContain('Account VietPhe');expect(auto).toContain('Gói mới');expect(auto).not.toContain('Tên gói mới');
    const fresh=renderToStaticMarkup(<PackageChoice packages={packages} value={{mode:'NEW',code:'236273',site:'proxiware.com'}} onChange={()=>{}}/>);
    expect(fresh).toContain('Tên gói mới');expect(fresh).toContain('value="236273"');expect(fresh).toContain('value="proxiware.com"');
  }finally{vi.unstubAllGlobals();}
});
describe('package list filters and retire helpers',()=>{
  it('sorts nearest due first, separates overdue / no due / stopped packages and keeps disabled packages in due views',async()=>{
    const {filterPackages}=await import('@/components/proxy-management/PackageDialog');
    const list=[pkg({id:'a',code:'A',due:{state:'DUE_SOON',daysLeft:3}}),pkg({id:'b',code:'B',nextDueDate:'2026-10-10',due:{state:'OVERDUE',daysLeft:-6},disabled:true}),pkg({id:'c',code:'C',nextDueDate:null,due:{state:'NONE',daysLeft:null}}),pkg({id:'d',code:'D',reminder:false,renewalStoppedAt:'2026-10-01T00:00:00.000Z',due:{state:'OVERDUE',daysLeft:-1}})];
    expect(filterPackages(list,'DUE').map(p=>p.code)).toEqual(['B','A']);
    expect(filterPackages(list,'OVERDUE').map(p=>p.code)).toEqual(['B']);
    expect(filterPackages(list,'NO_DUE').map(p=>p.code)).toEqual(['C']);
    expect(filterPackages(list,'STOPPED').map(p=>p.code)).toEqual(['D']);
    expect(filterPackages(list,'ALL')).toHaveLength(4);
  });
  it('builds the retire reason from the quick pick or the free text',async()=>{
    const {retireReason,RETIRE_REASONS}=await import('@/components/proxy-management/RegistryEdit');
    expect(retireReason(RETIRE_REASONS[0],'ignored')).toBe('Hết hạn, không gia hạn');expect(retireReason('Khác…','  nhà cung cấp đổi IP ')).toBe('nhà cung cấp đổi IP');expect(retireReason('Khác…','  ')).toBe('');
  });
});
