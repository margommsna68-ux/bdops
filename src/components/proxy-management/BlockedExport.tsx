"use client";
import {useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Copy,Check} from 'lucide-react';
export function BlockedExport({data,isLoading,error,onClose}:{data?:{packageCode:string;proxy:string;status:string}[];isLoading:boolean;error?:{message:string}|null;onClose:()=>void}){
  const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState('');
  const text=data?.map(r=>`${r.packageCode}\t${r.proxy}\t${r.status}`).join('\n')||'';
  async function copy(){try{await navigator.clipboard.writeText(text);setCopied(true);setCopyError('');}catch{setCopyError('Chọn nội dung bên dưới và nhấn Ctrl+C để copy.');}}
  return <Dialog open onOpenChange={open=>{if(!open) onClose();}}><DialogContent className="pm-dialog max-w-3xl"><DialogHeader><DialogTitle>Danh sách BLOCKED</DialogTitle><DialogDescription>Ba cột: Gói proxy · Proxy đầy đủ · BLOCKED. Copy để anh gửi nhà cung cấp.</DialogDescription></DialogHeader>{isLoading?<p className="pm-muted">Đang lấy danh sách…</p>:error?<p role="alert" className="pm-error">{error.message}</p>:<><p className="pm-muted text-sm">{data?.length||0} proxy đang BLOCKED</p><textarea className="pm-input pm-paste" rows={10} readOnly value={text} aria-label="Danh sách proxy BLOCKED đầy đủ" onFocus={e=>e.target.select()}/>{copyError&&<p role="alert" className="pm-error">{copyError}</p>}<button className="pm-button pm-button-primary self-end" disabled={!text} onClick={copy}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?'Đã copy':'Copy danh sách'}</button></>}</DialogContent></Dialog>;
}
