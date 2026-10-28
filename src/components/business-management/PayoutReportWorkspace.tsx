"use client";
import {useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {ChevronRight,ArrowUpRight,X,RefreshCw} from 'lucide-react';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import {trpc} from '@/lib/trpc';
import {links} from '@/lib/links';
import {displayMoney} from '@/lib/money-input';
import '@/components/proxy-management/proxy-management.css';
import './payout-report.css';
import {PayoutFrameForVm} from '@/components/vm-management/vm-grid/PayoutFrame';
import {PayoutStatusBulk,type StatusBulkKind,type StatusBulkRow} from '@/components/vm-management/vm-grid/PayoutStatusBulk';
import type {readPayoutReport} from '@/server/vm-ops/payout-report';

const statuses={PREPARING:'Đang chuẩn bị',UNKNOWN:'Chưa rõ kết quả',WAITING:'Chờ về PayPal',PARTIAL:'Đã nhận một phần',RECEIVED:'Đã nhận đủ / chốt',FAILED:'Thất bại',CANCELLED:'Đã huỷ',REVIEW:'Cần đối chiếu',LOST:'Mất do SUS'};
const views={SENT_TODAY:{label:'Đã gửi trên EarnApp',note:'Tính theo ngày thực sự gửi, kể cả yêu cầu tạo từ hôm trước.'},WAITING:{label:'Đang chờ về PayPal',note:'Phần còn chờ của các yêu cầu đã gửi, gồm cả những ngày trước.'},RECEIVED_TODAY:{label:'PayPal thực nhận trong ngày',note:'Chỉ cộng khoản nhận đã xác nhận trong ngày này. Mở yêu cầu để xem toàn bộ lịch sử.'},ATTENTION:{label:'Yêu cầu cần xử lý',note:'Thất bại, chưa rõ kết quả hoặc cần đối chiếu; gồm mọi ngày.'}};
const receiptStatuses:Record<string,string>={RECEIVED:'Đã nhận',CONFIRMED:'Đã nhận',PENDING:'Chờ xác nhận',FAILED:'Không về',VOIDED:'Đã thu hồi'};
const dateText=(value:string|null)=>!value?'—':new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric',...(value.length>10?{hour:'2-digit',minute:'2-digit'}:{})}).format(new Date(value.length===10?value+'T12:00:00+07:00':value));

export function PayoutReportWorkspace({projectId}:{projectId:string}){return <PayoutReportView key={projectId} projectId={projectId}/>;}
function PayoutReportView({projectId}:{projectId:string}){
 const params=useSearchParams(),router=useRouter(),[opened,setOpened]=useState<string|null>(null);
 // Selected rows of this page (owner 28/10/2026: "Đã rút N dòng" / "Tiền đã về N dòng"); a filter or page change clears them.
 const [selected,setSelected]=useState<Set<string>>(()=>new Set()),[bulk,setBulk]=useState<StatusBulkKind|null>(null);
 const opener=useRef<HTMLButtonElement|null>(null),heading=useRef<HTMLHeadingElement|null>(null);
 const value=(key:string)=>params.get(key)||'';
 const status=Object.hasOwn(statuses,value('status'))?value('status') as keyof typeof statuses:undefined;
 const view=Object.hasOwn(views,value('view'))?value('view') as keyof typeof views:undefined;
 const report=trpc.vmOps.payoutReport.useQuery({projectId,q:value('q')||undefined,serverId:value('server')||undefined,paypalId:value('paypal')||undefined,status,view,day:value('day')||undefined,from:value('from')||undefined,to:value('to')||undefined,page:Math.max(1,Number(value('page'))||1)},{refetchInterval:30000,keepPreviousData:false});
 function filter(key:string,next:string){const p=new URLSearchParams(params.toString());if(next)p.set(key,next);else p.delete(key);if(key!=='page')p.delete('page');setOpened(null);setSelected(new Set());router.replace('/earnapp-withdrawals'+(p.size?'?'+p.toString():''),{scroll:false});}
 function clearView(){const p=new URLSearchParams(params.toString());for(const key of ['view','day','page'])p.delete(key);setOpened(null);router.replace('/earnapp-withdrawals'+(p.size?'?'+p.toString():''),{scroll:false});}
 if(report.error)return <div className="proxy-workspace"><h1 ref={heading} tabIndex={-1}>Rút EarnAp</h1><p role="alert" className="pm-error">{report.error.message}</p><button className="pm-button" onClick={()=>router.replace('/earnapp-withdrawals',{scroll:false})}>Xoá bộ lọc</button></div>;
 const data=report.data,active=data?.rows.find(r=>r.id===opened);
 function open(row:Report['rows'][number],button:HTMLButtonElement|null){opener.current=button;setOpened(row.id);}
 const picked=(data?.rows??[]).filter(r=>selected.has(r.id)),selectable=!!data?.rights&&!!data.rows.length;
 const sendable=picked.filter(r=>r.status==='PREPARING').length,receivable=picked.filter(r=>r.status==='WAITING'||r.status==='PARTIAL'||r.status==='LOST').length;
 const toggle=(id:string)=>setSelected(old=>{const n=new Set(old);if(n.has(id))n.delete(id);else n.add(id);return n;});
 return <section className="proxy-workspace payout-report">
  <header className="pr-heading"><div><h1 ref={heading} tabIndex={-1}>Rút EarnAp</h1><p className="pm-muted">Từ VM đến PayPal. Theo dõi từng yêu cầu và số tiền đã nhận.</p></div><Link className="pr-text-link" href={links.vms()}>Server / VM <ArrowUpRight size={15}/></Link></header>
  {data?.focus?<div className="pr-focus pm-surface"><div><span className="pm-muted">{data.focus.day&&view?.endsWith('TODAY')?dateText(data.focus.day)+' · giờ Việt Nam':'Toàn bộ các ngày'}</span><h2>{views[data.focus.view].label}</h2><p className="pm-muted">{views[data.focus.view].note}</p></div><div className="pr-focus-value">{data.focus.view==='ATTENTION'?<strong>{data.focus.requests} yêu cầu</strong>:data.focus.amounts.length?data.focus.amounts.map(s=><strong key={s.currency}>{displayMoney(s.amount,s.currency)}</strong>):<strong>—</strong>}<small className="pm-muted">{data.focus.vms} VM · {data.focus.requests} yêu cầu</small></div><button className="pr-icon-button" aria-label="Bỏ nhóm từ dashboard" title="Bỏ nhóm từ dashboard" onClick={clearView}><X size={16}/></button></div>:<div className="pr-summary pm-surface" aria-label="Tổng theo bộ lọc">
   {([['waiting','Còn chờ về PayPal'],['received','PayPal thực nhận'],['prepared','Đang chuẩn bị'],['sent','Đã gửi trên EarnApp']] as const).map(([key,label])=><div key={key} className={'pr-total-'+key}><span className="pm-muted">{label}</span>{data?data.summary.length?data.summary.map(s=><strong key={s.currency}>{displayMoney(s[key],s.currency)}</strong>):<strong>—</strong>:<strong>…</strong>}</div>)}
  </div>}
  {!view&&<p className="pr-explain pm-muted">Thực nhận chỉ tính tiền đã xác nhận. Đã gửi gồm cả lượt sau đó thất bại hoặc huỷ.</p>}
  {data?.summary.filter(s=>s.unknown!=='0.00').map(s=><p key={s.currency} className="pm-error">Chưa rõ kết quả gửi: {displayMoney(s.unknown,s.currency)} — cần đối chiếu lịch sử EarnApp.</p>)}
  <div className="pr-filter-surface pm-surface"><div className="pr-filters">
   <label>Tìm nhanh<input className="pm-input" aria-label="Tìm yêu cầu rút" value={value('q')} placeholder="Server, VM, mã PP, email, tham chiếu" onChange={e=>filter('q',e.target.value)}/></label>
   <label>Server<select className="pm-input" aria-label="Server" value={value('server')} onChange={e=>filter('server',e.target.value)}><option value="">Tất cả server</option>{data?.servers.map(s=><option key={s.id} value={s.id}>{s.code}</option>)}</select></label>
   <label>PayPal<select className="pm-input" aria-label="Mã PayPal" value={value('paypal')} onChange={e=>filter('paypal',e.target.value)}><option value="">Tất cả mã PP</option>{data?.paypals.map(p=><option key={p.id} value={p.id}>{p.code}</option>)}</select></label>
   <label>Trạng thái<select className="pm-input" aria-label="Trạng thái rút" value={value('status')} onChange={e=>filter('status',e.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(statuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
  </div><div className="pr-filter-bottom">{view?<div className="pr-dates">{view.endsWith('TODAY')?<label>{view==='SENT_TODAY'?'Ngày gửi':'Ngày thực nhận'}<input className="pm-input" aria-label={view==='SENT_TODAY'?'Ngày gửi':'Ngày thực nhận'} type="date" value={value('day')||data?.focus?.day||''} onChange={e=>filter('day',e.target.value)}/></label>:<span className="pm-muted">Gồm mọi ngày</span>}</div>:<div className="pr-dates"><label>Ngày yêu cầu từ<input className="pm-input" aria-label="Ngày yêu cầu từ" type="date" value={value('from')} onChange={e=>filter('from',e.target.value)}/></label>
   <label>Đến ngày<input className="pm-input" aria-label="Ngày yêu cầu đến" type="date" value={value('to')} onChange={e=>filter('to',e.target.value)}/></label>
  </div>}<button className="pr-text-button" disabled={!params.toString()} onClick={()=>{setOpened(null);router.replace('/earnapp-withdrawals',{scroll:false});}}>Xoá bộ lọc</button></div></div>
  {picked.length>0&&<div className="pr-bulkbar pm-surface" role="status"><strong>Đã chọn {picked.length} dòng</strong>
   <button className="pm-button" disabled={!sendable} onClick={()=>setBulk('SEND')}>Đã rút {sendable} dòng</button>
   <button className="pm-button" disabled={!receivable} onClick={()=>setBulk('RECEIVE')}>Tiền đã về {receivable} dòng</button>
   <button className="pr-text-button" onClick={()=>setSelected(new Set())}>Bỏ chọn</button></div>}
  <div className="pr-results"><div><strong>{data?`${data.total} yêu cầu`:'Đang tải…'}</strong><span className="pm-muted">Bấm vào yêu cầu để xem và cập nhật</span></div><button className="pr-text-button" disabled={report.isFetching} onClick={()=>void report.refetch()}><RefreshCw size={14}/>Làm mới</button></div>
  {data?.rows.length===0?<div className="pm-surface pr-empty">Chưa có yêu cầu rút phù hợp. Mở Server / VM để tạo yêu cầu hoặc thay đổi bộ lọc.</div>:<div className="pr-table-wrap pm-surface"><table className="pr-table"><thead><tr>{selectable&&<th className="pr-check"><input type="checkbox" aria-label="Chọn mọi dòng trang này" checked={!!data?.rows.length&&data.rows.every(r=>selected.has(r.id))} onChange={e=>setSelected(e.target.checked?new Set(data!.rows.map(r=>r.id)):new Set())}/></th>}<th>Server / VM</th><th>PayPal nhận</th><th className="pr-number">Yêu cầu</th><th className="pr-number">{view==='RECEIVED_TODAY'?'Nhận trong ngày':'Thực nhận'}</th><th className="pr-number">Còn chờ</th><th>Trạng thái</th></tr></thead><tbody>{data?.rows.map(r=><tr key={r.id} className={opened===r.id?'pr-selected':''} onClick={e=>{if((e.target as HTMLElement).closest('button,a,input'))return;open(r,e.currentTarget.querySelector('button'));}}>
   {selectable&&<td className="pr-check" data-label="Chọn"><input type="checkbox" aria-label={`Chọn ${r.server||'Server cũ'} / ${r.vm||r.vmId}`} checked={selected.has(r.id)} onChange={()=>toggle(r.id)}/></td>}
   <td data-label="VM"><button type="button" className="pr-open" aria-label={`Xem yêu cầu ${r.server||'Server cũ'} / ${r.vm||r.vmId}`} aria-haspopup="dialog" onClick={e=>open(r,e.currentTarget)}><span><strong>{r.vm||r.vmId}</strong><span className="pr-server">{r.server||'Server cũ'}</span></span><ChevronRight size={15}/></button>{!!r.members?.length&&<small className="pm-muted block">Gộp {r.members.length+1} VM: + {r.members.map(m=>m.vm||m.vmId).join(', ')}</small>}<small className="pm-muted">{view==='SENT_TODAY'?'Gửi '+dateText(r.submittedAt):dateText(r.requestedAt)}</small></td>
   <td data-label="PayPal"><strong>{r.paypal}</strong><small>{r.email}</small></td>
   <td data-label="Yêu cầu" className="pr-number">{displayMoney(r.amount,r.currency)}</td>
   <td data-label={view==='RECEIVED_TODAY'?'Nhận trong ngày':'Thực nhận'} className="pr-number">{r.receivedInView?r.receivedInView.map(s=><div key={s.currency}>{displayMoney(s.amount,s.currency)}</div>):displayMoney(r.received,r.currency)}</td>
   <td data-label="Còn chờ" className="pr-number">{displayMoney(r.remaining,r.currency)}</td>
   <td data-label="Trạng thái"><Status row={r}/></td>
  </tr>)}</tbody></table></div>}
  {data&&<footer className="pr-footer"><span className="pm-muted">Tổng theo bộ lọc, gồm mọi trang.<br/>Cập nhật {dateText(data.updatedAt)}</span><div className="flex gap-2 items-center"><button className="pm-button" disabled={data.page<=1} onClick={()=>filter('page',String(data.page-1))}>Trước</button><span>Trang {data.page} / {data.pages}</span><button className="pm-button" disabled={data.page>=data.pages} onClick={()=>filter('page',String(data.page+1))}>Sau</button></div></footer>}
  <Dialog.Root open={!!bulk} onOpenChange={isOpen=>{if(!isOpen)setBulk(null);}}>
   {bulk&&data?.rights&&<Dialog.Portal><Dialog.Overlay className="pr-overlay"/><Dialog.Content className="payout-report pr-panel">
    <header className="pr-panel-header"><div><Dialog.Title>{bulk==='SEND'?'Đã rút':'Tiền đã về'}<span>{picked.length} dòng đã chọn</span></Dialog.Title><Dialog.Description>Mỗi dòng một lệnh riêng; kết quả từng dòng.</Dialog.Description></div><Dialog.Close className="pr-icon-button" aria-label="Đóng thao tác hàng loạt"><X size={20}/></Dialog.Close></header>
    <div className="pr-panel-body"><ReportBulk projectId={projectId} userId={data.rights.userId} kind={bulk} rows={picked} onSaved={()=>report.refetch()}/></div>
   </Dialog.Content></Dialog.Portal>}
  </Dialog.Root>
  <Dialog.Root open={!!active} onOpenChange={isOpen=>{if(!isOpen)setOpened(null);}}>
   {active&&data&&<Dialog.Portal><Dialog.Overlay className="pr-overlay"/><Dialog.Content className="payout-report pr-panel" onCloseAutoFocus={e=>{e.preventDefault();(opener.current?.isConnected?opener.current:heading.current)?.focus();}}>
    <header className="pr-panel-header"><div><Dialog.Title>{active.vm||active.vmId}<span>{active.server||'Server cũ'}</span></Dialog.Title><Dialog.Description>Lượt {active.cycle} · Yêu cầu lúc {dateText(active.requestedAt)}</Dialog.Description></div><Dialog.Close className="pr-icon-button" aria-label="Đóng yêu cầu rút"><X size={20}/></Dialog.Close></header>
    <PayoutDetail key={active.id} row={active} projectId={projectId} rights={data.rights} onSaved={()=>report.refetch()}/>
    <footer className="pr-panel-footer"><Link className="pr-text-link" href={links.vms({serverId:active.serverId,vm:active.vmId,tab:'history'})}>Lịch sử VM <ArrowUpRight size={14}/></Link><Dialog.Close className="pm-button">Đóng</Dialog.Close></footer>
   </Dialog.Content></Dialog.Portal>}
  </Dialog.Root>
 </section>;
}

type Report=Awaited<ReturnType<typeof readPayoutReport>>;
type Row=Report['rows'][number];
/** The selected requests on the VMs' current rows (board): an old / consumed request is skipped with its reason. */
function ReportBulk({projectId,userId,kind,rows,onSaved}:{projectId:string;userId?:string;kind:StatusBulkKind;rows:Row[];onSaved:()=>Promise<unknown>}){
 const board=trpc.vmOps.board.useQuery({projectId},{retry:false});
 if(board.error)return <p role="alert" className="pm-error">{board.error.message}</p>;
 if(!board.data)return <p className="pm-muted">Đang tải…</p>;
 const r=board.data.rights,allowed=kind==='SEND'?r.writeMoney||r.payout:r.writeMoney||r.receipt;
 if(!allowed)return <p className="pm-muted">{kind==='SEND'?'Cần quyền ghi Tiền vào PayPal hoặc “Chuẩn bị rút EarnApp”.':'Cần quyền ghi tiền về PayPal.'}</p>;
 const byVm=new Map(board.data.vms.map(v=>[v.vmId,v]));
 const live=(vmId:string)=>byVm.get(vmId);
 const items:StatusBulkRow[]=rows.map(x=>{const o=live(x.vmId);return {vmId:x.vmId,serverId:x.serverId??'',server:x.server||'Server cũ',code:x.vm||x.vmId,label:(x.server||'Server cũ')+' / '+(x.vm||x.vmId),ops:o,notCurrent:!o||o.request?.id!==x.id};});
 return <PayoutStatusBulk projectId={projectId} userId={userId} kind={kind} rows={items} liveOf={live} onSaved={async()=>{await Promise.all([board.refetch(),onSaved()]);}}/>;
}
function Status({row}:{row:Row}){return <span className={'pr-status pr-status-'+row.status.toLowerCase()}>{row.status==='RECEIVED'&&row.shortfall&&row.shortfall!=='0.00'?'Đã chốt nhận thiếu':statuses[row.status]||row.status}</span>;}
function PayoutDetail({row:r,projectId,rights,onSaved}:{row:Row;projectId:string;rights:Report['rights'];onSaved:()=>Promise<unknown>}){
 return <div className="pr-panel-body">
  <div className="pr-panel-status"><Status row={r}/>{r.submittedAt&&<span className="pm-muted">Đã gửi {dateText(r.submittedAt)}</span>}</div>
  <dl className="pr-amounts"><div><dt>Yêu cầu</dt><dd>{displayMoney(r.amount,r.currency)}</dd></div><div><dt>Thực nhận</dt><dd>{displayMoney(r.received,r.currency)}</dd></div><div><dt>Còn chờ</dt><dd>{displayMoney(r.remaining,r.currency)}</dd></div></dl>
  {r.shortfall&&r.shortfall!=='0.00'&&<p className="pr-notice">Đã chốt nhận thiếu {displayMoney(r.shortfall,r.currency)}</p>}
  {!!r.members?.length&&<div className="text-sm"><strong>Rút gộp {r.members.length+1} VM</strong> (tiền tính một lần trên lệnh này): {r.vm||r.vmId} (chính){r.members.map(m=><span key={m.vmId}>, {(m.server||'Server cũ')+' / '+(m.vm||m.vmId)}{m.consumed?' · đã tạo lại':''}</span>)}</div>}
  <dl className="pr-destination"><div><dt>PayPal nhận</dt><dd><strong>{r.paypal}</strong><span>{r.email}</span></dd></div><div><dt>EarnApp</dt><dd>{r.login||'Chưa ghi tài khoản'}</dd></div>{r.reference&&<div><dt>Tham chiếu</dt><dd>{r.reference}</dd></div>}</dl>
  {r.current&&!r.consumed&&rights&&<div className="pr-status-editor"><h2>Rút về PayPal</h2><PayoutFrameForVm projectId={projectId} userId={rights.userId} vmId={r.vmId} requestId={r.id} onDone={onSaved}/></div>}
  <section className="pr-receipts"><h2>Tiền về email <span>{r.receipts.length} khoản</span></h2>{r.receipts.length?<ul>{r.receipts.map(f=><li key={f.id}><div><strong>{displayMoney(f.amount,f.currency)}</strong><span>{receiptStatuses[f.status]||f.status}</span></div><small className="pm-muted">{dateText(f.date)}</small><p>Mã giao dịch: {f.transactionId||'Chưa ghi'}</p></li>)}</ul>:<p className="pm-muted pr-receipts-empty">Chưa ghi khoản thực nhận.</p>}</section>
 </div>;
}
