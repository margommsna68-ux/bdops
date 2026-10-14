import {expect,it} from 'vitest';
import {buildReconciliation} from '@/server/proxy-management/reconcile';
import type {ProxyContext,SheetSnapshot} from '@/server/proxy-management/types';
const ctx:ProxyContext={identities:[],endpoints:[],evidence:[],history:[],receipts:[],source:{id:'s',sourceKey:'GENJY',hash:'hash',fetchedAt:'2026-10-14T00:00:00Z',scanSucceeded:true}};
it('preserves VM blanks/formulas/placeholders and does not turn lookup history into stock',()=>{
  const input:SheetSnapshot={snapshots:[],rows:[
    {sourceRef:'final!A1',rawValue:'192.0.2.72:80:u:p',proxy:{ip:'192.0.2.72',port:80,username:'u',password:'p',format:'FULL'},kind:'CURRENT_INVENTORY',owner:'SELF',subgroup:null,vmKey:null,valueState:'FULL'},
    {sourceRef:'Total!A1',rawValue:'old PC note',proxy:{ip:'192.0.2.72',port:null,username:null,password:null,format:'BARE'},kind:'LOOKUP_HISTORY',owner:'GENJY',subgroup:'PC_CHUNG',vmKey:null,valueState:'UNRESOLVED'},
    ...(['BLANK','FORMULA','PLACEHOLDER','UNRESOLVED'] as const).map((valueState,i)=>({sourceRef:`vm!B${i+1}`,rawValue:valueState==='BLANK'?'':'ko có VM',proxy:null,kind:'VM' as const,owner:'UNKNOWN' as const,subgroup:null,vmKey:`server/VM_${i+1}`,valueState})),
  ]};
  const plan=buildReconciliation(input,ctx);expect(plan.rows.filter(r=>r.outcome==='READY')).toHaveLength(1);
  expect(plan.ownership).toEqual([{ip:'192.0.2.72',owner:'SELF',subgroup:null,sourceRefs:['final!A1']}]);
  expect(plan.vmRefs.map(r=>r.valueState)).toEqual(['BLANK','FORMULA','PLACEHOLDER','UNRESOLVED']);
  expect(JSON.stringify(plan)).not.toContain(':u:p');
});
it('never downgrades Genjy and reports conflicting current ownership',()=>{
  const input:SheetSnapshot={snapshots:[],rows:[{sourceRef:'final!A2',rawValue:'192.0.2.73:80:u:p',proxy:{ip:'192.0.2.73',port:80,username:'u',password:'p',format:'FULL'},kind:'CURRENT_INVENTORY',owner:'SELF',subgroup:null,vmKey:null,valueState:'FULL'}]};
  const result=buildReconciliation(input,{...ctx,identities:[{id:'g',ip:'192.0.2.73',owner:'GENJY',subgroup:null,revision:1,allocationMode:'SINGLE_IP'}]});
  expect(result.ownership[0].owner).toBe('GENJY');expect(result.rows[0]).toMatchObject({outcome:'ERROR',code:'OWNER_CONFLICT'});
});
it('reports every conflicting current credential variant and refuses new stock while source is unavailable',()=>{
  const row={sourceRef:'final!A3',rawValue:'192.0.2.75:80:u:p',proxy:{ip:'192.0.2.75',port:80,username:'u',password:'p',format:'FULL' as const},kind:'CURRENT_INVENTORY' as const,owner:'SELF' as const,subgroup:null,vmKey:null,valueState:'FULL' as const};
  const conflict=buildReconciliation({snapshots:[],rows:[row,{...row,sourceRef:'registry!A3',proxy:{...row.proxy,password:'other'}}]},ctx);
  expect(conflict.rows.every(r=>r.outcome==='ERROR'&&r.code==='DUPLICATE_INPUT')).toBe(true);
  const failed=buildReconciliation({snapshots:[],rows:[row]},{...ctx,source:{...ctx.source,scanSucceeded:false}});
  expect(failed.rows[0]).toMatchObject({outcome:'ERROR',code:'SOURCE_UNAVAILABLE'});
});
