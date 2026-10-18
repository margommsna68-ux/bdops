"use client";
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {links} from '@/lib/links';
import {Check,Copy,MoreHorizontal,X,Server} from 'lucide-react';
import toast from 'react-hot-toast';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {localDate} from '@/components/proxy-management/HistoryPanel';
import {displayNote} from '@/server/vm-management/vm-codes';
import {vmView,proxyAddress} from '../workflow';
import type {ManagedVM} from '../shared';
import {AccountCell,type VmAccount} from './AccountCell';
import {StatusCell} from './StatusCell';
import {OpsStatusCell,PayoutCell,type OpsRow,type OpsRights} from './OpsCells';
import type {VmOpsStatus} from '@/lib/vm-ops';
import type {StatusActionKind} from './status-actions';
import {FIXED,editableFields,nextCell,resizeColumn,shortCode,visibleColumns,widthOf,type ColumnKey,type EditField,type GridPrefs,type PanelTab} from './grid-model';
export interface GridRights {manage:boolean;assign:boolean;copy:boolean;confirm:boolean;costs:boolean;sourceConnected:boolean}
export type CopyWhich='DESIRED'|'INSTALLED';
type Draft=Record<string,string>;
const draftKey=(vmId:string,field:EditField)=>vmId+'|'+field;
const LIMIT:Record<EditField,number>={code:64,sdk:128,notes:1000};
// Unsaved cell text survives refresh, filter changes and closing the side panel; it is dropped only by saving or Escape/✕.
export function useDrafts(projectId:string){
  const key='mth.vm-grid.drafts.'+projectId,[drafts,setDrafts]=useState<Draft>({}),loaded=useRef(false);
  useEffect(()=>{try{const raw=localStorage.getItem(key);if(raw) setDrafts(JSON.parse(raw) as Draft);}catch{/* private mode: drafts stay in memory */}loaded.current=true;},[key]);
  useEffect(()=>{if(!loaded.current) return;try{if(Object.keys(drafts).length) localStorage.setItem(key,JSON.stringify(drafts));else localStorage.removeItem(key);}catch{/* ignore */}},[key,drafts]);
  // Functional updates: a save followed by opening the next cell must not resurrect the draft that was just saved.
  return {drafts,set:(vmId:string,field:EditField,value:string)=>setDrafts(d=>({...d,[draftKey(vmId,field)]:value})),open:(vmId:string,field:EditField,value:string)=>setDrafts(d=>draftKey(vmId,field) in d?d:{...d,[draftKey(vmId,field)]:value}),drop:(vmId:string,field:EditField)=>setDrafts(d=>{const n={...d};delete n[draftKey(vmId,field)];return n;}),clear:()=>setDrafts({})};
}
export function reviewReason(v:ManagedVM){const blocked=v.holds.some(h=>h.state==='BLOCKED');return v.desired?.failureNote||(blocked?'Proxy BLOCKED':v.holds.some(h=>h.owner!=='SELF'&&!h.shared)?'Proxy Genjy / chưa rõ sở hữu':v.holds.some(h=>h.role==='UNCERTAIN')?'Proxy cần kiểm tra thực tế':'Ô cũ có công thức / nội dung chưa rõ');}
function currentValue(v:ManagedVM,field:EditField){return field==='code'?v.code:field==='sdk'?v.sdk?.id||'':displayNote(v.notes)||'';}
// Proxy cell: assigned and installed side by side only when they differ; the same configuration is one line with "Đã cài".
function ProxyCell({v,canCopy,onCopy}:{v:ManagedVM;canCopy:boolean;onCopy:(which:CopyWhich)=>void}){
  const d=v.desired,i=v.installed,same=d&&i&&d.id===i.id,extra=v.holds.filter(h=>h.role==='UNCERTAIN'&&h.endpointId!==d?.endpointId&&h.endpointId!==i?.endpointId);
  const copy=(which:CopyWhich,label:string)=>canCopy&&<button type="button" className="vm-cell-icon" aria-label={label+' '+v.code} title={label} onClick={e=>{e.stopPropagation();onCopy(which);}}><Copy size={13}/></button>;
  if(!d&&!i&&!extra.length) return <span className="pm-muted">—</span>;
  return <div className={'vm-proxy'+(d&&i&&!same?' vm-proxy-diff':'')}>
    {same?<div className="vm-proxy-line"><span className="pm-ip vm-ellipsis" title={proxyAddress(i)}>{proxyAddress(i)}</span><span className="vm-tag vm-tag-ok">Đã cài</span>{copy('INSTALLED','Copy đã cài')}</div>:<>
      {d&&<div className="vm-proxy-line"><span className="vm-tag vm-tag-plan">Giao</span><span className="pm-ip vm-ellipsis" title={proxyAddress(d)}>{proxyAddress(d)}</span>{copy('DESIRED','Copy được giao')}</div>}
      {i&&<div className="vm-proxy-line"><span className="vm-tag vm-tag-ok">Cài</span><span className="pm-ip vm-ellipsis" title={proxyAddress(i)}>{proxyAddress(i)}</span>{copy('INSTALLED','Copy đã cài')}</div>}</>}
    {extra.length>0&&<div className="vm-proxy-line pm-muted text-xs vm-ellipsis" title={extra.map(h=>h.ip).join(', ')}>Giữ kiểm tra: {extra.map(h=>h.ip).join(', ')}</div>}
  </div>;
}
function CellEditor({field,label,value,error,active,saving,onChange,onSave,onCancel,onFocus}:{field:EditField;label:string;value:string;error?:string;active:boolean;saving:boolean;onChange:(v:string)=>void;onSave:(dir:'next'|'prev'|null)=>void;onCancel:()=>void;onFocus:()=>void}){
  const ref=useRef<HTMLInputElement&HTMLTextAreaElement>(null);
  useEffect(()=>{if(active&&ref.current&&document.activeElement!==ref.current){ref.current.focus();const n=ref.current.value.length;ref.current.setSelectionRange(n,n);}},[active]);
  const keys=(e:React.KeyboardEvent)=>{
    if(e.nativeEvent.isComposing||e.keyCode===229) return; // Vietnamese IME still composing: never save or move
    if(saving){if(['Enter','Tab','Escape'].includes(e.key)) e.preventDefault();return;} // one save at a time; focus stays in the cell
    if(e.key==='Escape'){e.preventDefault();onCancel();}
    else if(e.key==='Enter'&&!(field==='notes'&&e.shiftKey)){e.preventDefault();onSave(null);}
    else if(e.key==='Tab'){e.preventDefault();onSave(e.shiftKey?'prev':'next');}
  };
  const common={ref,'aria-label':label,value,readOnly:saving,'aria-busy':saving,maxLength:LIMIT[field],onChange:(e:React.ChangeEvent<HTMLInputElement&HTMLTextAreaElement>)=>onChange(e.target.value),onKeyDown:keys,onFocus,className:'pm-input vm-cell-input'+(field!=='notes'?' pm-code':'')};
  return <div className="vm-cell-edit" data-draft="true">
    {field==='notes'?<textarea rows={2} {...common}/>:<input {...common}/>}
    <span className="vm-cell-edit-actions"><button type="button" className="vm-cell-icon" aria-label={'Lưu '+label} disabled={saving} onClick={()=>onSave(null)}><Check size={14}/></button><button type="button" className="vm-cell-icon" aria-label={'Huỷ sửa '+label} disabled={saving} onClick={onCancel}><X size={14}/></button></span>
    {error&&<span role="alert" className="vm-cell-error">{error}</span>}
  </div>;
}
export function VmGrid(props:{projectId:string;rows:ManagedVM[];single:boolean;deletedView:boolean;prefs:GridPrefs;onPrefs:(p:GridPrefs)=>void;rights:GridRights;selected:Set<string>;onToggle:(id:string,on:boolean)=>void;onTogglePage:(on:boolean)=>void;accountOf:(vmId:string)=>VmAccount|undefined;activeVmId:string|null;maxHeight:number;loading:boolean;emptyText:string;
  onOpen:(vmId:string,tab?:PanelTab)=>void;onCopy:(vm:ManagedVM,which:CopyWhich)=>void;onCopyToInstall:(vm:ManagedVM)=>void;onDelete:(vm:ManagedVM)=>void;onRestore:(vm:ManagedVM)=>void;onSave:(vm:ManagedVM,field:EditField,value:string)=>Promise<void>;onStatus:(vm:ManagedVM,kind:StatusActionKind,note?:string)=>Promise<string|void>;
  opsOf:(vmId:string)=>OpsRow|undefined;opsRights:OpsRights;onOpsStatus:(vm:ManagedVM,status:VmOpsStatus,cycle:number)=>Promise<void>;onOpsDone:()=>Promise<unknown>|void}){
  const {rows,single,deletedView,prefs,rights,selected}=props,columns=visibleColumns(prefs),drafts=useDrafts(props.projectId);
  // A row whose status action is saving is locked (other cells and ⋯) until the answer comes back.
  const [busyRows,setBusyRows]=useState<Set<string>>(new Set()),markBusy=(id:string,on:boolean)=>setBusyRows(p=>{const n=new Set(p);if(on)n.add(id);else n.delete(id);return n;});
  const [active,setActive]=useState<{vmId:string;field:EditField}|null>(null),[errors,setErrors]=useState<Record<string,string>>({}),[saving,setSaving]=useState<string|null>(null);
  const fields=deletedView?[]:editableFields(prefs,{manage:rights.manage,assign:rights.assign}),rowIds=rows.map(r=>r.id);
  const serverW=single?0:widthOf(prefs,'server'),vmW=widthOf(prefs,'vm'),selectW=FIXED.select,opsW=FIXED.ops;
  const total=selectW+serverW+vmW+opsW+columns.reduce((n,c)=>n+widthOf(prefs,c.key),0)+FIXED.menu;
  const allOnPage=rows.length>0&&rows.every(v=>selected.has(v.id)),someOnPage=rows.some(v=>selected.has(v.id));
  const headCheck=useRef<HTMLInputElement>(null);useEffect(()=>{if(headCheck.current) headCheck.current.indeterminate=someOnPage&&!allOnPage;},[someOnPage,allOnPage]);
  const canEdit=(field:EditField)=>fields.includes(field);
  const start=(v:ManagedVM,field:EditField)=>{if(!canEdit(field)) return;drafts.open(v.id,field,currentValue(v,field));setActive({vmId:v.id,field});};
  const cancel=(v:ManagedVM,field:EditField)=>{drafts.drop(v.id,field);setErrors(e=>{const n={...e};delete n[draftKey(v.id,field)];return n;});setActive(null);focusCell(v.id,field);};
  function focusCell(vmId:string,field:EditField){requestAnimationFrame(()=>document.querySelector<HTMLElement>(`[data-cell="${vmId}|${field}"]`)?.focus());}
  async function save(v:ManagedVM,field:EditField,dir:'next'|'prev'|null){
    const k=draftKey(v.id,field),value=(drafts.drafts[k]??'').trim(),move=()=>{const next=dir?nextCell(rowIds,fields,{vmId:v.id,field},dir==='prev'):null;if(next){const vm=rows.find(r=>r.id===next.vmId)!;start(vm,next.field);}else{setActive(null);focusCell(v.id,field);}};
    if(value===currentValue(v,field).trim()){drafts.drop(v.id,field);move();return;} // same value: nothing written, no history
    if(field==='code'&&!value){setErrors(e=>({...e,[k]:'Mã VM không được để trống'}));return;}
    if(field==='sdk'&&!value){setErrors(e=>({...e,[k]:'Để xoá SDK, dùng nút Xoá SDK trong chi tiết VM'}));return;}
    setSaving(k);setErrors(e=>{const n={...e};delete n[k];return n;});
    try{await props.onSave(v,field,value);drafts.drop(v.id,field);move();}
    catch(e){setErrors(x=>({...x,[k]:e instanceof Error?e.message:'Chưa lưu được'}));setActive({vmId:v.id,field});} // input and focus stay
    finally{setSaving(null);}
  }
  const editable=(v:ManagedVM,field:EditField,label:string,view:React.ReactNode)=>{
    const k=draftKey(v.id,field),draft=drafts.drafts[k];
    if(draft!==undefined&&canEdit(field)) return <CellEditor field={field} label={label} value={draft} error={errors[k]} active={active?.vmId===v.id&&active.field===field} saving={saving===k} onChange={x=>drafts.set(v.id,field,x)} onSave={dir=>void save(v,field,dir)} onCancel={()=>cancel(v,field)} onFocus={()=>setActive({vmId:v.id,field})}/>;
    return <div className={'vm-cell-view'+(canEdit(field)?' vm-cell-editable':'')} data-cell={k} tabIndex={canEdit(field)?0:-1} title={canEdit(field)?'Enter hoặc F2 để sửa':undefined} onDoubleClick={()=>start(v,field)} onKeyDown={e=>{if((e.key==='Enter'||e.key==='F2')&&canEdit(field)){e.preventDefault();start(v,field);}}}>{view}</div>;
  };
  function resizer(key:ColumnKey|'server'|'vm'){
    return <span className="vm-col-resize" role="separator" aria-label="Kéo để đổi độ rộng cột" onMouseDown={e=>{e.preventDefault();e.stopPropagation();const x0=e.clientX,w0=widthOf(prefs,key);let latest=prefs;
      const move=(m:MouseEvent)=>{latest=resizeColumn(prefs,key,w0+m.clientX-x0);props.onPrefs(latest);};const up=()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);};
      window.addEventListener('mousemove',move);window.addEventListener('mouseup',up);}}/>;
  }
  const left=(n:number)=>({position:'sticky' as const,left:n});
  const cell=(v:ManagedVM,key:ColumnKey)=>{

    if(key==='proxy') return <ProxyCell v={v} canCopy={rights.copy} onCopy={w=>props.onCopy(v,w)}/>;
    if(key==='sdk'){const view=v.sdk?<span className="vm-sdk-short"><code className="vm-sdk vm-ellipsis" title={v.sdk.id}>{shortCode(v.sdk.id)}</code><button type="button" className="vm-cell-icon" aria-label={'Copy SDK '+v.code} title="Copy SDK đầy đủ" onClick={e=>{e.stopPropagation();navigator.clipboard?.writeText(v.sdk!.id).then(()=>toast.success('Đã copy SDK '+v.code)).catch(()=>toast.error('Trình duyệt chặn copy; mở chi tiết để chọn mã'));}}><Copy size={13}/></button></span>:<span className="vm-sdk-missing">Chưa có SDK</span>;return deletedView?view:editable(v,'sdk','SDK '+v.code,view);}
    if(key==='account'||key==='paypal') return <AccountCell projectId={props.projectId} vm={v} link={props.accountOf(v.id)} focus={key==='account'?'login':'paypal'} canAssign={rights.assign&&!deletedView} onSaved={()=>undefined} onBusy={markBusy}/>;
    if(key==='payout') return deletedView?<span className="pm-muted">—</span>:<PayoutCell projectId={props.projectId} vm={v} ops={props.opsOf(v.id)} account={props.accountOf(v.id)} rights={props.opsRights} onDone={props.onOpsDone}/>;
    if(key==='status') return <StatusCell vm={v} rights={rights} onAction={props.onStatus} onBusy={markBusy}/>;
    if(key==='notes'){const note=displayNote(v.notes);const view=note?<span className="vm-clamp2" title={note}>{note}</span>:<span className="pm-muted">{canEdit('notes')?'—':''}</span>;return deletedView?view:editable(v,'notes','ghi chú '+v.code,view);}
    if(key==='version') return <span className="text-xs">{v.desired?'Giao #'+v.desired.version:''}{v.desired&&v.installed&&v.desired.id!==v.installed.id?' · ':''}{v.installed&&v.installed.id!==v.desired?.id?'Cài #'+v.installed.version:v.installed?' (đã cài)':''}{!v.desired&&!v.installed&&<span className="pm-muted">—</span>}</span>;
    if(key==='sdkMeta') return v.sdk?<span className="text-xs vm-ellipsis" title={(v.sdk.recordedBy||'')+' · '+localDate(v.sdk.recordedAt)}>{v.sdk.recordedBy||'—'} · {v.sdk.recordedAt?localDate(v.sdk.recordedAt,true):'chưa rõ ngày'}</span>:<span className="pm-muted">—</span>;
    return v.desired&&v.desired.id!==v.installed?.id?<span className="text-xs">{v.desired.status==='FAILED'?'Cài chưa xong':v.desired.startedAt?'Đang cài':'Chưa bắt đầu'}</span>:<span className="pm-muted">—</span>;
  };
  return <div className="vm-grid-scroll" style={{maxHeight:props.maxHeight}} data-testid="vm-grid-scroll">
    <table className="vm-grid" style={{width:total}}><colgroup><col style={{width:selectW}}/>{!single&&<col style={{width:serverW}}/>}<col style={{width:vmW}}/><col style={{width:opsW}}/>{columns.map(c=><col key={c.key} style={{width:widthOf(prefs,c.key)}}/>)}<col style={{width:FIXED.menu}}/></colgroup>
      <thead><tr>
        <th className="vm-sticky vm-sticky-check" style={left(0)}><input ref={headCheck} type="checkbox" aria-label={`Chọn ${rows.length} VM trên trang này`} title={`Chọn ${rows.length} VM trên trang này`} checked={allOnPage} disabled={!rows.length} onChange={e=>props.onTogglePage(e.target.checked)}/></th>
        {!single&&<th className="vm-sticky" style={left(selectW)}>Server{resizer('server')}</th>}
        <th className="vm-sticky" style={left(selectW+serverW)}>VM{resizer('vm')}</th>
        <th className="vm-sticky vm-sticky-last" style={left(selectW+serverW+vmW)} title="Trạng thái vận hành do người / AI ghi nhận">Tình trạng</th>
        {columns.map(c=><th key={c.key}>{c.label}{resizer(c.key)}</th>)}
        <th className="vm-sticky-right" aria-label="Thao tác"></th>
      </tr></thead>
      <tbody>{rows.map(v=>{const status=vmView(v),isSel=selected.has(v.id),blockedProxy=v.holds.some(h=>h.state==='BLOCKED');
        return <tr key={v.id} data-row={v.id} className={(busyRows.has(v.id)?'vm-row-busy ':'')+(isSel?'vm-row-selected ':'')+(props.activeVmId===v.id?'vm-row-active ':'')+(blockedProxy?'pm-row-blocked ':status==='PENDING'&&!deletedView?'vm-row-pending ':'')}>
          <td className="vm-sticky vm-sticky-check" style={left(0)}><input type="checkbox" aria-label={'Chọn '+v.server+' / '+v.code} checked={isSel} onChange={e=>props.onToggle(v.id,e.target.checked)}/></td>
          {!single&&<td className="vm-sticky" style={left(selectW)}><Link href={links.vms({serverId:v.serverId})} className="pm-link vm-ellipsis" title={v.server}>{v.server}</Link></td>}
          <td className="vm-sticky vm-id-cell" style={left(selectW+serverW)}>{deletedView?<span className="pm-code font-semibold">{v.code}</span>:editable(v,'code','mã VM '+v.code,<button type="button" className="vm-id-button pm-code" title={'Mở chi tiết '+v.code+(canEdit('code')?' · Enter/F2 để sửa mã':'')} onClick={()=>props.onOpen(v.id)}>{v.code}</button>)}</td>
          <td className="vm-sticky vm-sticky-last vm-col-ops" style={left(selectW+serverW+vmW)}><OpsStatusCell vm={v} ops={props.opsOf(v.id)??{status:(v.ops??null) as VmOpsStatus|null,cycle:v.cycle}} canEdit={rights.assign&&!deletedView} onSet={props.onOpsStatus}/></td>
          {columns.map(c=><td key={c.key} className={'vm-col-'+c.key}>{cell(v,c.key)}</td>)}
          <td className="vm-sticky-right"><DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="vm-row-menu" aria-label={'Thao tác '+v.code} data-menu={v.id}><MoreHorizontal size={16}/></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="vm-menu">
              <DropdownMenuItem onSelect={()=>props.onOpen(v.id)}>Mở chi tiết</DropdownMenuItem>
              {deletedView?(rights.manage&&<DropdownMenuItem onSelect={()=>props.onRestore(v)}>Khôi phục</DropdownMenuItem>):<>
                {rights.assign&&<DropdownMenuItem disabled={!rights.sourceConnected} onSelect={()=>props.onOpen(v.id,'proxy')}>{status==='MISSING'?'Gán proxy':'Đổi proxy'}</DropdownMenuItem>}
                {rights.copy&&v.desired&&<DropdownMenuItem onSelect={()=>props.onCopy(v,'DESIRED')}>Copy proxy được giao</DropdownMenuItem>}
                {rights.copy&&v.installed&&<DropdownMenuItem onSelect={()=>props.onCopy(v,'INSTALLED')}>Copy proxy đã cài</DropdownMenuItem>}
                <DropdownMenuSeparator/>
                <DropdownMenuItem onSelect={()=>props.onOpen(v.id,'install')}>Cài proxy</DropdownMenuItem>
                <DropdownMenuItem onSelect={()=>props.onOpen(v.id,'account')}>Tài khoản EarnApp</DropdownMenuItem>
                <DropdownMenuItem onSelect={()=>props.onOpen(v.id,'work')}>Công việc</DropdownMenuItem>
                <DropdownMenuItem onSelect={()=>props.onOpen(v.id,'history')}>Lịch sử</DropdownMenuItem>
                {rights.costs&&<DropdownMenuItem asChild><Link href={links.costs({server:v.serverId})}>Chi phí server</Link></DropdownMenuItem>}
                {rights.manage&&<><DropdownMenuSeparator/><DropdownMenuItem className="text-red-600" onSelect={()=>props.onDelete(v)}>Xoá (khôi phục được)</DropdownMenuItem></>}
              </>}
            </DropdownMenuContent></DropdownMenu></td>
        </tr>;})}
        {!rows.length&&<tr><td colSpan={4+columns.length+(single?0:1)} className="pm-empty"><Server size={28} className="mx-auto mb-3 pm-muted"/>{props.loading?'Đang tải máy…':props.emptyText}</td></tr>}
      </tbody></table>
  </div>;
}
