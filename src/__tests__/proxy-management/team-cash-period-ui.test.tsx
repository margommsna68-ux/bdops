import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({rows:[] as object[]}));
vi.mock('@/lib/trpc',()=>({trpc:{useUtils:()=>({}),businessManagement:{cashAccess:{useQuery:()=>({data:{profit:true,writeProfit:true,admin:true}})},cashPeriods:{useQuery:()=>({data:state.rows})},cashSummary:{useQuery:()=>({})}}}}));
import {TeamCashProfitWorkspace} from '@/components/business-management/TeamCashProfitWorkspace';
it('keeps calculation and settlement controls after reopening managed historical periods, and leaves unmanaged rows read-only',()=>{
 vi.stubGlobal('React',React);
 const period={id:'p',start:'2026-09-01',end:'2026-09-30',currency:'USD',basis:'WITHDRAWN',received:'0',cost:'0',net:'0',revision:2,allocations:[]};
 try{
  state.rows=[{...period,businessManaged:true,settled:false}];let html=renderToStaticMarkup(<TeamCashProfitWorkspace projectId="p"/>);expect(html).toContain('Tính lại');expect(html).toContain('Chốt kỳ');
  state.rows=[{...period,businessManaged:true,settled:true}];html=renderToStaticMarkup(<TeamCashProfitWorkspace projectId="p"/>);expect(html).toContain('Mở lại kỳ');
  state.rows=[{...period,businessManaged:false,settled:true}];html=renderToStaticMarkup(<TeamCashProfitWorkspace projectId="p"/>);expect(html).not.toContain('Mở lại kỳ');expect(html).not.toContain('Tính lại');
 }finally{vi.unstubAllGlobals();}
});
