import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import {LocationCells,ServerFilter,serverFilterLabel,copySummary,roleLabel} from '@/components/proxy-management/RegistryCells';
import {copyWhenReady} from '@/components/proxy-management/clipboard';
import {UNASSIGNED_SERVER,type RegistryRow} from '@/server/proxy-management/types';
const row=(o:Partial<RegistryRow>):RegistryRow=>({identityId:'i',endpointId:'e',ip:'10.0.0.1',port:80,owner:'SELF',subgroup:null,groupId:null,groupName:null,packageCode:'231243',state:'LIVE',revision:1,sourceRefs:[],locations:[],statusAt:null,...o});
const loc=(serverCode:string,vmCode:string,role:RegistryRow['locations'][number]['role'])=>({serverId:'s-'+serverCode,serverCode,vmId:'v-'+vmCode,vmCode,role});
describe('location cells',()=>{
  it('split server, VM and operating note into separate cells and list every position',()=>{
    vi.stubGlobal('React',React);try{
      const html=renderToStaticMarkup(<table><tbody><tr><LocationCells row={row({locations:[loc('An-01','VM_001','DESIRED'),loc('moon2','VM_010','INSTALLED')]})}/></tr></tbody></table>);
      const cells=html.match(/<td[^>]*>.*?<\/td>/g)||[];expect(cells).toHaveLength(3);
      expect(cells[0]).toContain('An-01');expect(cells[0]).toContain('moon2');expect(cells[0]).not.toContain('VM_001');
      expect(cells[1]).toContain('VM_001');expect(cells[1]).toContain('VM_010');expect(cells[1]).not.toContain('An-01');
      expect(cells[2]).toContain('Đang dùng');expect(html).not.toContain('An-01/VM_001');
      const empty=renderToStaticMarkup(<table><tbody><tr><LocationCells row={row({})}/></tr></tbody></table>);expect(empty).toContain('Chưa gán');
      const genjy=renderToStaticMarkup(<table><tbody><tr><LocationCells row={row({owner:'GENJY',endpointId:null})}/></tr></tbody></table>);expect(genjy).toContain('Genjy riêng');expect(genjy).not.toContain('Chưa gán');expect(renderToStaticMarkup(<table><tbody><tr><LocationCells row={row({owner:'GENJY',subgroup:'PC_CHUNG'})}/></tr></tbody></table>)).toContain('Chưa gán');
    }finally{vi.unstubAllGlobals();}
  });
  it('maps allocation roles to short operating notes',()=>{
    expect(roleLabel('DESIRED')).toBe('Đang dùng');expect(roleLabel('INSTALLED')).toBe('Đang dùng');// 19/10/2026: no install stepexpect(roleLabel('UNCERTAIN')).toBe('Giữ để kiểm tra');expect(roleLabel(null)).toBe('');
  });
});
describe('server filter',()=>{
  it('labels the trigger with the chosen servers and offers every project server plus unassigned',()=>{
    expect(serverFilterLabel([],['moon1'])).toBe('Tất cả server');
    expect(serverFilterLabel(['moon1','moon2'],['moon1','moon2','An-01'])).toBe('moon1, moon2');
    expect(serverFilterLabel([UNASSIGNED_SERVER,'moon1','moon2','An-01'],['moon1','moon2','An-01'])).toBe('moon1, moon2 +2');
    vi.stubGlobal('React',React);try{
      const html=renderToStaticMarkup(<ServerFilter servers={['An-01','moon2','moon10']} value={['moon2']} onChange={()=>{}}/>);
      expect(html).toContain('moon2');expect(html).toContain('aria-label="Lọc server"');
    }finally{vi.unstubAllGlobals();}
  });
});
describe('copy summary',()=>{
  it('reports copied count and every skipped reason instead of silently dropping rows',()=>{
    expect(copySummary({proxies:[],copied:3,total:3,skipped:[]})).toEqual({ok:true,message:'Đã copy 3 proxy'});
    expect(copySummary({proxies:[],copied:2,total:4,skipped:[{reason:'NO_CREDENTIALS',count:1},{reason:'NO_ENDPOINT',count:1}]})).toEqual({ok:true,message:'Đã copy 2 / 4 proxy · bỏ qua 1 dòng thiếu user/pass, 1 dòng chỉ có IP từ Genjy'});
    expect(copySummary({proxies:[],copied:0,total:1,skipped:[{reason:'NO_CREDENTIALS',count:1}]})).toEqual({ok:false,message:'Không copy được dòng nào · bỏ qua 1 dòng thiếu user/pass'});
  });
});
describe('copyWhenReady',()=>{
  it('writes through a promise-backed ClipboardItem when supported so one click suffices after the fetch',async()=>{
    const written:string[]=[];
    class FakeItem{constructor(public parts:Record<string,Promise<Blob>|Blob>){}}
    vi.stubGlobal('ClipboardItem',FakeItem);vi.stubGlobal('navigator',{clipboard:{write:async(items:FakeItem[])=>{written.push(await (await items[0].parts['text/plain']).text());},writeText:async()=>{throw new Error('should not be used');}}});
    try{expect(await copyWhenReady(async()=>'1.1.1.1:80:u:p')).toEqual({ok:true});expect(written).toEqual(['1.1.1.1:80:u:p']);}finally{vi.unstubAllGlobals();}
  });
  it('falls back to writeText, and surfaces the text when the clipboard refuses, or the load error when the fetch fails',async()=>{
    const written:string[]=[];
    vi.stubGlobal('ClipboardItem',undefined);vi.stubGlobal('navigator',{clipboard:{writeText:async(t:string)=>{written.push(t);}}});
    try{
      expect(await copyWhenReady(async()=>'a:1:u:p')).toEqual({ok:true});expect(written).toEqual(['a:1:u:p']);
      vi.stubGlobal('navigator',{clipboard:{writeText:async()=>{throw new Error('NotAllowed');}}});
      expect(await copyWhenReady(async()=>'b:2:u:p')).toEqual({ok:false,text:'b:2:u:p'});
      expect(await copyWhenReady(async()=>{throw new Error('Không có quyền copy');})).toEqual({ok:false,text:null,error:'Không có quyền copy'});
    }finally{vi.unstubAllGlobals();}
  });
});
describe('group cell and row edit helpers',()=>{
  it('shows TUT for the own stock, genjy with PC chung, the group name for grouped proxies',async()=>{
    const {GroupCell,pasteTemplate,editSummary,vmChoices}=await import('@/components/proxy-management/RegistryEdit');
    vi.stubGlobal('React',React);try{
      const html=(r:RegistryRow)=>renderToStaticMarkup(<table><tbody><tr><GroupCell row={r}/></tr></tbody></table>);
      expect(html(row({}))).toContain('TUT');expect(html(row({}))).not.toContain('Của anh');
      expect(html(row({owner:'GENJY',subgroup:'PC_CHUNG'}))).toContain('Chung mooon–Genjy');expect(html(row({owner:'GENJY',subgroup:'PC_CHUNG'}))).toContain('pm-badge-shared');expect(html(row({owner:'GENJY',subgroup:null}))).toContain('Genjy riêng');
      expect(html(row({owner:'OTHER',groupId:'g1',groupName:'Khách C'}))).toContain('Khách C');expect(html(row({owner:'OTHER',groupId:'g1',groupName:'Khách C'}))).not.toContain('TUT');
      expect(html(row({owner:'UNKNOWN'}))).toContain('Chưa xác định');
    }finally{vi.unstubAllGlobals();}
    expect(pasteTemplate([row({ip:'10.0.0.1',locations:[loc('moon1','VM_001','DESIRED')]}),row({ip:'10.0.0.2'})])).toBe('10.0.0.1 | moon1 | VM_001\n10.0.0.2 | | ');
    expect(editSummary({applied:2,skipped:1,errors:0})).toBe('Đã ghi 2 dòng · 1 giữ nguyên');expect(editSummary({applied:0,skipped:0,errors:3})).toBe('Không ghi dòng nào · 3 lỗi');
    const targets=[{id:'v1',code:'VM_001',serverId:'s1',serverCode:'moon1',occupant:'10.0.0.1'},{id:'v2',code:'VM_002',serverId:'s1',serverCode:'moon1',occupant:null},{id:'v3',code:'VM_003',serverId:'s1',serverCode:'moon1',occupant:'10.0.0.9'},{id:'v4',code:'VM_001',serverId:'s2',serverCode:'moon2',occupant:null}];
    expect(vmChoices(targets,'s1',row({ip:'10.0.0.1',locations:[{serverId:'s1',serverCode:'moon1',vmId:'v1',vmCode:'VM_001',role:'DESIRED'}]})).map(v=>v.code)).toEqual(['VM_001','VM_002']); // current VM plus free ones, never a VM used by another proxy
    expect(vmChoices(targets,'s2',row({})).map(v=>v.id)).toEqual(['v4']);
  });
});
