"use client";
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {links} from '@/lib/links';
import {Check,MoreHorizontal,X,Server} from 'lucide-react';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {localDate} from '@/components/proxy-management/HistoryPanel';
import {displayNote} from '@/server/vm-management/vm-codes';
import {vmView} from '../workflow';
import type {ManagedVM} from '../shared';
import {AccountCell,type VmAccount} from './AccountCell';
import {ProxyCell} from './ProxyCell';
import {SdkCell,type SdkDraft} from './SdkCell';
import {OpsStatusCell,PayoutCell,type OpsRow,type OpsRights} from './OpsCells';
import type {VmOpsStatus} from '@/lib/vm-ops';
import {FIXED,editableFields,nextCell,resizeColumn,visibleColumns,widthOf,type GridSort,type ColumnKey,type EditField,type GridPrefs,type PanelTab} from './grid-model';
export interface GridRights {manage:boolean;assign:boolean;accountAssign?:boolean;sdkMoneyRead?:boolean;sdkMoneyWrite?:boolean;copy:boolean;confirm:boolean;costs:boolean;sourceConnected:boolean;replace?:boolean;block?:boolean}
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
export function VmGrid(props:{sort?:GridSort;onSort?:(sort:GridSort)=>void;projectId:string;rows:ManagedVM[];single:boolean;deletedView:boolean;prefs:GridPrefs;onPrefs:(p:GridPrefs)=>void;rights:GridRights;selected:Set<string>;onToggle:(id:string,on:boolean)=>void;onTogglePage:(on:boolean)=>void;accountOf:(vmId:string)=>VmAccount|undefined;activeVmId:string|null;maxHeight:number;loading:boolean;emptyText:string;
  onOpen:(vmId:string,tab?:PanelTab)=>void;onCopy:(vm:ManagedVM,which:CopyWhich)=>void;onDelete:(vm:ManagedVM)=>void;onRestore:(vm:ManagedVM)=>void;onSave:(vm:ManagedVM,field:EditField,value:string)=>Promise<void>;
  opsOf:(vmId:string)=>OpsRow|undefined;opsRights:OpsRights;onOpsStatus:(vm:ManagedVM,status:VmOpsStatus,cycle:number)=>Promise<void>;onOpsDone:()=>Promise<unknown>|void;accountState?:'READY'|'LOADING'|'ERROR';userId?:string}){
  const {rows,single,deletedView,prefs,rights,selected}=props,columns=visibleColumns(prefs),drafts=useDrafts(props.projectId);
  const sortHeading=(label:string,asc:GridSort,desc:GridSort)=>{const direction=props.sort===asc?'ascending':props.sort===desc?'descending':undefined;return <button type="button" className="inline-flex items-center gap-1" aria-label={'Sắp xếp '+label+(direction==='ascending'?' giảm dần':' tăng dần')} onClick={()=>props.onSort?.(direction==='ascending'?desc:asc)}>{label}<span aria-hidden="true">{direction==='ascending'?'↑':direction==='descending'?'↓':'↕'}</span></button>;};

  // A row whose status action is saving is locked (other cells and ⋯) until the answer comes back.
  const [busyRows,setBusyRows]=useState<Set<string>>(new Set()),markBusy=(id:string,on:boolean)=>setBusyRows(p=>{const n=new Set(p);if(on)n.add(id);else n.delete(id);return n;});
  const [active,setActive]=useState<{vmId:string;field:EditField}|null>(null),[errors,setErrors]=useState<Record<string,string>>({}),[saving,setSaving]=useState<string|null>(null);
  const fields=deletedView?[]:editableFields(prefs,{manage:rights.manage,assign:rights.assign}),rowIds=rows.map(r=>r.id);
  const serverW=single?0:widthOf(prefs,'server'),vmW=widthOf(prefs,'vm'),selectW=FIXED.select,opsW=FIXED.ops;
  const total=selectW+serverW+vmW+opsW+columns.reduce((n,c)=>n+widthOf(prefs,c.key),0)+FIXED.menu;
  const allOnPage=rows.length>0&&rows.every(v=>selected.has(v.id)),someOnPage=rows.some(v=>selected.has(v.id));
  const headCheck=useRef<HTMLInputElement>(null);useEffect(()=>{if(headCheck.current) headCheck.current.indeterminate=someOnPage&&!allOnPage;},[someOnPage,allOnPage]);
  const canEdit=(field:EditField)=>fields.includes(field);
  const sdkDraft=(vmId:string):SdkDraft|null=>{const raw=drafts.drafts[draftKey(vmId,'sdk')];if(!raw)return null;try{const d=JSON.parse(raw) as SdkDraft;return typeof d?.code==='string'?d:null;}catch{return null;}};
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

    if(key==='proxy') return <ProxyCell projectId={props.projectId} vm={v} rights={{assign:rights.assign&&!deletedView,copy:rights.copy,replace:!!rights.replace&&!deletedView,block:!!rights.block&&!deletedView}} onCopy={x=>props.onCopy(x,x.desired?'DESIRED':'INSTALLED')} onBusy={markBusy}/>;
    if(key==='sdk') return <SdkCell projectId={props.projectId} vm={v} account={props.accountOf(v.id)} canEdit={rights.assign&&!deletedView} money={{read:!!rights.sdkMoneyRead,write:!!rights.sdkMoneyWrite&&!deletedView}} draft={sdkDraft(v.id)} onDraft={d=>d?drafts.set(v.id,'sdk',JSON.stringify(d)):drafts.drop(v.id,'sdk')} onBusy={markBusy}/>;
    if(key==='account'||key==='paypal') return <AccountCell projectId={props.projectId} vm={v} link={props.accountOf(v.id)} focus={key==='account'?'login':'paypal'} canAssign={(rights.accountAssign??rights.assign)&&!deletedView} canCopy={rights.copy&&!deletedView} onSaved={()=>undefined} onBusy={markBusy} dataState={props.accountState}/>;
    if(key==='payout') return deletedView?<span className="pm-muted">—</span>:<PayoutCell projectId={props.projectId} userId={props.userId} vm={v} ops={props.opsOf(v.id)} account={props.accountOf(v.id)} rights={props.opsRights} onDone={props.onOpsDone} onBusy={markBusy}/>;
    if(key==='notes'){const note=displayNote(v.notes);const view=note?<span className="vm-clamp2" title={note}>{note}</span>:<span className="pm-muted">{canEdit('notes')?'—':''}</span>;return deletedView?view:editable(v,'notes','ghi chú '+v.code,view);}
    if(key==='version'){const c=v.desired||v.installed;return c?<span className="text-xs">#{c.version}</span>:<span className="pm-muted">—</span>;}
    if(key==='sdkMeta') return v.sdk?<span className="text-xs vm-ellipsis" title={(v.sdk.recordedBy||'')+' · '+localDate(v.sdk.recordedAt)}>{v.sdk.recordedBy||'—'} · {v.sdk.recordedAt?localDate(v.sdk.recordedAt,true):'chưa rõ ngày'}</span>:<span className="pm-muted">—</span>;
    return <span className="pm-muted">—</span>;
  };
  // Edge lines of the fixed columns only while something slides under them (set on the element, no re-render while scrolling).
  const scroller=useRef<HTMLDivElement>(null),edges=()=>{const e=scroller.current;if(!e)return;e.toggleAttribute('data-x-left',e.scrollLeft>0);e.toggleAttribute('data-x-right',e.scrollLeft+e.clientWidth<e.scrollWidth-1);};
  useEffect(()=>{edges();window.addEventListener('resize',edges);return ()=>window.removeEventListener('resize',edges);});
  return <div ref={scroller} className="vm-grid-scroll" style={{maxHeight:props.maxHeight}} data-testid="vm-grid-scroll" onScroll={edges}>
    <table className="vm-grid" style={{width:total}}><colgroup><col style={{width:selectW}}/>{!single&&<col style={{width:serverW}}/>}<col style={{width:vmW}}/><col style={{width:opsW}}/>{columns.map(c=><col key={c.key} style={{width:widthOf(prefs,c.key)}}/>)}<col style={{width:FIXED.menu}}/></colgroup>
      <thead><tr>
        <th className="vm-sticky vm-sticky-check" style={left(0)}><input ref={headCheck} type="checkbox" aria-label={`Chọn ${rows.length} VM trên trang này`} title={`Chọn ${rows.length} VM trên trang này`} checked={allOnPage} disabled={!rows.length} onChange={e=>props.onTogglePage(e.target.checked)}/></th>
        {!single&&<th className="vm-sticky" style={left(selectW)}>Server{resizer('server')}</th>}
        <th className="vm-sticky" style={left(selectW+serverW)}>VM{resizer('vm')}</th>
        <th className="vm-sticky vm-sticky-last" style={left(selectW+serverW+vmW)} title="Trạng thái vận hành do người / AI ghi nhận" aria-sort={props.sort==='OPS_ASC'?'ascending':props.sort==='OPS_DESC'?'descending':'none'}>{sortHeading('Tình trạng','OPS_ASC','OPS_DESC')}</th>
        {columns.map(c=><th key={c.key} aria-sort={c.key==='payout'?(props.sort==='BALANCE_ASC'?'ascending':props.sort==='BALANCE'?'descending':'none'):c.key==='account'?(props.sort==='ACCOUNT_ASC'?'ascending':props.sort==='ACCOUNT_DESC'?'descending':'none'):undefined}>{c.key==='payout'?sortHeading(c.label,'BALANCE_ASC','BALANCE'):c.key==='account'?sortHeading(c.label,'ACCOUNT_ASC','ACCOUNT_DESC'):c.label}{resizer(c.key)}</th>)}
        <th className="vm-sticky-right" aria-label="Thao tác"></th>
      </tr></thead>
      <tbody>{rows.map(v=>{const status=vmView(v),isSel=selected.has(v.id),blockedProxy=status==='BLOCKED';
        return <tr key={v.id} data-row={v.id} data-project-id={props.projectId} data-server-id={v.serverId} data-vm-id={v.id} data-vm-code={v.code} data-cycle={v.cycle} data-account-id={props.accountOf(v.id)?.earnApp?.id??undefined} className={(busyRows.has(v.id)?'vm-row-busy ':'')+(isSel?'vm-row-selected ':'')+(props.activeVmId===v.id?'vm-row-active ':'')+(blockedProxy&&!deletedView?'pm-row-blocked ':'')}>
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
                {rights.copy&&(v.desired||v.installed)&&<DropdownMenuItem onSelect={()=>props.onCopy(v,v.desired?'DESIRED':'INSTALLED')}>Copy proxy</DropdownMenuItem>}
                <DropdownMenuSeparator/>
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
