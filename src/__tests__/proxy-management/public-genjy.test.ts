import {expect,it,vi} from 'vitest';
import * as XLSX from 'xlsx';
import {fetchGenjySnapshot} from '@/server/proxy-management/sources';
import {fetchPublicWorkbook} from '@/server/proxy-management/public-workbook';

const source={key:'GENJY',spreadsheetId:'1_GenjyTestWorkbook',credentialRef:'UNUSED',mode:'GOOGLE_PUBLIC_XLSX' as const};
function workbook(){
  const book=XLSX.utils.book_new();
  const pc=XLSX.utils.aoa_to_sheet([['192.0.2.41:5432:u:p'],['198.51.100.42']]);
  pc.A2.c=[{a:'operator',t:'old IP 203.0.113.43'}];
  XLSX.utils.book_append_sheet(book,pc,'PCchung');
  const hidden=XLSX.utils.aoa_to_sheet([['203.0.113.44']]);
  hidden['!ref']='A1:B1'; hidden.B1={t:'s',v:'reference',f:'HYPERLINK("http://192.0.2.45", "reference")'};
  XLSX.utils.book_append_sheet(book,hidden,'GenjyArchive');
  book.Workbook={Sheets:[{name:'PCchung',Hidden:0},{name:'GenjyArchive',Hidden:1}]};
  return XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Buffer;
}
it('reads every public Genjy tab including hidden sheets, notes and formula references without credentials',async()=>{
  const fetcher=vi.fn(async(_url:string|URL|Request,_options?:RequestInit)=>new Response(new Uint8Array(workbook()),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}}));
  expect((await fetchPublicWorkbook(source.spreadsheetId,async()=>new Response(new Uint8Array(workbook())))).tabs).toHaveLength(2);
  const result=await fetchGenjySnapshot(source,{fetch:fetcher});
  expect(result.scanSucceeded).toBe(true);
  expect(new Set(result.evidence.map(e=>e.ip))).toEqual(new Set(['192.0.2.41','198.51.100.42','203.0.113.43','203.0.113.44','192.0.2.45']));
  expect(result.tabs?.find(t=>t.name==='GenjyArchive')?.hidden).toBe(true);
  expect(result.evidence.find(e=>e.ip==='192.0.2.41')).toMatchObject({owner:'GENJY',subgroup:'PC_CHUNG',hasFullCredentials:true});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('https://docs.google.com/spreadsheets/d/1_GenjyTestWorkbook/export?format=xlsx');
  expect((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1]).not.toHaveProperty('headers.Authorization');
});
it.each([
  ['unavailable',()=>new Response('',{status:403})],
  ['login HTML',()=>new Response('<html>Sign in</html>')],
  ['oversized header',()=>new Response('PK',{headers:{'content-length':String(21*1024*1024)}})],
  ['oversized body',()=>new Response(new Uint8Array(21*1024*1024))],
])('fails closed for %s',async(_name,response)=>{
  const result=await fetchGenjySnapshot(source,{fetch:async()=>response()});
  expect(result.scanSucceeded).toBe(false);expect(result.evidence).toEqual([]);
});
it('rejects an invalid spreadsheet ID without making a network request',async()=>{
  const fetcher=vi.fn();const result=await fetchGenjySnapshot({...source,spreadsheetId:'../../elsewhere'},{fetch:fetcher});
  expect(result.scanSucceeded).toBe(false);expect(fetcher).not.toHaveBeenCalled();
});
function corruptPart(name:string){
  const zip=XLSX.CFB.read(workbook(),{type:'buffer'});
  const index=zip.FullPaths.findIndex((path:string)=>path.endsWith('/'+name));
  if(index<0)throw Error('Fixture part missing');
  zip.FileIndex[index].content=Buffer.from('not valid xml');zip.FileIndex[index].size=13;
  return XLSX.CFB.write(zip,{fileType:'zip',type:'buffer'}) as Buffer;
}
it.each(['xl/worksheets/sheet2.xml','xl/comments1.xml'])('rejects a partial scan when %s is malformed',async name=>{
  const result=await fetchGenjySnapshot(source,{fetch:async()=>new Response(new Uint8Array(corruptPart(name)))});
  expect(result.scanSucceeded).toBe(false);expect(result.evidence).toEqual([]);
});
it('rejects excessive expanded ZIP size before workbook parsing',async()=>{
  const bytes=Buffer.from(workbook());const central=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  expect(central).toBeGreaterThan(0);bytes.writeUInt32LE(100*1024*1024,central+24);
  const result=await fetchGenjySnapshot(source,{fetch:async()=>new Response(new Uint8Array(bytes))});
  expect(result.scanSucceeded).toBe(false);expect(result.evidence).toEqual([]);
});
