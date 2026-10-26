// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {BusinessPulse} from '@/components/dashboard/BusinessPulse';
import {businessPulse,type PulseInput} from '@/lib/business-pulse';
it('shows independent actual axis coverage and Central/agent source freshness without assuming earning',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('React',React);
 const host=document.createElement('div'),root=createRoot(host),now=new Date('2026-10-26T10:00:00Z'),at='2026-10-26T09:59:00Z';
 const v:PulseInput={id:'v',serverId:'s',server:'moon05',code:'VM_001',cycle:1,status:'OK',hasAccount:false,hasPaypal:false,payout:false,money:null,points:[],health:{at,receivedAt:'2026-10-26T09:59:10Z',earning:null,problem:null,monitor:{configVersion:1,vmState:{observedAt:at,state:'RUNNING'}}}};
 const pulse={...businessPulse([v,{...v,id:'missing-uuid',health:null}],false,now),heartbeats:[{serverId:'s',server:'moon05',central:{freshness:'FRESH' as const,observedAt:at,receivedAt:'2026-10-26T09:59:10Z',configVersion:1,counts:{managed:91,inventory:91,guest:0,proxy:0,app:0}},agent:{freshness:'UNKNOWN' as const,observedAt:null,receivedAt:null,configVersion:null,counts:null}}]};
 try{
  await act(async()=>root.render(<BusinessPulse pulse={pulse} packages={[]} costsVisible={false}/>));
  const monitor=host.querySelector('[aria-label="Độ mới giám sát"]');expect(monitor).not.toBeNull();
  expect(monitor!.textContent).toContain('VM 1/2');expect(monitor!.textContent).toContain('Guest 0/2');expect(monitor!.textContent).toContain('Mạng 0/2');expect(monitor!.textContent).toContain('Proxy 0/2');
  expect(monitor!.textContent).toContain('Central: Còn liên lạc');expect(monitor!.textContent).toContain('Agent: Chưa rõ');
  expect(monitor!.textContent).toContain('Đang chạy: 1');expect(monitor!.textContent).toContain('Ứng dụng / SDK có kết nối: 0');
  expect(monitor!.textContent).toContain('Chưa xác minh kiếm tiền: 2');expect(monitor!.textContent).toContain('Web nhận');
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
