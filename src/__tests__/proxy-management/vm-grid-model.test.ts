import {describe,expect,it} from 'vitest';
import {DEFAULT_PREFS,editableFields,moveColumn,nextCell,normalizePrefs,pageOf,readGridUrl,resizeColumn,shortCode,toggleColumn,visibleColumns,writeGridUrl} from '@/components/vm-management/vm-grid/grid-model';
const params=(s:string)=>new URLSearchParams(s);
describe('Server/VM grid model',()=>{
  it('default columns follow the brief and optional columns start hidden',()=>{
    expect(visibleColumns(DEFAULT_PREFS).map(c=>c.key)).toEqual(['proxy','sdk','gmail','status','notes']);
  });
  it('stored preferences are cleaned: unknown keys dropped, new columns appended, widths bounded',()=>{
    const p=normalizePrefs({order:['notes','bogus','proxy','notes'],hidden:['gmail'],widths:{sdk:20,notes:300}});
    expect(p.order.slice(0,2)).toEqual(['notes','proxy']);expect(p.order).toHaveLength(8);expect(p.hidden).toContain('gmail');expect(p.hidden).toContain('version');
    expect(p.widths).toEqual({notes:300});expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
  });
  it('moves, toggles and resizes columns within limits',()=>{
    let p=moveColumn(DEFAULT_PREFS,'notes',0);expect(visibleColumns(p)[0].key).toBe('notes');
    p=toggleColumn(p,'version',true);expect(visibleColumns(p).map(c=>c.key)).toContain('version');
    p=resizeColumn(p,'sdk',10);expect(p.widths.sdk).toBe(110);p=resizeColumn(p,'vm',150);expect(p.widths.vm).toBe(150);
  });
  it('Tab goes to the next editable cell, wraps to the next row and stops at the edges',()=>{
    const fields=editableFields(DEFAULT_PREFS,{manage:true,assign:true});expect(fields).toEqual(['code','sdk','notes']);
    expect(editableFields(DEFAULT_PREFS,{manage:false,assign:true})).toEqual(['sdk']);
    const rows=['a','b'];
    expect(nextCell(rows,fields,{vmId:'a',field:'code'})).toEqual({vmId:'a',field:'sdk'});
    expect(nextCell(rows,fields,{vmId:'a',field:'notes'})).toEqual({vmId:'b',field:'code'});
    expect(nextCell(rows,fields,{vmId:'b',field:'code'},true)).toEqual({vmId:'a',field:'notes'});
    expect(nextCell(rows,fields,{vmId:'b',field:'notes'})).toBeNull();expect(nextCell(rows,fields,{vmId:'a',field:'code'},true)).toBeNull();
  });
  it('URL keeps search, filter, sort, page, size and the open VM; defaults stay out of the URL',()=>{
    const s=readGridUrl(params('q=VM_07&view=PENDING&sort=SDK&page=3&size=200&vm=x&tab=work&cause=HOLD'));
    expect(s).toEqual({q:'VM_07',view:'PENDING',sort:'SDK',page:3,size:200,vm:'x',tab:'work',cause:'HOLD'});
    expect(writeGridUrl(s)).toBe('?q=VM_07&view=PENDING&sort=SDK&page=3&size=200&vm=x&tab=work&cause=HOLD');
    expect(writeGridUrl(readGridUrl(params('view=bogus&size=7&page=-2')))).toBe('');
  });
  it('pages the whole filtered result and clamps the page',()=>{
    const rows=Array.from({length:250},(_,i)=>i);
    expect(pageOf(rows,3,100)).toMatchObject({pages:3,current:3,first:201,last:250});expect(pageOf(rows,9,100).current).toBe(3);expect(pageOf([],1,100)).toMatchObject({first:0,last:0,pages:1});
  });
  it('shortens long SDK codes for display only',()=>{expect(shortCode('sdk-1234567890abcdef1234')).toBe('sdk-1234…cdef1234');expect(shortCode('short-sdk')).toBe('short-sdk');});
});
