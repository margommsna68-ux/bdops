import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {BulkBar,RowDeleteButton} from '@/components/proxy-management/BulkBar';
import {refusedLines} from '@/components/proxy-management/BatchDialog';
import {appendToBatch,finishDraft,importDraft} from '@/components/account-store/ImportPanel';
// Owner brief 20/10/2026: one bulk bar for every stock table; a finished import hands the person back to the table.
describe('BulkBar',()=>{
  it('keeps its place with nothing selected (a hint, no actions, no delete) so ticking a row never moves the table',()=>{
    const idle=renderToStaticMarkup(<BulkBar count={0} unit="proxy" onClear={()=>{}} onDelete={()=>{}}><button>Đổi nhóm</button></BulkBar>);
    expect(idle).toContain('pm-bulkbar pm-bulkbar-idle');expect(idle).toContain('Chọn dòng để thao tác hàng loạt');expect(idle).not.toContain('Đổi nhóm');expect(idle).not.toContain('Xoá');
  });
  it('one bar: "Đã chọn N" once, the actions, then a small soft-red Xoá and Bỏ chọn at the end; Xoá counts only the rows it acts on',()=>{
    const html=renderToStaticMarkup(<BulkBar count={3} unit="tài khoản" extra="gồm 1 ở trang khác" onClear={()=>{}} onDelete={()=>{}} deleteCount={2}><button>Áp dụng</button></BulkBar>);
    expect(html.match(/Đã chọn/g)).toHaveLength(1);expect(html).toContain('Đã chọn 3 tài khoản');expect(html).toContain('gồm 1 ở trang khác');
    expect(html.indexOf('Áp dụng')).toBeLessThan(html.indexOf('Xoá 2 dòng'));expect(html.indexOf('Xoá 2 dòng')).toBeLessThan(html.indexOf('Bỏ chọn'));
    expect(html).toContain('pm-button pm-button-sm pm-button-danger');expect(html).toContain('aria-label="Xoá khỏi kho 2 dòng đã chọn"');
    expect(renderToStaticMarkup(<BulkBar count={2} unit="proxy" onClear={()=>{}}/>)).not.toContain('Xoá'); // no delete right → no button
    expect(renderToStaticMarkup(<BulkBar count={2} unit="proxy" onClear={()=>{}} onDelete={()=>{}} deleteCount={0}/>)).not.toContain('Xoá');
  });
  it('the row delete button is an icon button named for keyboards and AI',()=>{
    expect(renderToStaticMarkup(<RowDeleteButton label="a@example.invalid" onClick={()=>{}}/>)).toMatch(/class="pm-icon-button pm-icon-danger".*aria-label="Xoá khỏi kho a@example.invalid"/);
  });
});
describe('finished imports',()=>{
  it('a fully imported purchase forgets text, secrets, money, check, key and append target; only the account type stays',()=>{
    const d=importDraft('p-'+Math.random(),'LOGIN');d.open=true;d.values={text:'a@example.invalid|secret',type:'APPLE_ID',money:{amount:'10'},preview:{ready:1},key:'k1',keySig:'s',one:{password:'x'}};
    appendToBatch(d,{id:'b1',code:'TK-1',type:'APPLE_ID'});expect(d.values.target).toBeTruthy();
    const nonce=d.nonce;finishDraft(d,'APPLE_ID');
    expect(d.values).toEqual({type:'APPLE_ID'});expect(d.open).toBe(false);expect(d.nonce).toBe(nonce+1);
    finishDraft(d,null);expect(d.values).toEqual({});
  });
  it('a partial proxy import keeps only the refused lines, in order, numbered like the server (blank lines skipped)',()=>{
    const text='\n203.0.113.1:80:u:p\n\n 203.0.113.2:80:u:p \nbad line\r\n203.0.113.3:80:u:p';
    expect(refusedLines(text,[{row:1,outcome:'READY'},{row:2,outcome:'ERROR'},{row:3,outcome:'ERROR'},{row:4,outcome:'READY'}])).toBe(' 203.0.113.2:80:u:p \nbad line');
    expect(refusedLines(text,[{row:1,outcome:'READY'}])).toBe('');
  });
});
