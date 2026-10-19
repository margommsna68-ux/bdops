import {afterAll,beforeEach,describe,expect,it} from 'vitest';
import {readSelection,restorableIds,selectionKey,writeSelection} from '@/lib/session-selection';
import {useProjectStore} from '@/lib/store';
// Owner repro 20/10/2026 (host): Kho proxy of MOON, tick 2 proxies → Thiết lập → change project MOON → AE → MOON → Back: still "Đã chọn 2
// proxy". The flow here goes through what the pages do: leaving saves the ticks in the tab session, the project is changed with the
// real store action (as Thiết lập / the project switcher do), and coming back runs the same restore step the page runs on mount.
class Mem{m=new Map<string,string>();get length(){return this.m.size;}key(i:number){return [...this.m.keys()][i]??null;}getItem(k:string){return this.m.get(k)??null;}setItem(k:string,v:string){this.m.set(k,String(v));}removeItem(k:string){this.m.delete(k);}clear(){this.m.clear();}}
const g=globalThis as unknown as {window?:{sessionStorage:Mem}};const mem=new Mem();g.window={sessionStorage:mem};
afterAll(()=>{delete g.window;});
const pick=(id:string)=>useProjectStore.getState().setCurrentProject(id,id.toUpperCase(),id,'FULL','ADMIN',[],true,undefined,'PROXY_VM');
const VM='MOON|srv|ALL|||',PROXY='MOON|["",[],"","","","CURRENT","PACKAGE"]|1';
// Leaving a page: what useSessionSelection has saved for the ticked rows of that page.
function leave(){writeSelection(mem,selectionKey('vm','u1','moon'),{scope:VM,ids:['vm1','vm2','vm3']});writeSelection(mem,selectionKey('proxy','u1','moon'),{scope:PROXY,ids:['p211','p213']});}
// Coming back: the restore the page runs once its rows are loaded.
const back=(surface:'vm'|'proxy',scope:string,valid:string[])=>restorableIds(readSelection(mem,selectionKey(surface,'u1','moon')),scope,new Set(valid));
describe('selection after leaving the page',()=>{
  beforeEach(()=>{mem.clear();pick('moon');mem.setItem('mth-draft:keep','nháp');mem.setItem('bdops-pin-ok','1');});
  it('changing project MOON → AE → MOON drops the ticks of both Server / VM and Kho proxy, also when those pages are not open',()=>{
    leave();pick('ae');pick('moon');
    expect(back('vm',VM,['vm1','vm2','vm3'])).toEqual([]);
    expect(back('proxy',PROXY,['p211','p213'])).toEqual([]);
    // Only the selections go: drafts, PIN and other session entries stay; another project's selection is not touched.
    expect(mem.getItem('mth-draft:keep')).toBe('nháp');expect(mem.getItem('bdops-pin-ok')).toBe('1');
  });
  it('only changing the theme (same project) keeps them as before',()=>{
    leave();pick('moon'); // the dashboard layout re-reads the same project on every page
    expect(back('vm',VM,['vm1','vm2','vm3'])).toEqual(['vm1','vm2','vm3']);
    expect(back('proxy',PROXY,['p211','p213'])).toEqual(['p211','p213']);
  });
  it('a selection of the project switched to is kept until that project is left',()=>{
    writeSelection(mem,selectionKey('proxy','u1','ae'),{scope:'AE|x|1',ids:['a1']});pick('ae');
    expect(readSelection(mem,selectionKey('proxy','u1','ae'))?.ids).toEqual(['a1']);
    pick('moon');expect(readSelection(mem,selectionKey('proxy','u1','ae'))).toBeNull();
  });
});
