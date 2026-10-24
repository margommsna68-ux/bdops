import React,{act} from 'react';
import type {Root} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
type Member={id:string;role:string;capabilities:string[];allowedModules:string[];serverScope:string;allowedServerIds:string[];accessRevision:number;user:{name:string;username:null;email:null}};
const mock=vi.hoisted(()=>({members:[] as Member[],save:vi.fn(),serverError:null as null|Error}));
const choices=[{id:'a',code:'SERVER-A'},{id:'b',code:'SERVER-B'}];
vi.mock('@/lib/trpc',()=>({trpc:{useUtils:()=>({}),proxyManagement:{
  members:{useQuery:()=>({data:mock.members,isLoading:false,refetch:vi.fn()})},
  serverAccessChoices:{useQuery:()=>({data:mock.serverError?undefined:choices,error:mock.serverError,isLoading:false})},
  setCapabilities:{useMutation:()=>({mutate:mock.save,isLoading:false})},
}}}));
vi.mock('react-hot-toast',()=>({default:{success:vi.fn(),error:vi.fn()}}));
import {MemberRightsForm} from '@/components/proxy-management/MemberRightsDialog';
let dom:JSDOM,root:Root,host:HTMLDivElement;
beforeEach(async()=>{
  dom=new JSDOM('<html><body></body></html>',{url:'http://localhost'});
  for(const [key,value] of Object.entries({React,window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true}))vi.stubGlobal(key,value);
  host=document.createElement('div');document.body.appendChild(host);
  const {createRoot}=await import('react-dom/client');root=createRoot(host);
  mock.save.mockReset();mock.serverError=null;
  mock.members=[{id:'local-user-a',role:'USER',capabilities:[],allowedModules:['INFRASTRUCTURE'],serverScope:'ALL',allowedServerIds:[],accessRevision:7,user:{name:'Local User A',username:null,email:null}},
    {id:'local-user-b',role:'USER',capabilities:[],allowedModules:['INFRASTRUCTURE'],serverScope:'SELECTED',allowedServerIds:['b'],accessRevision:11,user:{name:'Local User B',username:null,email:null}}];
});
afterEach(async()=>{await act(async()=>root.unmount());dom.window.close();vi.unstubAllGlobals();});
const render=async(memberId?:string)=>act(async()=>root.render(<MemberRightsForm projectId="local-project" memberId={memberId}/>));
const input=(label:string)=>{const found=Array.from(host.querySelectorAll('label')).find(el=>el.textContent===label)?.querySelector('input');if(!found)throw Error('Missing '+label);return found;};
const save=()=>Array.from(host.querySelectorAll('button')).find(el=>el.textContent==='Lưu quyền')!;
const click=async(el:HTMLElement)=>act(async()=>el.click());
it('starts clean, saves an explicitly empty selection with its own revision, and explains no stock access',async()=>{
  await render('local-user-a');expect(save().disabled).toBe(true);
  await click(input('Chỉ server được chọn'));
  expect(save().disabled).toBe(false);expect(host.textContent).toContain('không được truy cập server nào');expect(host.textContent).toContain('kho chung');
  await click(save());expect(mock.save).toHaveBeenCalledWith({projectId:'local-project',memberId:'local-user-a',capabilities:[],allowInfrastructure:true,serverAccess:{mode:'SELECTED',serverIds:[],expectedAccessRevision:7}});
});
it('keeps distinct local users selections and revisions separate when switching members',async()=>{
  await render();await click(input('Chỉ server được chọn'));await click(input('SERVER-A'));await click(input('SERVER-B'));
  await click(save());expect(mock.save.mock.calls[0][0].serverAccess).toEqual({mode:'SELECTED',serverIds:['a','b'],expectedAccessRevision:7});
  const select=host.querySelector('select')!;await act(async()=>{select.value='local-user-b';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  expect(input('SERVER-A').checked).toBe(false);expect(input('SERVER-B').checked).toBe(true);expect(save().disabled).toBe(true);
  await click(input('SERVER-A'));await click(save());
  expect(mock.save.mock.calls[1][0]).toMatchObject({memberId:'local-user-b',serverAccess:{mode:'SELECTED',serverIds:['b','a'],expectedAccessRevision:11}});
});
it('returning to the original scope clears dirty state, and ALL submits no hidden allowlist',async()=>{
  await render('local-user-b');await click(input('Toàn bộ server'));expect(save().disabled).toBe(false);
  await click(input('Chỉ server được chọn'));expect(save().disabled).toBe(true);
  await click(input('Toàn bộ server'));await click(save());
  expect(mock.save.mock.calls[0][0].serverAccess).toEqual({mode:'ALL',serverIds:[],expectedAccessRevision:11});
});
it('makes ADMIN server scope fixed at ALL',async()=>{
  mock.members[0]={...mock.members[0],role:'ADMIN'};await render('local-user-a');
  expect(input('Toàn bộ server').checked).toBe(true);expect(host.querySelector('fieldset')?.disabled).toBe(true);expect(save().disabled).toBe(true);
  expect(host.textContent).toContain('ADMIN luôn có quyền trên toàn bộ server');expect(mock.save).not.toHaveBeenCalled();
});
it('blocks selected-scope saving when choices cannot be loaded',async()=>{
  mock.serverError=new Error('Không tải được server');await render('local-user-a');await click(input('Chỉ server được chọn'));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Không tải được server');expect(save().disabled).toBe(true);
});
