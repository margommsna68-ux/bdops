"use client";
import {useCallback,useEffect,useState} from 'react';
// Row selection that survives leaving the page and coming back (owner brief 19/10/2026: select VMs → Thiết lập → change theme →
// Back lost the ticks). Kept by id in the tab's sessionStorage only (never in the URL, gone when the tab closes), under a key per
// surface, user and project, together with the filter scope it was made in. It comes back only into the same scope, and only with
// rows that are still valid there (deleted or filtered-out rows are dropped). Restoring only ticks rows: no bulk action, no dialog.
// The pages keep their own rules for clearing (changing server, search or filter clears, as before).
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>|null;
export type SavedSelection={scope:string;ids:string[]};
export const selectionKey=(surface:'vm'|'proxy',userId:string,projectId:string)=>`mth-selection:${surface}:${userId}:${projectId}`;
export function readSelection(store:Store,key:string):SavedSelection|null{
  try{const v=JSON.parse(store?.getItem(key)||'null');return v&&typeof v.scope==='string'&&Array.isArray(v.ids)&&v.ids.every((x:unknown)=>typeof x==='string')?{scope:v.scope,ids:v.ids}:null;}catch{return null;}
}
export function writeSelection(store:Store,key:string,s:SavedSelection){
  try{if(!s.ids.length)store?.removeItem(key);else store?.setItem(key,JSON.stringify(s));}catch{/* storage full or blocked: the selection just isn't kept */}
}
export const restorableIds=(saved:SavedSelection|null,scope:string,valid:Set<string>)=>saved&&saved.scope===scope?saved.ids.filter(id=>valid.has(id)):[];
const session=():Store=>{try{return typeof window==='undefined'?null:window.sessionStorage;}catch{return null;}};
/**
 * useState<Set<string>> for a selection kept in the session. `key` is null until user and project are known. Call the returned
 * `restore(valid)` from an effect once the rows of the current scope are loaded: on the first call after mounting, the saved ids
 * still valid in this scope are ticked again (never over a selection made meanwhile). From then on every change is saved with the
 * scope it belongs to, so a selection cleared by a change of filter stays cleared; before it, nothing is written, so mounting never
 * wipes the saved selection.
 */
export function useSessionSelection(key:string|null,scope:string){
  const [selected,setSelected]=useState<Set<string>>(()=>new Set());
  const [live,setLive]=useState(false);
  const restore=useCallback((valid:Set<string>|null)=>{
    if(live||!key||!valid)return;
    const ids=restorableIds(readSelection(session(),key),scope,valid);
    if(ids.length)setSelected(prev=>prev.size?prev:new Set(ids));
    setLive(true);
  },[live,key,scope]);
  useEffect(()=>{if(live&&key)writeSelection(session(),key,{scope,ids:[...selected]});},[live,selected,key,scope]);
  return [selected,setSelected,restore] as const;
}
