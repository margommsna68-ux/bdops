"use client";
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuCheckboxItem,DropdownMenuSeparator} from '@/components/ui/dropdown-menu';
import {ChevronDown} from 'lucide-react';
import {UNASSIGNED_SERVER,type CopyResult,type LocationRole,type RegistryRow} from '@/server/proxy-management/types';
export const roleLabel=(role:LocationRole)=>role==='DESIRED'?'Chờ cài':role==='INSTALLED'?'Đã cài':role==='UNCERTAIN'?'Giữ để kiểm tra':'';
// Server, VM and the operating note are three cells; a proxy with several positions lists each on its own line.
export function LocationCells({row}:{row:RegistryRow}){
  if(!row.locations.length) return <><td>{row.owner==='GENJY'?<span className="pm-muted">genjy</span>:<span className="pm-badge pm-badge-purple">Chưa gán</span>}</td><td></td><td></td></>;
  return <>
    <td className="pm-cell-lines">{row.locations.map(l=><div key={l.vmId}>{l.serverCode}</div>)}</td>
    <td className="pm-cell-lines">{row.locations.map(l=><div key={l.vmId} className="pm-code">{l.vmCode}</div>)}</td>
    <td className="pm-cell-lines pm-muted text-xs">{row.locations.map(l=><div key={l.vmId}>{roleLabel(l.role)||'—'}</div>)}</td>
  </>;
}
export function serverFilterLabel(value:string[],servers:string[]){
  if(!value.length) return 'Tất cả server';
  const names=value.filter(v=>v!==UNASSIGNED_SERVER&&servers.includes(v)),unassigned=value.includes(UNASSIGNED_SERVER)?1:0;
  if(!names.length) return unassigned?'Chưa gán server':'Tất cả server';
  const shown=names.slice(0,2),rest=names.length-shown.length+unassigned;
  return shown.join(', ')+(rest?' +'+rest:'');
}
export function ServerFilter({servers,value,onChange}:{servers:string[];value:string[];onChange:(next:string[])=>void}){
  const toggle=(code:string,checked:boolean)=>{const set=new Set(value);if(checked) set.add(code);else set.delete(code);onChange([...(set.has(UNASSIGNED_SERVER)?[UNASSIGNED_SERVER]:[]),...servers.filter(s=>set.has(s))]);};
  return <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className={'pm-button pm-filter-trigger'+(value.length?' pm-filter-active':'')} aria-label="Lọc server">{serverFilterLabel(value,servers)}<ChevronDown size={15}/></button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="pm-filter-menu">
      <DropdownMenuCheckboxItem checked={!value.length} onSelect={e=>e.preventDefault()} onCheckedChange={()=>onChange([])}>Tất cả server</DropdownMenuCheckboxItem>
      <DropdownMenuSeparator/>
      {servers.map(s=><DropdownMenuCheckboxItem key={s} checked={value.includes(s)} onSelect={e=>e.preventDefault()} onCheckedChange={c=>toggle(s,!!c)}>{s}</DropdownMenuCheckboxItem>)}
      <DropdownMenuSeparator/>
      <DropdownMenuCheckboxItem checked={value.includes(UNASSIGNED_SERVER)} onSelect={e=>e.preventDefault()} onCheckedChange={c=>toggle(UNASSIGNED_SERVER,!!c)}>Chưa gán server</DropdownMenuCheckboxItem>
    </DropdownMenuContent></DropdownMenu>;
}
const skipLabel:Record<CopyResult['skipped'][number]['reason'],string>={NO_CREDENTIALS:'thiếu user/pass',NO_ENDPOINT:'chỉ có IP từ Genjy'};
export function copySummary(result:CopyResult):{ok:boolean;message:string}{
  const skipped=result.skipped.map(s=>`${s.count} dòng ${skipLabel[s.reason]}`).join(', ');
  if(!result.copied) return {ok:false,message:'Không copy được dòng nào'+(skipped?' · bỏ qua '+skipped:'')};
  return {ok:true,message:(result.skipped.length?`Đã copy ${result.copied} / ${result.total} proxy · bỏ qua ${skipped}`:`Đã copy ${result.copied} proxy`)};
}
