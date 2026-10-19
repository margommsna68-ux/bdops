import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({preview:null as null|object,vms:[] as object[],servers:[] as object[]}));
vi.mock('next/navigation',()=>({useSearchParams:()=>({get:()=>null,toString:()=>''}),useRouter:()=>({replace:()=>{}}),usePathname:()=>'/infrastructure/servers'}));
vi.mock('next-auth/react',()=>({useSession:()=>({data:{user:{id:'u1'}}})}));
vi.mock('@/lib/trpc',()=>{
  const q=(data:unknown)=>({useQuery:()=>({data,isLoading:false,error:null})}),m=()=>({useMutation:()=>({mutateAsync:async()=>state.preview,mutate:()=>{},isLoading:false,reset:()=>{},data:undefined,error:null})});
  return {trpc:{useUtils:()=>({}),vmManagement:{workspace:{useQuery:()=>({data:{servers:state.servers,vms:state.vms},isLoading:false,error:null})},access:q({canManage:true,canAssign:true,canConfirm:true,canCopy:false,sourceConnected:true,trial:false,businessMode:'PROXY_VM'}),eligible:q([]),orphanTasks:q([]),detail:q(null),start:m(),confirm:m(),reportFailure:m(),preview:m(),commit:m(),copyProxies:m(),bulkPreview:m(),bulkApply:m(),sdkPreview:m(),sdkApply:m(),sdkHistory:q([]),copy:m(),updateServer:m(),updateVM:m(),deleteVMs:m(),restoreVMs:m(),deleteServer:m(),restoreServer:m(),addVMs:m(),createServer:m()},businessManagement:{access:q({costs:false}),accounts:q({gmails:[],vms:[]}),work:q({items:[]})},vmOps:{board:q({rights:{money:false,writeMoney:false,assign:true},vms:[]}),setStatus:m(),recreate:m(),requestPayout:m(),updatePayout:m(),payoutPick:q(null),history:q(null),gather:q(null)},accountStore:{vmAccounts:q([]),store:q(null),linkApply:m(),linkPreview:m(),autoPlan:m(),markRegistered:m()},proxyManagement:{copyBlockedEndpoints:m(),undo:m(),list:q({rows:[]})}}};
});
import {SdkPasteForm,SdkPreviewTable} from '@/components/vm-management/SdkPasteDialog';
import {SdkCell} from '@/components/vm-management/SdkCell';
import {Dialog} from '@/components/ui/dialog';
import {ServerWorkspace} from '@/components/vm-management/ServerWorkspace';
const vm=(code:string,sdk:null|{id:string;recordedAt:string|null;recordedBy:string|null})=>({id:'vm-'+code,code,serverId:'s1',server:'vt-01',revision:1,slotState:'FULL',archivedAt:null,health:'NEW',sdk,desired:null,installed:null,holds:[]});
it('SDK cell shows missing state or the code with who recorded it and when',()=>{
  vi.stubGlobal('React',React);try{
    const empty=renderToStaticMarkup(<SdkCell projectId="p" vm={vm('VM_001',null) as never} canEdit onSaved={()=>{}}/>);expect(empty).toContain('Chưa có SDK');
    const filled=renderToStaticMarkup(<SdkCell projectId="p" vm={vm('VM_002',{id:'sdk-fixture-aaaa-000000000001',recordedAt:'2026-10-15T03:00:00.000Z',recordedBy:'Nhân viên A'}) as never} canEdit onSaved={()=>{}}/>);
    expect(filled).toContain('sdk-fixture-aaaa-000000000001');expect(filled).toContain('Nhân viên A');expect(filled).toContain('15/10/2026');
  }finally{vi.unstubAllGlobals();}
});
it('paste preview lists each row with current and new SDK and only offers saving when rows are ready',()=>{
  vi.stubGlobal('React',React);try{
    const rows=[{line:1,server:'vt-01',vm:'VM_001',vmId:'vm-1',current:null,next:'sdk-fixture-aaaa-000000000001',outcome:'READY',message:'Ghi SDK mới',expectedRevision:1},{line:2,server:'vt-01',vm:'VM_009',vmId:null,current:null,next:'sdk-fixture-bbbb-000000000002',outcome:'ERROR',message:'Không tìm thấy VM VM_009 trong vt-01',expectedRevision:null}];
    const html=renderToStaticMarkup(<SdkPreviewTable rows={rows as never}/>);expect(html).toContain('VM_001');expect(html).toContain('sdk-fixture-aaaa-000000000001');expect(html).toContain('Không tìm thấy VM VM_009');
    const dialog=renderToStaticMarkup(<Dialog open><SdkPasteForm projectId="p" servers={[{id:'s1',code:'vt-01'}]} serverId="s1" onClose={()=>{}} onSaved={()=>{}}/></Dialog>);expect(dialog).toContain('Dán SDK');expect(dialog).toContain('VM');expect(dialog).not.toContain('Lưu 1 thay đổi');
  }finally{vi.unstubAllGlobals();}
});
it('server workspace separates reload from paste entry and can filter VMs without SDK',()=>{
  vi.stubGlobal('React',React);try{
    state.servers=[{id:'s1',code:'vt-01',ipAddress:null,notes:null,archivedAt:null,revision:1}];state.vms=[vm('VM_001',null),vm('VM_002',{id:'sdk-fixture-aaaa-000000000001',recordedAt:null,recordedBy:null})];
    const html=renderToStaticMarkup(<ServerWorkspace projectId="p"/>);
    expect(html).toContain('Tải lại');expect(html).toContain('Dán bảng');expect(html).toContain('Chưa có SDK');expect(html).toContain('Chưa SDK');expect(html).not.toContain('>Cập nhật<');
    // No row-level button strip any more: rarely used actions live in the ⋯ menu.
    expect(html).not.toContain('>Công việc</a>');expect(html).not.toContain('>Tài khoản</button>');expect(html).toContain('Thao tác VM_001');
  }finally{vi.unstubAllGlobals();}
});
it('one server view shows the server name only in the title, separate notes, selection and the deleted filter; all servers keep a Server column',()=>{
  vi.stubGlobal('React',React);try{
    state.servers=[{id:'s1',code:'moon05',ipAddress:null,notes:null,archivedAt:null,revision:1}];state.vms=[{...vm('VM_001',null),server:'moon05',notes:'máy test'},{...vm('VM_002',null),server:'moon05',archivedAt:'2026-10-16T00:00:00.000Z'}];
    const one=renderToStaticMarkup(<ServerWorkspace projectId="p" serverId="s1"/>);
    const body=one.slice(one.indexOf('<tbody>'),one.indexOf('</tbody>')).replace(/<[^>]*>/g,' ');expect(body).not.toContain('moon05'); // rows show VM_001, not the server again
    expect(one).toContain('Ghi chú');expect(one).toContain('máy test');expect(one).toMatch(/Đã xoá <strong>1<\/strong>/);expect(one).toContain('Chọn 1 VM trên trang này');expect(one).not.toContain('>Server<');
    expect(one).toContain('Quản lý server');expect(one).toContain('Thêm VM');expect(one).toContain('Chọn server');expect(one).toContain('vm-pager-top');expect(one).toContain('vm-pager-bottom');
    const all=renderToStaticMarkup(<ServerWorkspace projectId="p"/>);expect(all).toContain('>Server<');expect(all).toContain('moon05');
  }finally{vi.unstubAllGlobals();}
});
