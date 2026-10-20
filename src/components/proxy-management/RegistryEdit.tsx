"use client";
import {useEffect,useState} from 'react';
import {trpc} from '@/lib/trpc';
import type {EditItem,EditRow,LocationChoice,ManageChoice,ProxyGroupRef,RegistryRow,VmTarget} from '@/server/proxy-management/types';
// Xoá khỏi kho (owner brief 20/10/2026): ADMIN only, one click, journal reason "Xoá khỏi kho", Hoàn tác in the toast. A proxy still on
// a VM is refused at its row (nothing is unassigned for it); a deleted row (RETIRED) keeps IP, credentials, group and history.
export const DELETE_REASON='Xoá khỏi kho';
import {roleLabel} from './RegistryCells';
import {quickEdit,quickEditMessage,type QuickEditOutcome} from './quick-save';
import {AlertCircle,Check,Loader2,X,RotateCcw} from 'lucide-react';
import toast from 'react-hot-toast';
// "Từ nhóm": TUT is the own stock (owner SELF), genjy is reserved, anything else is an operator-defined group (owner OTHER).
// GENJY = Genjy riêng, SHARED = Chung mooon–Genjy (both only offered on import).
export type GroupPick={kind:'TUT'}|{kind:'GENJY'}|{kind:'SHARED'}|{kind:'GROUP';id:string}|{kind:'NEW';name:string};
export const groupLabel=(row:Pick<RegistryRow,'owner'|'subgroup'|'groupName'>)=>row.owner==='SELF'?'TUT':row.owner==='GENJY'?(row.subgroup==='PC_CHUNG'?'Chung mooon–Genjy':'Genjy riêng'):row.owner==='OTHER'?(row.groupName||'Nhóm khác'):'Chưa xác định';
export function GroupCell({row}:{row:RegistryRow}){
  return <td>{row.owner==='GENJY'?(row.subgroup==='PC_CHUNG'?<span className="pm-badge pm-badge-shared" title="Proxy mooon và Genjy cùng đầu tư">Chung mooon–Genjy</span>:<strong className="font-medium">Genjy riêng</strong>):row.owner==='SELF'?<strong className="font-medium">TUT</strong>:row.owner==='OTHER'?<span>{row.groupName||'Nhóm khác'}</span>:<span className="text-amber-600">Chưa xác định</span>}</td>;
}
export function GroupChoiceSelect({groups,value,onChange,disabled,allowGenjy,className=''}:{groups:ProxyGroupRef[];value:GroupPick;onChange:(v:GroupPick)=>void;disabled?:boolean;allowGenjy?:boolean;className?:string}){
  const current=value.kind==='TUT'?'TUT':value.kind==='GENJY'?'GENJY':value.kind==='SHARED'?'SHARED':value.kind==='NEW'?'__NEW__':value.id;
  return <div className={'flex gap-2 flex-wrap '+className}>
    <select aria-label="Từ nhóm" className="pm-input" disabled={disabled} value={current} onChange={e=>{const v=e.target.value;onChange(v==='TUT'?{kind:'TUT'}:v==='GENJY'?{kind:'GENJY'}:v==='SHARED'?{kind:'SHARED'}:v==='__NEW__'?{kind:'NEW',name:''}:{kind:'GROUP',id:v});}}>
      <option value="TUT">TUT</option>{allowGenjy&&<option value="SHARED">Chung mooon–Genjy</option>}{allowGenjy&&<option value="GENJY">Genjy riêng</option>}{groups.filter(g=>!g.archivedAt||(value.kind==='GROUP'&&value.id===g.id)).map(g=><option key={g.id} value={g.id}>{g.name}{g.archivedAt?' (lưu trữ)':''}</option>)}<option value="__NEW__">Nhóm mới…</option>
    </select>
    {value.kind==='NEW'&&<input autoFocus aria-label="Tên nhóm mới" className="pm-input" maxLength={60} placeholder="Tên nhóm mới" disabled={disabled} value={value.name} onChange={e=>onChange({kind:'NEW',name:e.target.value})}/>}
  </div>;
}
export const toGroupChoice=(v:GroupPick):EditItem['group']=>v.kind==='GROUP'?{kind:'GROUP',id:v.id}:v.kind==='NEW'?{kind:'NEW',name:v.name.trim()}:v.kind==='SHARED'?{kind:'SHARED'}:v.kind==='GENJY'?{kind:'GENJY'}:{kind:'TUT'};
// The row's current class as a choice of the "Từ nhóm" select.
export const rowPick=(row:Pick<RegistryRow,'owner'|'subgroup'|'groupId'>):GroupPick=>row.owner==='GENJY'?(row.subgroup==='PC_CHUNG'?{kind:'SHARED'}:{kind:'GENJY'}):row.owner==='OTHER'&&row.groupId?{kind:'GROUP',id:row.groupId}:{kind:'TUT'};
export const pasteTemplate=(rows:RegistryRow[])=>rows.map(r=>{const l=r.locations[0];return l?`${r.ip} | ${l.serverCode} | ${l.vmCode}`:`${r.ip} | | `;}).join('\n');
export const editSummary=(r:{applied:number;skipped:number;errors:number})=>(r.applied?`Đã ghi ${r.applied} dòng`:'Không ghi dòng nào')+(r.skipped?` · ${r.skipped} giữ nguyên`:'')+(r.errors?` · ${r.errors} lỗi`:'');
// VMs the row may move to on a server: free ones plus the VM it already sits on. A VM used by another proxy is never offered.
export const vmChoices=(targets:VmTarget[],serverId:string,row:RegistryRow)=>targets.filter(t=>t.serverId===serverId&&(!t.occupant||row.locations.some(l=>l.vmId===t.id)));
export const serverChoices=(targets:VmTarget[])=>targets.reduce<{id:string;code:string}[]>((acc,t)=>acc.some(s=>s.id===t.serverId)?acc:[...acc,{id:t.serverId,code:t.serverCode}],[]);
export function useInventoryDelete(projectId:string,onSaved:()=>void){
  const inspect=trpc.proxyManagement.editPreview.useMutation(),commit=trpc.proxyManagement.editCommit.useMutation(),undo=trpc.proxyManagement.undo.useMutation();
  const [busy,setBusy]=useState(false);
  async function run(rows:RegistryRow[],kind:'RETIRE'|'RESTORE'):Promise<QuickEditOutcome|null>{
    if(busy||!rows.length) return null;setBusy(true);
    try{
      const o=await quickEdit({projectId,items:rows.map(r=>({endpointId:r.endpointId!,manage:kind==='RETIRE'?{kind:'RETIRE' as const,reason:DELETE_REASON}:{kind:'RESTORE' as const}})),idempotencyKey:crypto.randomUUID()},inspect.mutateAsync,x=>commit.mutateAsync({projectId,...x}));
      const word=kind==='RETIRE'?'Đã xoá':'Đã khôi phục';
      if(o.applied){onSaved();toast.success(t=><span className="flex items-center gap-3">{word} {o.applied} proxy{o.errors.length?` · ${o.errors.length} dòng bị chặn`:''}{o.operationId&&<button className="pm-button pm-button-quiet" onClick={()=>{toast.dismiss(t.id);undo.mutateAsync({projectId,id:o.operationId!,reason:''}).then(()=>{toast.success('Đã hoàn tác');onSaved();}).catch(e=>toast.error(failed(e)));}}>Hoàn tác</button>}</span>,{duration:8000});}
      else if(o.errors.length) toast.error(o.errors.length===1?o.errors[0].ip+' — '+o.errors[0].message:o.errors.length+' dòng bị chặn; lý do ghi tại từng dòng',{duration:6000});
      else toast('Không thay đổi');
      return o;
    }catch(e){toast.error(failed(e));return null;}finally{setBusy(false);}
  }
  return {busy,remove:(rows:RegistryRow[])=>run(rows,'RETIRE'),restore:(rows:RegistryRow[])=>run(rows,'RESTORE')};
}
const positionText=(row:RegistryRow)=>row.locations.length?row.locations.map(l=>l.serverCode+'/'+l.vmCode+(roleLabel(l.role)?' · '+roleLabel(l.role):'')).join(', '):'Chưa gán';
const failed=(e:unknown)=>e instanceof Error?e.message:'Chưa lưu được; tải lại và kiểm tra.';
export function EditPreviewTable({rows}:{rows:EditRow[]}){
  return <div className="max-h-72 overflow-auto"><table className="pm-table text-sm"><thead><tr><th>Dòng</th><th>Proxy</th><th>Trước</th><th>Sau</th><th>Kết quả</th></tr></thead><tbody>
    {rows.map((r,i)=><tr key={i}><td className="pm-muted">{r.row}</td><td><div className="font-mono">{r.ip}</div><div className="pm-muted text-xs mt-1">{r.field==='GROUP'?'Từ nhóm':r.field==='STATE'?'Trạng thái':'Vị trí'}</div></td><td>{r.before}</td><td>{r.after}</td><td><span className={`pm-badge ${r.outcome==='ERROR'?'pm-badge-red':r.outcome==='READY'?'pm-badge-green':'pm-badge-muted'}`}>{r.outcome==='READY'?'Sẽ ghi':r.outcome==='SKIP'?'Giữ nguyên':'Lỗi'}</span><p className="pm-muted mt-1 text-xs">{r.message}</p></td></tr>)}
  </tbody></table></div>;
}
// One row, edited in place: group, server, VM, explicit unassign. One click checks and saves when nothing is wrong.
// Every row can change class (TUT / Chung mooon–Genjy / Genjy riêng / own groups) and flip NEW ↔ LIVE; the server checks VM rules.
// Status follows the real holds for TUT / Chung mooon–Genjy: picking LIVE asks for a Server/VM, picking NEW unassigns in the same save,
// BLOCKED goes through the controlled BLOCKED write. Choosing a server alone never saves anything (no VM → still NEW).
export function RowEditor({projectId,row,groups,targets,canGroup,canLocate,canUnassign=canLocate,canBlock=false,canDelete=false,onClose,onSaved}:{projectId:string;row:RegistryRow;groups:ProxyGroupRef[];targets:VmTarget[];canGroup:boolean;canLocate:boolean;canUnassign?:boolean;canBlock?:boolean;canDelete?:boolean;onClose:()=>void;onSaved:()=>void}){
  const current=row.locations[0],initialPick=rowPick(row);
  const [state,setState]=useState(row.state),stateEditable=(canLocate||canUnassign||canBlock||canGroup)&&(row.state==='NEW'||row.state==='LIVE');
  const followsRule=row.owner==='SELF'||(row.owner==='GENJY'&&row.subgroup==='PC_CHUNG'),held=row.locations.some(l=>l.role==='DESIRED'||l.role==='INSTALLED');
  const [group,setGroup]=useState<GroupPick>(initialPick),[serverId,setServerId]=useState(current?.serverId||''),[vmId,setVmId]=useState(current?.vmId||''),[rows,setRows]=useState<EditRow[]|null>(null),[error,setError]=useState('');
  const retired=row.state==='RETIRED';
  const preview=trpc.proxyManagement.editPreview.useMutation(),commit=trpc.proxyManagement.editCommit.useMutation(),busy=preview.isLoading||commit.isLoading;
  const servers=serverChoices(targets),vms=serverId?vmChoices(targets,serverId,row):[];
  useEffect(()=>{if(serverId&&!vms.some(v=>v.id===vmId)) setVmId(vms.find(v=>row.locations.some(l=>l.vmId===v.id))?.id||'');},[serverId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Saves right away: a picked group, VM or status is written in one request (preview + commit on the server, same checks).
  // Only an unassign caused by choosing NEW on a held row asks once, because it changes the VM allocation.
  async function run(location?:LocationChoice,manage?:ManageChoice,pick:{group?:GroupPick;vmId?:string;state?:typeof state}={}){
    const g=pick.group??group,v=pick.vmId??vmId,st=pick.state??state;
    const item:EditItem={endpointId:row.endpointId!};
    if(manage) item.manage=manage;
    else{
      if(canGroup&&JSON.stringify(g)!==JSON.stringify(initialPick)) item.group=toGroupChoice(g);
      if(location) item.location=location;else if(canLocate&&v&&v!==current?.vmId) item.location={kind:'VM',vmId:v};
      if(st!==row.state&&st==='BLOCKED') item.manage={kind:'STATE',state:'BLOCKED'};
      else if(st!==row.state&&st==='NEW'&&followsRule&&held&&!item.location){
        if(!window.confirm('Bỏ gán '+positionText(row)+' để về NEW? (Không ghi nhận đã gỡ ngoài máy)')){setState(row.state);return;}
        item.location={kind:'UNASSIGN'};
      }
      else if(st!==row.state&&(st==='NEW'||st==='LIVE')) item.manage={kind:'STATE',state:st};
    }
    if(!item.group&&!item.location&&!item.manage) return; // same value again: nothing to save, no history
    if(item.group?.kind==='NEW'&&!item.group.name){setError('Nhập tên nhóm mới rồi bấm Enter');return;}
    setError('');setRows(null);const key=crypto.randomUUID();
    try{
      const p=await preview.mutateAsync({projectId,items:[item],idempotencyKey:key});
      if(p.errors){setRows(p.rows);return;} // keep what the user picked; show why
      if(!p.ready){onClose();return;}
      await commit.mutateAsync({projectId,token:p.token,idempotencyKey:key});toast.success('Đã lưu');onSaved();onClose();
    }catch(e){setError(failed(e));}
  }
  if(retired) return <div className="pm-editor" role="group" aria-label={'Sửa proxy '+row.ip}>
    <div className="pm-muted text-xs">Đã xoá khỏi kho. IP, user/pass, nhóm và lịch sử vẫn được giữ; khôi phục sẽ trả về trạng thái trước.</div>
    <div className="flex gap-2 flex-wrap"><button className="pm-button pm-button-primary" disabled={busy||!canDelete} onClick={()=>void run(undefined,{kind:'RESTORE'})}>{busy?<Loader2 size={16} className="animate-spin"/>:<RotateCcw size={16}/>}Khôi phục</button><button className="pm-button pm-button-quiet" disabled={busy} onClick={onClose}><X size={16}/>Huỷ</button></div>
    {error&&<p role="alert" className="pm-error flex gap-2 w-full"><AlertCircle size={16} className="shrink-0"/>{error}</p>}
    {rows&&rows.some(r=>r.outcome!=='READY')&&<ul role="alert" className={'w-full text-sm '+(rows.some(r=>r.outcome==='ERROR')?'pm-error':'pm-muted')}>{rows.filter(r=>r.outcome!=='READY').map((r,i)=><li key={i}>{r.message}</li>)}</ul>}
  </div>;
  return <div className="pm-editor" role="group" aria-label={'Sửa proxy '+row.ip}>
    <div className="pm-editor-fields">
      {canGroup&&<label className="pm-label">Từ nhóm<GroupChoiceSelect groups={groups} value={group} disabled={busy} allowGenjy onChange={v=>{setGroup(v);setRows(null);if(v.kind!=='NEW') void run(undefined,undefined,{group:v});}}/></label>}
      {stateEditable&&<label className="pm-label">Trạng thái<select aria-label="Trạng thái" className="pm-input" disabled={busy} value={state} onChange={e=>{const v=e.target.value as typeof state;setState(v);setRows(null);setError('');void run(undefined,undefined,{state:v});}}><option value="NEW">NEW — trong kho</option><option value="LIVE">LIVE — đang dùng</option>{canBlock&&<option value="BLOCKED">BLOCKED</option>}</select></label>}
      {canLocate&&<><label className="pm-label">Server<select aria-label="Server" className="pm-input" disabled={busy} value={serverId} onChange={e=>{setServerId(e.target.value);setRows(null);}}><option value="">— Chọn server —</option>{servers.map(s=><option key={s.id} value={s.id}>{s.code}</option>)}</select></label>
      <label className="pm-label">VM<select aria-label="VM" className="pm-input" disabled={busy||!serverId} value={vmId} onChange={e=>{const v=e.target.value;setVmId(v);setRows(null);if(v) void run(undefined,undefined,{vmId:v});}}>{!vms.length?<option value="">{serverId?'Server không còn VM trống':'Chọn server trước'}</option>:<option value="">— Chọn VM —</option>}{vms.map(v=><option key={v.id} value={v.id}>{v.code}{row.locations.some(l=>l.vmId===v.id)?' (hiện tại)':''}</option>)}</select></label></>}
      <div className="pm-muted text-xs self-center">Hiện tại: {positionText(row)}</div>
    </div>
    <div className="flex gap-2 flex-wrap">
      {busy&&<span className="pm-muted text-sm flex items-center gap-2"><Loader2 size={16} className="animate-spin"/>Đang lưu…</span>}
      {group.kind==='NEW'&&<button className="pm-button pm-button-primary" disabled={busy||!group.name.trim()} onClick={()=>void run()}><Check size={16}/>Lưu nhóm mới</button>}
      {canUnassign&&row.locations.length>0&&<button className="pm-button" disabled={busy} title="Bỏ gán; VM trống lại" onClick={()=>void run({kind:'UNASSIGN'})}>Bỏ gán</button>}
      <button className="pm-button pm-button-quiet" disabled={busy} onClick={onClose}><X size={16}/>Huỷ</button>
    </div>
    {error&&<p role="alert" className="pm-error flex gap-2 w-full"><AlertCircle size={16} className="shrink-0"/>{error}</p>}
    {rows&&rows.some(r=>r.outcome!=='READY')&&<ul role="alert" className={'w-full text-sm '+(rows.some(r=>r.outcome==='ERROR')?'pm-error':'pm-muted')}>{rows.filter(r=>r.outcome!=='READY').map((r,i)=><li key={i}>{r.field==='GROUP'?'Từ nhóm':r.field==='STATE'?'Trạng thái':'Vị trí'}: {r.message}</li>)}</ul>}
  </div>;
}
// Bulk edit for the selected rows: one group or one server for all, or a pasted Proxy | Server | VM table. Preview first, then one save.
export type BulkMode='GROUP'|'SERVER'|'VM'|'STATE';
export function BulkEditPanel({projectId,mode,rows,groups,targets,onClose,onSaved}:{projectId:string;mode:BulkMode;rows:RegistryRow[];groups:ProxyGroupRef[];targets:VmTarget[];onClose:()=>void;onSaved:()=>void}){
  const [group,setGroup]=useState<GroupPick>({kind:'TUT'}),[bulkState,setBulkState]=useState<'NEW'|'LIVE'|'BLOCKED'>('NEW'),[bulkUnassign,setBulkUnassign]=useState(false),[serverId,setServerId]=useState(''),[text,setText]=useState(()=>pasteTemplate(rows)),[error,setError]=useState('');
  const [failures,setFailures]=useState<{ip:string;message:string}[]>([]);
  const inspect=trpc.proxyManagement.editPreview.useMutation(),commit=trpc.proxyManagement.editCommit.useMutation(),busy=inspect.isLoading||commit.isLoading;
  const changed=(fn:()=>void)=>{fn();setFailures([]);setError('');};
  const titles={GROUP:'Đổi nhóm cho '+rows.length+' proxy',SERVER:'Chuyển '+rows.length+' proxy sang server',VM:'Gán VM theo bảng dán',STATE:'Đổi trạng thái '+rows.length+' proxy'};
  const ready=mode==='GROUP'?group.kind!=='NEW'||!!group.name.trim():mode==='SERVER'?!!serverId:mode==='VM'?!!text.trim():true;
  // One click: build the change, write it (server checks every row), report what was saved and what was refused.
  async function apply(){
    setError('');setFailures([]);
    const input=mode==='VM'?{paste:text}:{items:rows.map(r=>mode==='GROUP'?{endpointId:r.endpointId!,group:toGroupChoice(group)}:{endpointId:r.endpointId!,location:{kind:'SERVER' as const,serverId}})};
    try{const o=await quickEdit({projectId,...input,idempotencyKey:crypto.randomUUID()},inspect.mutateAsync,x=>commit.mutateAsync({projectId,...x}));
      if(o.applied) onSaved();
      if(o.errors.length){setFailures(o.errors);toast(quickEditMessage(o));}else{toast.success(quickEditMessage(o));onClose();}
    }catch(e){setError(failed(e));}
  }
  return <div className="pm-bulk-panel" role="region" aria-label={titles[mode]}>
    <div className="flex justify-between gap-3 flex-wrap"><strong className="text-sm">{titles[mode]}</strong><button className="pm-icon-button" aria-label="Đóng" disabled={busy} onClick={onClose}><X size={16}/></button></div>
    {mode==='GROUP'&&<label className="pm-label">Nhóm mới cho các proxy đã chọn<GroupChoiceSelect groups={groups} value={group} disabled={busy} allowGenjy onChange={v=>changed(()=>setGroup(v))}/><span className="pm-muted text-xs font-normal">TUT và Chung mooon–Genjy giữ vị trí VM; Genjy riêng và nhóm tự đặt phải bỏ gán trước. Giữ IP, user/pass, nguồn, lịch sử; hoàn tác được.</span></label>}
    {mode==='STATE'&&<label className="pm-label">Trạng thái mới<select aria-label="Trạng thái mới" className="pm-input" disabled={busy} value={bulkState} onChange={e=>changed(()=>setBulkState(e.target.value as 'NEW'|'LIVE'|'BLOCKED'))}><option value="NEW">NEW — trong kho</option><option value="LIVE">LIVE — đã gán VM</option><option value="BLOCKED">BLOCKED</option></select>{bulkState==='NEW'&&<label className="flex gap-2 text-sm items-center font-normal mt-2"><input type="checkbox" checked={bulkUnassign} onChange={e=>changed(()=>setBulkUnassign(e.target.checked))}/>Bỏ gán các dòng đang dùng ở VM để về NEW</label>}<span className="pm-muted text-xs font-normal">NEW/LIVE theo vị trí VM thật: LIVE cần gán VM (dùng Chuyển server / Gán VM), NEW cần bỏ gán. BLOCKED giữ vị trí VM. Dòng đã replace hoặc ngừng quản lý giữ nguyên.</span></label>}
    {mode==='SERVER'&&<label className="pm-label">Server đích<select aria-label="Server đích" className="pm-input" disabled={busy} value={serverId} onChange={e=>changed(()=>setServerId(e.target.value))}><option value="">— Chọn server —</option>{serverChoices(targets).map(s=><option key={s.id} value={s.id}>{s.code}</option>)}</select><span className="pm-muted text-xs font-normal">Mỗi proxy nhận VM trống kế tiếp trên server (theo thứ tự tự nhiên); xem trước trước khi lưu.</span></label>}
    {mode==='VM'&&<label className="pm-label">Mỗi dòng: Proxy | Server | VM<textarea aria-label="Bảng ánh xạ Proxy | Server | VM" className="pm-input pm-paste" rows={Math.min(12,Math.max(4,rows.length+1))} disabled={busy} value={text} onChange={e=>changed(()=>setText(e.target.value))}/><span className="pm-muted text-xs font-normal">Ghép theo IP (hoặc IP:port:user:pass) và Server + mã VM, không theo thứ tự dòng. Ô trống giữ nguyên; ghi <code>-</code> ở cột Server để bỏ gán.</span></label>}
    {error&&<p role="alert" className="pm-error flex gap-2"><AlertCircle size={16} className="shrink-0"/>{error}</p>}
    {failures.length>0&&<ul role="alert" className="pm-error text-sm">{failures.map((f,i)=><li key={i}><span className="font-mono">{f.ip}</span> — {f.message}</li>)}</ul>}
    <div className="flex justify-end gap-2"><button className="pm-button" disabled={busy} onClick={onClose}>Huỷ</button><button className="pm-button pm-button-primary" disabled={busy||!ready} onClick={()=>void apply()}>{busy&&<Loader2 size={16} className="animate-spin"/>}{busy?'Đang lưu…':'Áp dụng'}</button></div>
  </div>;
}
// Status straight from the table cell: pick NEW / LIVE / BLOCKED and it is saved (same checked write as everything else).
// LIVE needs no VM ("in use"); NEW on a row that a VM still holds asks once, because it releases that plan.
export function StatusQuick({projectId,row,canBlock,onSaved}:{projectId:string;row:RegistryRow;canBlock:boolean;onSaved:()=>void}){
  const [value,setValue]=useState(row.state),inspect=trpc.proxyManagement.editPreview.useMutation(),commit=trpc.proxyManagement.editCommit.useMutation(),busy=inspect.isLoading||commit.isLoading;
  useEffect(()=>setValue(row.state),[row.state,row.revision]);
  const held=row.locations.some(l=>l.role==='DESIRED'||l.role==='INSTALLED'),rule=row.owner==='SELF'||(row.owner==='GENJY'&&row.subgroup==='PC_CHUNG');
  async function pick(next:typeof value){
    if(next===row.state) return;
    const item:EditItem={endpointId:row.endpointId!,manage:{kind:'STATE',state:next as 'NEW'|'LIVE'|'BLOCKED'}};
    if(next==='NEW'&&rule&&held){if(!window.confirm('Bỏ gán '+positionText(row)+' để về NEW? (Không ghi nhận đã gỡ ngoài máy)')){setValue(row.state);return;}item.location={kind:'UNASSIGN'};}
    setValue(next);
    try{const o=await quickEdit({projectId,items:[item],idempotencyKey:crypto.randomUUID()},inspect.mutateAsync,x=>commit.mutateAsync({projectId,...x}));
      if(o.errors.length){setValue(row.state);toast.error(o.errors[0].message);return;}
      toast.success('Đã lưu');onSaved();
    }catch(e){setValue(row.state);toast.error(failed(e));}
  }
  const tone=value==='NEW'?'pm-badge-blue':value==='LIVE'?'pm-badge-green':'pm-badge-red';
  return <select aria-label={'Trạng thái '+row.ip} className={'pm-badge pm-status-select '+tone} disabled={busy} value={value} onChange={e=>void pick(e.target.value as typeof value)}><option value="NEW">NEW</option><option value="LIVE">LIVE</option>{canBlock&&<option value="BLOCKED">BLOCKED</option>}</select>;
}
