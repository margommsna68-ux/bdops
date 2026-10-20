import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
// "Tiền / Rút" at a glance (owner brief 20/10/2026): why there is no money yet (no account / never checked), a recorded balance as a
// readable $ amount with a short check time, never $0 for missing data. Synthetic ids only.
vi.mock('@/lib/trpc',()=>({trpc:{}}));
vi.mock('react-hot-toast',()=>({default:{success:vi.fn(),error:vi.fn()}}));
import {balanceLine} from '@/components/vm-management/vm-grid/MoneyParts';
import {PayoutCell} from '@/components/vm-management/vm-grid/OpsCells';
type Root={render:(n:React.ReactNode)=>void;unmount:()=>void};
let dom:JSDOM,container:HTMLDivElement,root:Root,createRoot:(c:Element)=>Root;
const saved=new Map<string,PropertyDescriptor|undefined>();
beforeAll(async()=>{
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/'});
  for(const [k,v] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true})){
    saved.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:v});
  }
  ({createRoot}=await import('react-dom/client') as unknown as {createRoot:(c:Element)=>Root});
});
beforeEach(()=>{container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
afterAll(()=>{dom.window.close();for(const [k,d] of saved){if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}});
const vm={id:'vm-synthetic',code:'VM_001',server:'Sv-synthetic',serverId:'sv-synthetic',archivedAt:null} as never;
const at=new Date(Date.now()-5*60e3).toISOString();
const check=(amount:string|null,withdrawable='UNKNOWN')=>({id:'c',checkedAt:at,outcome:'OK',amount,currency:'USD',withdrawable});
const ops=(balance:object|null,earnAppId:string|null='ea-synthetic')=>({vmId:'vm-synthetic',cycle:1,earnAppId,status:null,milestone:null,request:null,balance:balance??{latest:null,lastOk:null}}) as never;
const rights={assign:true,money:false,writeMoney:false,balanceRead:true,balanceWrite:true};
const render=(n:React.ReactNode)=>act(async()=>root.render(n));
describe('Tiền / Rút cell: why there is no money yet',()=>{
  it('no EarnApp account: "Chưa gán tài khoản", a button that opens the account picker for who may assign',async()=>{
    await render(<PayoutCell projectId="p" vm={vm} ops={ops(null,null)} account={undefined} rights={rights} onDone={()=>{}} onBusy={()=>{}}/>);
    const b=container.querySelector('button[aria-label="Tài khoản EarnApp VM_001"]') as HTMLButtonElement;
    expect(b).toBeTruthy();expect(b.getAttribute('aria-haspopup')).toBe('dialog');expect(b.textContent).toContain('Chưa gán tài khoản');
    expect(container.textContent).not.toMatch(/\$|Chưa kiểm tra/);
  });
  it('no EarnApp account and no assign right: plain text, nothing to click',async()=>{
    await render(<PayoutCell projectId="p" vm={vm} ops={ops(null,null)} account={undefined} rights={{...rights,assign:false}} onDone={()=>{}} onBusy={()=>{}}/>);
    expect(container.textContent).toContain('Chưa gán tài khoản');expect(container.querySelector('button')).toBeNull();
  });
  it('account assigned, never checked: "Chưa kiểm tra", the button opens the balance frame',async()=>{
    await render(<PayoutCell projectId="p" vm={vm} ops={ops(null)} account={{earnApp:{id:'ea-synthetic',login:{email:'a@example.invalid'}}} as never} rights={rights} onDone={()=>{}} onBusy={()=>{}}/>);
    const b=container.querySelector('button[aria-label="Tiền / Rút Sv-synthetic / VM_001"]') as HTMLButtonElement;
    expect(b.textContent).toContain('Chưa kiểm tra');expect(b.textContent).not.toContain('$');
  });
});
describe('balance line',()=>{
  it('a recorded balance is a $ amount on its own, with the condition and a short check time',()=>{
    const l=balanceLine(ops({latest:check('12.40','YES'),lastOk:check('12.40','YES')}),true)!;
    expect(l.lead).toBe('$12,40');expect(l.text).toBe('Có thể rút');expect(l.sub).toMatch(/^Kiểm tra (\d\d\/\d\d )?\d\d:\d\d$/); // the day is added when the check (5 minutes ago) was before midnight in Asia/Bangkok
  });
  it('$0 recorded is $0,00; an unknown condition is said on the second line',()=>{
    const l=balanceLine(ops({latest:check('0.00','UNKNOWN'),lastOk:check('0.00','UNKNOWN')}),true)!;
    expect(l.lead).toBe('$0,00');expect(l.text).toBe('');expect(l.sub).toMatch(/^Chưa kiểm tra điều kiện rút · Kiểm tra /);
  });
  it('without the balance read right: checked, no amount',()=>{
    const l=balanceLine(ops({latest:check('12.40','YES'),lastOk:check('12.40','YES')}),false)!;
    expect(l.lead).toBeUndefined();expect(JSON.stringify(l)).not.toMatch(/12/);
  });
});
