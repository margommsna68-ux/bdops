import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({preview:null as null|object,vms:[] as object[],servers:[] as object[]}));
vi.mock('next/navigation',()=>({useSearchParams:()=>({get:()=>null,toString:()=>''}),useRouter:()=>({replace:()=>{}}),usePathname:()=>'/infrastructure/servers'}));
vi.mock('@/lib/trpc',()=>{
  const q=(data:unknown)=>({useQuery:()=>({data,isLoading:false,error:null})}),m=()=>({useMutation:()=>({mutateAsync:async()=>state.preview,mutate:()=>{},isLoading:false,reset:()=>{},data:undefined,error:null})});
  return {trpc:{useUtils:()=>({}),vmManagement:{workspace:q({servers:state.servers,vms:state.vms}),access:q({canManage:true,canAssign:true,canConfirm:true,canCopy:false,sourceConnected:true,trial:false,businessMode:'PROXY_VM'}),eligible:q([]),sdkPreview:m(),sdkApply:m(),sdkHistory:q([]),copy:m()},businessManagement:{access:q({costs:false}),accounts:q({gmails:[],vms:[]})},proxyManagement:{list:q({rows:[]})}}};
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
    expect(html).toContain('Tải lại');expect(html).toContain('Dán SDK');expect(html).toContain('Chưa có SDK');expect(html).toContain('SDK_MISSING');expect(html).not.toContain('>Cập nhật<');
  }finally{vi.unstubAllGlobals();}
});
