import {expect,it,vi} from 'vitest';
import {fetchGenjySnapshot,scanWorkbook} from '@/server/proxy-management/sources';
it('scans hidden tabs, embedded full proxies, bare notes and row metadata',()=>{
  const s=scanWorkbook({spreadsheetId:'fixture',tabs:[{id:'1',name:'PC',hidden:true,cells:[{a1:'A1',row:1,column:1,value:'note 192.0.2.70:80:u:p'},{a1:'B1',row:1,column:2,value:'198.51.100.70',note:'manual note'},{a1:'H1',row:1,column:8,value:'BLOCKED'}]}]},'GENJY');
  expect(s.scanSucceeded).toBe(true);expect(s.tabs?.[0].hidden).toBe(true);
  expect(s.evidence).toHaveLength(2);expect(s.evidence[0]).toMatchObject({owner:'GENJY',subgroup:'PC_CHUNG',hasFullCredentials:true,hasManualMetadata:true});
  expect(s.evidence[1]).toMatchObject({format:'BARE',hasManualMetadata:true});
  expect(scanWorkbook({spreadsheetId:'fixture',tabs:[{id:'1',name:'PC',hidden:true,cells:[]}]},'GENJY').hash).not.toBe(s.hash);
});
it('requests every tab with authenticated grid fields; failed fetch is not an empty successful source',async()=>{
  vi.stubEnv('FIXTURE_ACCESS_TOKEN','test-token');
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({spreadsheetId:'fixture',sheets:[{properties:{sheetId:1,title:'hidden',hidden:true},data:[{rowData:[{values:[{effectiveValue:{stringValue:'192.0.2.71'}}]}]}]}]}),{status:200}));
  const source={key:'GENJY',spreadsheetId:'fixture',credentialRef:'FIXTURE',mode:'GOOGLE_AUTH' as const};
  const snapshot=await fetchGenjySnapshot(source,{fetch:fetcher});expect(snapshot.evidence[0].ip).toBe('192.0.2.71');
  const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toContain('includeGridData=true');expect(url).not.toContain('ranges=');expect(options.headers).toMatchObject({Authorization:'Bearer test-token'});
  const failure=await fetchGenjySnapshot(source,{fetch:async()=>new Response('',{status:403})});expect(failure.scanSucceeded).toBe(false);expect(failure.evidence).toEqual([]);
  vi.unstubAllEnvs();
});
it('inline status/date and arbitrary metadata columns keep bare Genjy completion blocked',()=>{
  const source=scanWorkbook({spreadsheetId:'fixture',tabs:[{id:'1',name:'PC',hidden:false,cells:[
    {a1:'A1',row:1,column:1,value:'198.51.100.200 BLOCKED 2026-10-01'},
    {a1:'A2',row:2,column:1,value:'198.51.100.202'},
    {a1:'D2',row:2,column:4,value:'replace pending'},
  ]}]},'GENJY');
  expect(source.evidence.map(e=>[e.ip,e.hasManualMetadata])).toEqual([['198.51.100.200',true],['198.51.100.202',true]]);
});
it('malformed full suffix cannot erase the valid IPv4 Genjy reservation',()=>{
  const source=scanWorkbook({spreadsheetId:'fixture',tabs:[{id:'1',name:'PC',hidden:false,cells:[{a1:'A1',row:1,column:1,value:'198.51.100.201:65536:u:p'}]}]},'GENJY');
  expect(source.evidence).toHaveLength(1);expect(source.evidence[0]).toMatchObject({ip:'198.51.100.201',owner:'GENJY',format:'BARE',hasFullCredentials:false,hasManualMetadata:true});
});
