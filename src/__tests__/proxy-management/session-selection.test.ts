import {describe,expect,it,beforeEach} from 'vitest';
import {readSelection,restorableIds,selectionKey,writeSelection} from '@/lib/session-selection';
// Owner brief 19/10/2026: Server / VM → select rows → Thiết lập → change theme → Back lost the selection. The selection is now kept
// in the tab's session memory by id, per user, project and filter scope, and restored only into the same scope with rows that are
// still valid.
class Mem{m=new Map<string,string>();getItem(k:string){return this.m.get(k)??null;}setItem(k:string,v:string){this.m.set(k,v);}removeItem(k:string){this.m.delete(k);}}
describe('session selection',()=>{
  let store:Mem;beforeEach(()=>{store=new Mem();});
  it('is keyed by surface, user and project (another project never sees it)',()=>{
    writeSelection(store,selectionKey('vm','u1','p1'),{scope:'p1|s|ALL',ids:['a','b']});
    expect(readSelection(store,selectionKey('vm','u1','p2'))).toBeNull();
    expect(readSelection(store,selectionKey('vm','u2','p1'))).toBeNull();
    expect(readSelection(store,selectionKey('proxy','u1','p1'))).toBeNull();
    expect(readSelection(store,selectionKey('vm','u1','p1'))).toEqual({scope:'p1|s|ALL',ids:['a','b']});
  });
  it('restores only into the same scope and only rows that are still valid',()=>{
    const saved={scope:'p1||ALL||',ids:['vm1','vm2','vm3','gone']};
    expect(restorableIds(saved,'p1||ALL||',new Set(['vm1','vm2','vm3','vm4']))).toEqual(['vm1','vm2','vm3']);
    expect(restorableIds(saved,'p1||MISSING||',new Set(['vm1','vm2','vm3']))).toEqual([]);
    expect(restorableIds(null,'p1||ALL||',new Set(['vm1']))).toEqual([]);
  });
  it('ignores broken or foreign data and an unavailable storage',()=>{
    store.setItem(selectionKey('vm','u1','p1'),'{not json');expect(readSelection(store,selectionKey('vm','u1','p1'))).toBeNull();
    store.setItem(selectionKey('vm','u1','p1'),JSON.stringify({scope:1,ids:'x'}));expect(readSelection(store,selectionKey('vm','u1','p1'))).toBeNull();
    expect(readSelection(null,selectionKey('vm','u1','p1'))).toBeNull();expect(()=>writeSelection(null,'k',{scope:'s',ids:[]})).not.toThrow();
  });
  it('an empty selection removes the entry',()=>{
    const k=selectionKey('vm','u1','p1');writeSelection(store,k,{scope:'s',ids:['a']});writeSelection(store,k,{scope:'s',ids:[]});expect(store.getItem(k)).toBeNull();
  });
});
