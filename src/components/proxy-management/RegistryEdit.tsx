"use client";
import {useEffect,useState} from 'react';
import {trpc} from '@/lib/trpc';
import type {EditItem,EditPreview,EditRow,LocationChoice,ProxyGroupRef,RegistryRow,VmTarget} from '@/server/proxy-management/types';
import {roleLabel} from './RegistryCells';
import {AlertCircle,Check,Loader2,X} from 'lucide-react';
import toast from 'react-hot-toast';
// "Từ nhóm": TUT is the own stock (owner SELF), genjy is reserved, anything else is an operator-defined group (owner OTHER).
export type GroupPick={kind:'TUT'}|{kind:'GENJY'}|{kind:'GROUP';id:string}|{kind:'NEW';name:string};
export const groupLabel=(row:Pick<RegistryRow,'owner'|'subgroup'|'groupName'>)=>row.owner==='SELF'?'TUT':row.owner==='GENJY'?(row.subgroup==='PC_CHUNG'?'genjy · PC chung':'genjy'):row.owner==='OTHER'?(row.groupName||'Nhóm khác'):'Chưa xác định';
export function GroupCell({row}:{row:RegistryRow}){
  return <td>{row.owner==='GENJY'?<><strong className="font-medium">genjy</strong>{row.subgroup==='PC_CHUNG'&&<div className="pm-muted text-xs mt-1">PC chung</div>}</>:row.owner==='SELF'?<strong className="font-medium">TUT</strong>:row.owner==='OTHER'?<span>{row.groupName||'Nhóm khác'}</span>:<span className="text-amber-600">Chưa xác định</span>}</td>;
}
export function GroupChoiceSelect({groups,value,onChange,disabled,allowGenjy,className=''}:{groups:ProxyGroupRef[];value:GroupPick;onChange:(v:GroupPick)=>void;disabled?:boolean;allowGenjy?:boolean;className?:string}){
  const current=value.kind==='TUT'?'TUT':value.kind==='GENJY'?'GENJY':value.kind==='NEW'?'__NEW__':value.id;
  return <div className={'flex gap-2 flex-wrap '+className}>
    <select aria-label="Từ nhóm" className="pm-input" disabled={disabled} value={current} onChange={e=>{const v=e.target.value;onChange(v==='TUT'?{kind:'TUT'}:v==='GENJY'?{kind:'GENJY'}:v==='__NEW__'?{kind:'NEW',name:''}:{kind:'GROUP',id:v});}}>
      <option value="TUT">TUT</option>{allowGenjy&&<option value="GENJY">genjy — giữ riêng</option>}{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}<option value="__NEW__">Nhóm mới…</option>
    </select>
    {value.kind==='NEW'&&<input autoFocus aria-label="Tên nhóm mới" className="pm-input" maxLength={60} placeholder="Tên nhóm mới" disabled={disabled} value={value.name} onChange={e=>onChange({kind:'NEW',name:e.target.value})}/>}
  </div>;
}
export const toGroupChoice=(v:GroupPick):EditItem['group']=>v.kind==='GROUP'?{kind:'GROUP',id:v.id}:v.kind==='NEW'?{kind:'NEW',name:v.name.trim()}:{kind:'TUT'};
export const pasteTemplate=(rows:RegistryRow[])=>rows.map(r=>{const l=r.locations[0];return l?`${r.ip} | ${l.serverCode} | ${l.vmCode}`:`${r.ip} | | `;}).join('\n');
export const editSummary=(r:{applied:number;skipped:number;errors:number})=>(r.applied?`Đã ghi ${r.applied} dòng`:'Không ghi dòng nào')+(r.skipped?` · ${r.skipped} giữ nguyên`:'')+(r.errors?` · ${r.errors} lỗi`:'');
// VMs the row may move to on a server: free ones plus the VM it already sits on. A VM used by another proxy is never offered.
export const vmChoices=(targets:VmTarget[],serverId:string,row:RegistryRow)=>targets.filter(t=>t.serverId===serverId&&(!t.occupant||row.locations.some(l=>l.vmId===t.id)));
export const serverChoices=(targets:VmTarget[])=>targets.reduce<{id:string;code:string}[]>((acc,t)=>acc.some(s=>s.id===t.serverId)?acc:[...acc,{id:t.serverId,code:t.serverCode}],[]);
const positionText=(row:RegistryRow)=>row.locations.length?row.locations.map(l=>l.serverCode+'/'+l.vmCode+(roleLabel(l.role)?' · '+roleLabel(l.role):'')).join(', '):'Chưa gán';
const failed=(e:unknown)=>e instanceof Error?e.message:'Chưa lưu được; tải lại và kiểm tra.';
export function EditPreviewTable({rows}:{rows:EditRow[]}){
  return <div className="max-h-72 overflow-auto"><table className="pm-table text-sm"><thead><tr><th>Dòng</th><th>Proxy</th><th>Trước</th><th>Sau</th><th>Kết quả</th></tr></thead><tbody>
    {rows.map((r,i)=><tr key={i}><td className="pm-muted">{r.row}</td><td><div className="font-mono">{r.ip}</div><div className="pm-muted text-xs mt-1">{r.field==='GROUP'?'Từ nhóm':'Vị trí'}</div></td><td>{r.before}</td><td>{r.after}</td><td><span className={`pm-badge ${r.outcome==='ERROR'?'pm-badge-red':r.outcome==='READY'?'pm-badge-green':'pm-badge-muted'}`}>{r.outcome==='READY'?'Sẽ ghi':r.outcome==='SKIP'?'Giữ nguyên':'Lỗi'}</span><p className="pm-muted mt-1 text-xs">{r.message}</p></td></tr>)}
  </tbody></table></div>;
}
// One row, edited in place: group, server, VM, explicit unassign. One click checks and saves when nothing is wrong.
export function RowEditor({projectId,row,groups,targets,canGroup,canLocate,onClose,onSaved}:{projectId:string;row:RegistryRow;groups:ProxyGroupRef[];targets:VmTarget[];canGroup:boolean;canLocate:boolean;onClose:()=>void;onSaved:()=>void}){
  const current=row.locations[0];
  const [group,setGroup]=useState<GroupPick>(row.owner==='OTHER'&&row.groupId?{kind:'GROUP',id:row.groupId}:{kind:'TUT'}),[serverId,setServerId]=useState(current?.serverId||''),[vmId,setVmId]=useState(current?.vmId||''),[rows,setRows]=useState<EditRow[]|null>(null),[error,setError]=useState('');
  const preview=trpc.proxyManagement.editPreview.useMutation(),commit=trpc.proxyManagement.editCommit.useMutation(),busy=preview.isLoading||commit.isLoading;
  const servers=serverChoices(targets),vms=serverId?vmChoices(targets,serverId,row):[];
  useEffect(()=>{if(serverId&&!vms.some(v=>v.id===vmId)) setVmId(vms.find(v=>row.locations.some(l=>l.vmId===v.id))?.id||vms[0]?.id||'');},[serverId]); // eslint-disable-line react-hooks/exhaustive-deps
  const groupChanged=canGroup&&(group.kind==='NEW'||(group.kind==='TUT'?row.owner!=='SELF':group.kind==='GROUP'&&group.id!==row.groupId));
  const locationChanged=canLocate&&!!vmId&&vmId!==current?.vmId;
  async function run(location?:LocationChoice){
    const item:EditItem={endpointId:row.endpointId!};
    if(groupChanged) item.group=toGroupChoice(group);
    if(location) item.location=location;else if(locationChanged) item.location={kind:'VM',vmId};
    if(!item.group&&!item.location){toast('Chưa đổi gì');return;}
    if(item.group?.kind==='NEW'&&!item.group.name){setError('Nhập tên nhóm mới');return;}
    setError('');setRows(null);const key=crypto.randomUUID();
    try{
      const p=await preview.mutateAsync({projectId,items:[item],idempotencyKey:key});
      if(p.errors||!p.ready){setRows(p.rows);if(!p.errors) toast('Không có gì để ghi');return;}
      const r=await commit.mutateAsync({projectId,token:p.token,idempotencyKey:key});toast.success(editSummary(r));onSaved();onClose();
    }catch(e){setError(failed(e));}
  }
  return <div className="pm-editor" role="group" aria-label={'Sửa proxy '+row.ip}>
    <div className="pm-editor-fields">
      {canGroup&&<label className="pm-label">Từ nhóm<GroupChoiceSelect groups={groups} value={group} disabled={busy} onChange={v=>{setGroup(v);setRows(null);}}/></label>}
      {canLocate&&<><label className="pm-label">Server<select aria-label="Server" className="pm-input" disabled={busy} value={serverId} onChange={e=>{setServerId(e.target.value);setRows(null);}}><option value="">— Chọn server —</option>{servers.map(s=><option key={s.id} value={s.id}>{s.code}</option>)}</select></label>
      <label className="pm-label">VM<select aria-label="VM" className="pm-input" disabled={busy||!serverId} value={vmId} onChange={e=>{setVmId(e.target.value);setRows(null);}}>{!vms.length&&<option value="">{serverId?'Server không còn VM trống':'Chọn server trước'}</option>}{vms.map(v=><option key={v.id} value={v.id}>{v.code}{row.locations.some(l=>l.vmId===v.id)?' (hiện tại)':''}</option>)}</select></label></>}
      <div className="pm-muted text-xs self-center">Hiện tại: {positionText(row)}</div>
    </div>
    <div className="flex gap-2 flex-wrap">
      <button className="pm-button pm-button-primary" disabled={busy||(!groupChanged&&!locationChanged)} onClick={()=>void run()}>{busy?<Loader2 size={16} className="animate-spin"/>:<Check size={16}/>}Lưu</button>
      {canLocate&&row.locations.length>0&&<button className="pm-button" disabled={busy} title="Thả bản giao chưa cài; VM trống lại" onClick={()=>void run({kind:'UNASSIGN'})}>Bỏ gán</button>}
      <button className="pm-button pm-button-quiet" disabled={busy} onClick={onClose}><X size={16}/>Huỷ</button>
    </div>
    {error&&<p role="alert" className="pm-error flex gap-2 w-full"><AlertCircle size={16} className="shrink-0"/>{error}</p>}
    {rows&&rows.some(r=>r.outcome!=='READY')&&<ul role="alert" className={'w-full text-sm '+(rows.some(r=>r.outcome==='ERROR')?'pm-error':'pm-muted')}>{rows.filter(r=>r.outcome!=='READY').map((r,i)=><li key={i}>{r.field==='GROUP'?'Từ nhóm':'Vị trí'}: {r.message}</li>)}</ul>}
  </div>;
}
// Bulk edit for the selected rows: one group or one server for all, or a pasted Proxy | Server | VM table. Preview first, then one save.
export function BulkEditPanel({projectId,mode,rows,groups,targets,onClose,onSaved}:{projectId:string;mode:'GROUP'|'SERVER'|'VM';rows:RegistryRow[];groups:ProxyGroupRef[];targets:VmTarget[];onClose:()=>void;onSaved:()=>void}){
  const [group,setGroup]=useState<GroupPick>({kind:'TUT'}),[serverId,setServerId]=useState(''),[text,setText]=useState(()=>pasteTemplate(rows)),[preview,setPreview]=useState<EditPreview|null>(null),[key,setKey]=useState(()=>crypto.randomUUID()),[error,setError]=useState('');
  const inspect=trpc.proxyManagement.editPreview.useMutation(),commit=trpc.proxyManagement.editCommit.useMutation(),busy=inspect.isLoading||commit.isLoading;
  const changed=(fn:()=>void)=>{fn();setPreview(null);setKey(crypto.randomUUID());setError('');};
  const titles={GROUP:'Đổi nhóm cho '+rows.length+' proxy',SERVER:'Chuyển '+rows.length+' proxy sang server',VM:'Gán VM theo bảng dán'};
  const ready=mode==='GROUP'?group.kind!=='NEW'||!!group.name.trim():mode==='SERVER'?!!serverId:!!text.trim();
  async function check(){
    setError('');
    try{
      const input=mode==='VM'?{paste:text}:{items:rows.map(r=>mode==='GROUP'?{endpointId:r.endpointId!,group:toGroupChoice(group)}:{endpointId:r.endpointId!,location:{kind:'SERVER' as const,serverId}})};
      setPreview(await inspect.mutateAsync({projectId,...input,idempotencyKey:key}));
    }catch(e){setError(failed(e));}
  }
  async function save(){
    if(!preview) return;setError('');
    try{const r=await commit.mutateAsync({projectId,token:preview.token,idempotencyKey:key});toast.success(editSummary(r));onSaved();onClose();}
    catch(e){setError(failed(e));setPreview(null);setKey(crypto.randomUUID());}
  }
  return <div className="pm-bulk-panel" role="region" aria-label={titles[mode]}>
    <div className="flex justify-between gap-3 flex-wrap"><strong className="text-sm">{titles[mode]}</strong><button className="pm-icon-button" aria-label="Đóng" disabled={busy} onClick={onClose}><X size={16}/></button></div>
    {mode==='GROUP'&&<label className="pm-label">Nhóm mới cho các proxy đã chọn<GroupChoiceSelect groups={groups} value={group} disabled={busy} onChange={v=>changed(()=>setGroup(v))}/></label>}
    {mode==='SERVER'&&<label className="pm-label">Server đích<select aria-label="Server đích" className="pm-input" disabled={busy} value={serverId} onChange={e=>changed(()=>setServerId(e.target.value))}><option value="">— Chọn server —</option>{serverChoices(targets).map(s=><option key={s.id} value={s.id}>{s.code}</option>)}</select><span className="pm-muted text-xs font-normal">Mỗi proxy nhận VM trống kế tiếp trên server (theo thứ tự tự nhiên); xem trước trước khi lưu.</span></label>}
    {mode==='VM'&&<label className="pm-label">Mỗi dòng: Proxy | Server | VM<textarea aria-label="Bảng ánh xạ Proxy | Server | VM" className="pm-input pm-paste" rows={Math.min(12,Math.max(4,rows.length+1))} disabled={busy} value={text} onChange={e=>changed(()=>setText(e.target.value))}/><span className="pm-muted text-xs font-normal">Ghép theo IP (hoặc IP:port:user:pass) và Server + mã VM, không theo thứ tự dòng. Ô trống giữ nguyên; ghi <code>-</code> ở cột Server để bỏ gán.</span></label>}
    {error&&<p role="alert" className="pm-error flex gap-2"><AlertCircle size={16} className="shrink-0"/>{error}</p>}
    {preview&&<div className="pm-review"><div className="flex gap-4 flex-wrap mb-3 text-sm"><strong>{preview.ready} dòng sẽ ghi</strong><span className="pm-muted">{preview.skipped} giữ nguyên</span><span className={preview.errors?'text-red-500':'pm-muted'}>{preview.errors} lỗi</span></div><EditPreviewTable rows={preview.rows}/></div>}
    <div className="flex justify-end gap-2"><button className="pm-button" disabled={busy} onClick={onClose}>Huỷ</button><button className="pm-button pm-button-primary" disabled={busy||!ready||(!!preview&&!preview.ready)} onClick={preview?save:check}>{busy&&<Loader2 size={16} className="animate-spin"/>}{inspect.isLoading?'Đang kiểm tra…':commit.isLoading?'Đang lưu…':preview?`Lưu ${preview.ready} dòng hợp lệ`:'Xem trước'}</button></div>
  </div>;
}
