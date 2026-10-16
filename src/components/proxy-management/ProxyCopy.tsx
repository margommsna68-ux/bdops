"use client";
import {useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
export function ProxyCopy({data,isLoading,error:requestError,onClose}:{data?:{proxy:string};isLoading:boolean;error?:{message:string}|null;onClose:()=>void}){
  const [copied,setCopied]=useState(false),[error,setError]=useState('');
  const text=data?.proxy||'';
  async function copy(){try{await navigator.clipboard.writeText(text);setCopied(true);}catch{setError('Chọn nội dung bên dưới và nhấn Ctrl+C để copy.');}}
  return <Dialog open onOpenChange={open=>{if(!open) onClose();}}><DialogContent className="pm-dialog max-w-xl"><DialogHeader><DialogTitle>Copy proxy</DialogTitle><DialogDescription>Trình duyệt chưa cho copy tự động. Chọn nội dung bên dưới rồi nhấn Ctrl+C, hoặc bấm Copy proxy.</DialogDescription></DialogHeader>{isLoading?<p className="pm-muted">Đang lấy proxy…</p>:requestError?<p role="alert" className="pm-error">{requestError.message}</p>:<><textarea readOnly aria-label="Proxy đầy đủ" className="pm-input pm-paste" rows={Math.min(12,Math.max(3,text.split(String.fromCharCode(10)).length))} value={text} onFocus={e=>e.target.select()}/>{error&&<p role="alert" className="pm-error">{error}</p>}<button className="pm-button pm-button-primary" onClick={copy} disabled={!text}>{copied?'Đã copy':'Copy proxy'}</button></>}</DialogContent></Dialog>;
}
