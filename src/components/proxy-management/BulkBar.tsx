"use client";
import React,{type ReactNode} from 'react';
import {Trash2,X} from 'lucide-react';
// One bulk bar above a table (owner brief 20/10/2026), the same for Gmail / Apple ID, PayPal and Kho proxy:
// "Đã chọn N" → the frequent actions (each with its own Áp dụng) → at the end a small soft-red Xoá and Bỏ chọn. The bar keeps its place and
// height with nothing selected (a short hint), so ticking a row never pushes the table down. N is the number of rows the actions act on
// (rows selected on other pages included and said so); Xoá shows its own count when only part of the selection can be deleted.
export function BulkBar({count,unit,extra,children,onDelete,deleteCount=count,busy,onClear,hint='Chọn dòng để thao tác hàng loạt'}:{count:number;unit:string;extra?:string;children?:ReactNode;onDelete?:()=>void;deleteCount?:number;busy?:boolean;onClear:()=>void;hint?:string}){
  return <div className={'pm-bulkbar'+(count?'':' pm-bulkbar-idle')} role="region" aria-label="Thao tác hàng loạt" data-selected={count}>
    {count?<>
      <strong className="whitespace-nowrap" aria-live="polite">Đã chọn {count} {unit}</strong>{extra&&<span className="pm-muted text-xs">{extra}</span>}
      <div className="pm-bulkbar-actions">{children}</div>
      <div className="pm-bulkbar-end">
        {onDelete&&deleteCount>0&&<button type="button" className="pm-button pm-button-sm pm-button-danger" aria-label={'Xoá khỏi kho '+deleteCount+' dòng đã chọn'} disabled={busy} onClick={onDelete}><Trash2 size={14}/>Xoá {deleteCount} dòng</button>}
        <button type="button" className="pm-button pm-button-sm pm-button-quiet" onClick={onClear}><X size={14}/>Bỏ chọn</button>
      </div>
    </>:<span className="pm-muted text-xs">{hint}</span>}
  </div>;
}
/** Delete one row: an icon button of the same size as the row's other icon buttons, named for keyboards and AI. */
export function RowDeleteButton({label,busy,onClick}:{label:string;busy?:boolean;onClick:()=>void}){
  return <button type="button" className="pm-icon-button pm-icon-danger" title="Xoá khỏi kho" aria-label={'Xoá khỏi kho '+label} disabled={busy} onClick={onClick}><Trash2 size={16}/></button>;
}
