"use client";
import {useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {trpc} from '@/lib/trpc';
import {CostForm} from '@/components/business-management/UsdtCostsWorkspace';
import toast from 'react-hot-toast';
export interface PackageRow {id:string;code:string;label:string;site:string|null;note:string|null;price:string|null;priceCurrency:string|null;cycleMonths:number;nextDueDate:string|null;lastPaidAt:string|null;disabled:boolean;revision:number;proxyCount:number;due:{state:'NONE'|'OVERDUE'|'DUE_SOON'|'OK';daysLeft:number|null}}
export const dayLabel=(ymd:string|null)=>ymd?ymd.split('-').reverse().join('/'):'';
export function priceLabel(p:Pick<PackageRow,'price'|'priceCurrency'|'cycleMonths'>){return p.price?`${p.price} ${p.priceCurrency||''}`.trim()+` / ${p.cycleMonths} tháng`:'';}
export function dueLabel(p:Pick<PackageRow,'nextDueDate'|'due'>){
  if(!p.nextDueDate||p.due.daysLeft===null) return '';
  return p.due.daysLeft<0?`quá hạn ${-p.due.daysLeft} ngày`:p.due.daysLeft===0?'đến hạn hôm nay':`còn ${p.due.daysLeft} ngày`;
}
export function packageHeading(p:Pick<PackageRow,'site'|'price'|'priceCurrency'|'cycleMonths'|'nextDueDate'|'due'>){
  const due=p.nextDueDate?`đến hạn ${dayLabel(p.nextDueDate)} (${dueLabel(p)})`:'Chưa đặt ngày đến hạn';
  return [p.site,priceLabel(p),due].filter(Boolean).join(' · ');
}
export const dueBadge=(state:PackageRow['due']['state'])=>state==='OVERDUE'?'pm-badge pm-badge-red':state==='DUE_SOON'?'pm-badge pm-badge-amber':'pm-badge pm-badge-muted';
export function PackageTable({packages,loading=false,canManage,canPay,onEdit,onPay}:{packages:PackageRow[];loading?:boolean;canManage:boolean;canPay:boolean;onEdit:(p:PackageRow)=>void;onPay:(p:PackageRow)=>void}){
  return <div className="pm-table-scroll"><table className="pm-table"><thead><tr><th>Gói</th><th>Site</th><th>Giá / chu kỳ</th><th>Đến hạn</th><th>Proxy</th><th></th></tr></thead><tbody>
    {packages.map(p=><tr key={p.id} className={p.disabled?'pm-row-retired':''}><td><strong>{p.code}</strong>{p.disabled&&<span className="pm-badge pm-badge-muted ml-2">tắt</span>}{p.note&&<div className="pm-muted text-xs mt-1">{p.note}</div>}</td><td>{p.site||'—'}</td><td>{priceLabel(p)||<span className="pm-muted">Chưa có giá</span>}</td><td>{p.nextDueDate?<><span>{dayLabel(p.nextDueDate)}</span><div className="mt-1"><span className={dueBadge(p.due.state)}>{dueLabel(p)}</span></div></>:<span className="pm-muted">Chưa đặt</span>}{p.lastPaidAt&&<div className="pm-muted text-xs mt-1">Trả gần nhất {new Date(p.lastPaidAt).toLocaleDateString('vi-VN',{timeZone:'Asia/Bangkok'})}</div>}</td><td className="tabular-nums">{p.proxyCount}</td><td><div className="flex gap-1 justify-end">{canManage&&<button className="pm-button pm-button-quiet" onClick={()=>onEdit(p)}>Sửa</button>}{canPay&&<button className="pm-button" onClick={()=>onPay(p)}>Đã thanh toán</button>}</div></td></tr>)}
    {!packages.length&&<tr><td colSpan={6} className="pm-empty">{loading?'Đang tải gói…':'Chưa có gói proxy. Thêm gói hoặc dán proxy mới kèm tên gói.'}</td></tr>}
  </tbody></table></div>;
}
export function PackageForm({projectId,row,onClose,onSaved}:{projectId:string;row:PackageRow|null;onClose:()=>void;onSaved:()=>void}){
  const [code,setCode]=useState(row?.code||''),[site,setSite]=useState(row?.site||''),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[price,setPrice]=useState(row?.price||''),[currency,setCurrency]=useState(row?.priceCurrency||'USD'),[cycle,setCycle]=useState(String(row?.cycleMonths||1)),[due,setDue]=useState(row?.nextDueDate||''),[note,setNote]=useState(row?.note||'');
  const save=trpc.proxyManagement.saveCatalog.useMutation({onSuccess:()=>{toast.success('Đã lưu gói proxy');onSaved();onClose();},onError:e=>toast.error(e.message)});
  const needCredentials=!row;
  return <form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate({projectId,code:code.trim(),label:code.trim(),username:username||null,password:password||null,site:site||null,note:note||null,price:price||null,priceCurrency:currency||null,cycleMonths:Number(cycle)||1,nextDueDate:due||null});}}>
    <div className="grid sm:grid-cols-2 gap-4"><label className="pm-label">Tên gói<input required className="pm-input" value={code} disabled={!!row} maxLength={80} placeholder="Ví dụ: 240292 hoặc Account VietPhe" onChange={e=>setCode(e.target.value)}/></label><label className="pm-label">Site / nhà cung cấp<input className="pm-input" value={site} maxLength={120} placeholder="proxiware.com, vietphe…" onChange={e=>setSite(e.target.value)}/></label></div>
    <div className="grid sm:grid-cols-2 gap-4"><label className="pm-label">Username{row&&<span className="pm-muted font-normal"> (để trống = giữ nguyên)</span>}<input className="pm-input" autoComplete="off" required={needCredentials} value={username} onChange={e=>setUsername(e.target.value)}/></label><label className="pm-label">Password<input type="password" className="pm-input" autoComplete="new-password" required={needCredentials||!!username} value={password} onChange={e=>setPassword(e.target.value)}/></label></div>
    <div className="grid sm:grid-cols-4 gap-4"><label className="pm-label">Giá mỗi chu kỳ<input inputMode="decimal" className="pm-input" value={price} onChange={e=>setPrice(e.target.value)}/></label><label className="pm-label">Đồng tiền<input list="pm-package-currencies" maxLength={8} className="pm-input" value={currency} onChange={e=>setCurrency(e.target.value.toUpperCase())}/><datalist id="pm-package-currencies"><option>USD</option><option>USDT</option><option>VND</option></datalist></label><label className="pm-label">Chu kỳ (tháng)<input type="number" min={1} max={60} className="pm-input" value={cycle} onChange={e=>setCycle(e.target.value)}/></label><label className="pm-label">Đến hạn tiếp<input type="date" className="pm-input" value={due} onChange={e=>setDue(e.target.value)}/></label></div>
    <label className="pm-label">Ghi chú<input className="pm-input" maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label>
    {save.error&&<p role="alert" className="pm-error text-sm">{save.error.message}</p>}
    <div className="flex justify-end gap-2"><button type="button" className="pm-button" onClick={onClose}>Huỷ</button><button type="submit" className="pm-button pm-button-primary" disabled={save.isLoading||!code.trim()}>{save.isLoading?'Đang lưu…':'Lưu gói'}</button></div>
  </form>;
}
export function PackageDialog({projectId,packages,loading=false,canManage,onClose,onSaved}:{projectId:string;packages:PackageRow[];loading?:boolean;canManage:boolean;onClose:()=>void;onSaved:()=>void}){
  const [editing,setEditing]=useState<PackageRow|'NEW'|null>(null),[paying,setPaying]=useState<PackageRow|null>(null);
  const cash=trpc.businessManagement.cashAccess.useQuery({projectId}),canPay=!!cash.data?.writeCosts;
  return <Dialog open onOpenChange={open=>{if(!open) onClose();}}><DialogContent className="pm-dialog max-w-4xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Gói proxy</DialogTitle><DialogDescription>Mỗi gói một user/pass; proxy nhận diện gói theo đó. Ghi site, giá và ngày đến hạn để biết lúc gia hạn.</DialogDescription></DialogHeader>
    {editing?<PackageForm projectId={projectId} row={editing==='NEW'?null:editing} onClose={()=>setEditing(null)} onSaved={onSaved}/>:<>
      <PackageTable packages={packages} loading={loading} canManage={canManage} canPay={canPay} onEdit={setEditing} onPay={setPaying}/>
      <div className="flex justify-between gap-2"><span className="pm-muted text-xs self-center">Đã thanh toán = ghi khoản chi proxy và dời ngày đến hạn thêm một chu kỳ.</span><div className="flex gap-2"><button className="pm-button" onClick={onClose}>Đóng</button>{canManage&&<button className="pm-button pm-button-primary" onClick={()=>setEditing('NEW')}>Thêm gói</button>}</div></div>
    </>}
    {paying&&<CostForm projectId={projectId} preset={{category:'IP_PROXY',proxyAccountId:paying.id,amount:paying.price||'',currency:paying.priceCurrency||'USDT'}} onClose={()=>setPaying(null)} onSaved={onSaved}/>}
  </DialogContent></Dialog>;
}
