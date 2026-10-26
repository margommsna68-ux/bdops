"use client";
import {useState} from 'react';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import {trpc} from '@/lib/trpc';
import {links} from '@/lib/links';
import {displayMoney} from '@/lib/money-input';
import '@/components/proxy-management/proxy-management.css';
import './payout-report.css';
import type {readPayoutReport} from '@/server/vm-ops/payout-report';

const statuses={PREPARING:'Đang chuẩn bị',UNKNOWN:'Chưa rõ kết quả',WAITING:'Chờ về PayPal',PARTIAL:'Đã nhận một phần',RECEIVED:'Đã nhận đủ / chốt',FAILED:'Thất bại',CANCELLED:'Đã huỷ',REVIEW:'Cần đối chiếu'};
const receiptStatuses:Record<string,string>={RECEIVED:'Đã nhận',CONFIRMED:'Đã nhận',PENDING:'Chờ xác nhận',FAILED:'Không về',VOIDED:'Đã thu hồi'};
const dateText=(value:string|null)=>!value?'—':new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric',...(value.length>10?{hour:'2-digit',minute:'2-digit'}:{})}).format(new Date(value.length===10?value+'T12:00:00+07:00':value));

export function PayoutReportWorkspace({projectId}:{projectId:string}){
 const params=useSearchParams(),router=useRouter(),[opened,setOpened]=useState<string|null>(null);
 const value=(key:string)=>params.get(key)||'';
 const status=Object.hasOwn(statuses,value('status'))?value('status') as keyof typeof statuses:undefined;
 const report=trpc.vmOps.payoutReport.useQuery({projectId,q:value('q')||undefined,serverId:value('server')||undefined,paypalId:value('paypal')||undefined,status,from:value('from')||undefined,to:value('to')||undefined,page:Math.max(1,Number(value('page'))||1)},{refetchInterval:30000,keepPreviousData:false});
 function filter(key:string,next:string){const p=new URLSearchParams(params.toString());if(next)p.set(key,next);else p.delete(key);if(key!=='page')p.delete('page');setOpened(null);router.replace('/earnapp-withdrawals'+(p.size?'?'+p.toString():''),{scroll:false});}
 if(report.error)return <div className="proxy-workspace"><h1>Rút EarnApp → PayPal</h1><p role="alert" className="pm-error">{report.error.message}</p><button className="pm-button" onClick={()=>router.replace('/earnapp-withdrawals',{scroll:false})}>Xoá bộ lọc</button></div>;
 const data=report.data;
 return <section className="proxy-workspace payout-report">
  <header className="pr-heading"><div><h1>Rút EarnApp → PayPal</h1><p className="pm-muted">Theo dõi yêu cầu từ từng VM và tiền thực nhận theo email PayPal.</p></div><Link className="pm-button" href={links.vms()}>Mở Server / VM</Link></header>
  <div className="pr-summary pm-surface" aria-label="Tổng theo bộ lọc">
   {([['sent','Đã gửi trên EarnApp'],['waiting','Còn chờ về PayPal'],['received','PayPal thực nhận'],['prepared','Đang chuẩn bị']] as const).map(([key,label])=><div key={key}><span className="pm-muted">{label}</span>{data?data.summary.length?data.summary.map(s=><strong key={s.currency}>{displayMoney(s[key],s.currency)}</strong>):<strong>—</strong>:<strong>…</strong>}</div>)}
  </div>
  <p className="pr-explain pm-muted">Tổng thuộc các yêu cầu đang lọc, gồm mọi trang. Đã gửi gồm cả lượt sau đó thất bại hoặc huỷ; đang chuẩn bị và chưa rõ kết quả chưa tính. Thực nhận chỉ lấy khoản đã xác nhận trong sổ PayPal.</p>
  {data?.summary.filter(s=>s.unknown!=='0.00').map(s=><p key={s.currency} className="pm-error">Chưa rõ kết quả gửi: {displayMoney(s.unknown,s.currency)} — cần đối chiếu lịch sử EarnApp.</p>)}
  <div className="pr-filters">
   <label>Tìm nhanh<input className="pm-input" aria-label="Tìm yêu cầu rút" value={value('q')} placeholder="Server, VM, mã PP, email, tham chiếu" onChange={e=>filter('q',e.target.value)}/></label>
   <label>Server<select className="pm-input" aria-label="Server" value={value('server')} onChange={e=>filter('server',e.target.value)}><option value="">Tất cả server</option>{data?.servers.map(s=><option key={s.id} value={s.id}>{s.code}</option>)}</select></label>
   <label>PayPal<select className="pm-input" aria-label="Mã PayPal" value={value('paypal')} onChange={e=>filter('paypal',e.target.value)}><option value="">Tất cả mã PP</option>{data?.paypals.map(p=><option key={p.id} value={p.id}>{p.code}</option>)}</select></label>
   <label>Trạng thái<select className="pm-input" aria-label="Trạng thái rút" value={value('status')} onChange={e=>filter('status',e.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(statuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label>Ngày yêu cầu từ<input className="pm-input" aria-label="Ngày yêu cầu từ" type="date" value={value('from')} onChange={e=>filter('from',e.target.value)}/></label>
   <label>Đến ngày<input className="pm-input" aria-label="Ngày yêu cầu đến" type="date" value={value('to')} onChange={e=>filter('to',e.target.value)}/></label>
  </div>
  <div className="pr-results"><span>{data?`${data.total} yêu cầu`:'Đang tải…'}</span><div className="flex gap-2"><button className="pm-button" disabled={!params.toString()} onClick={()=>router.replace('/earnapp-withdrawals',{scroll:false})}>Xoá bộ lọc</button><button className="pm-button" disabled={report.isFetching} onClick={()=>void report.refetch()}>Làm mới</button></div></div>
  {data?.rows.length===0?<div className="pm-surface pr-empty">Chưa có yêu cầu rút phù hợp. Mở Server / VM để tạo yêu cầu hoặc thay đổi bộ lọc.</div>:<div className="pr-table-wrap pm-surface"><table className="pr-table"><thead><tr><th>VM / ngày yêu cầu</th><th>PayPal / email nhận</th><th>Yêu cầu</th><th>Thực nhận</th><th>Còn chờ</th><th>Trạng thái</th><th><span className="sr-only">Chi tiết</span></th></tr></thead><tbody>{data?.rows.map(r=><PayoutReportRow key={r.id} row={r} opened={opened===r.id} onToggle={()=>setOpened(opened===r.id?null:r.id)}/>)}</tbody></table></div>}
  {data&&<footer className="pr-footer"><span className="pm-muted">Cập nhật {dateText(data.updatedAt)}</span><div className="flex gap-2 items-center"><button className="pm-button" disabled={data.page<=1} onClick={()=>filter('page',String(data.page-1))}>Trước</button><span>Trang {data.page} / {data.pages}</span><button className="pm-button" disabled={data.page>=data.pages} onClick={()=>filter('page',String(data.page+1))}>Sau</button></div></footer>}
 </section>;
}

type Report=Awaited<ReturnType<typeof readPayoutReport>>;
function PayoutReportRow({row:r,opened,onToggle}:{row:Report['rows'][number];opened:boolean;onToggle:()=>void}){
 return <><tr>
  <td data-label="VM"><Link className="pr-vm" href={links.vms({serverId:r.serverId,vm:r.vmId,tab:'history'})}>{r.server||'Server cũ'} / {r.vm||r.vmId}</Link><small className="pm-muted">{dateText(r.requestedAt)} · Lượt {r.cycle}</small></td>
  <td data-label="PayPal"><strong>{r.paypal}</strong><small>{r.email}</small></td>
  <td data-label="Yêu cầu" className="pr-number">{displayMoney(r.amount,r.currency)}</td>
  <td data-label="Thực nhận" className="pr-number">{displayMoney(r.received,r.currency)}</td>
  <td data-label="Còn chờ" className="pr-number">{displayMoney(r.remaining,r.currency)}</td>
  <td data-label="Trạng thái"><span className={'pr-status pr-status-'+r.status.toLowerCase()}>{r.status==='RECEIVED'&&r.shortfall&&r.shortfall!=='0.00'?'Đã chốt nhận thiếu':statuses[r.status]||r.status}</span></td>
  <td><button className="pm-button" aria-expanded={opened} onClick={onToggle}>{opened?'Thu gọn':'Chi tiết'}</button></td>
 </tr>{opened&&<tr className="pr-detail"><td colSpan={7}><div className="pr-detail-top"><div><span className="pm-muted">Tài khoản EarnApp</span><p>{r.login}</p></div><div><span className="pm-muted">Đã gửi</span><p>{dateText(r.submittedAt)}</p></div><div><span className="pm-muted">Tham chiếu</span><p>{r.reference||'Chưa ghi'}</p></div>{r.shortfall&&r.shortfall!=='0.00'&&<div><span className="pm-muted">Đã chốt thiếu</span><p>{displayMoney(r.shortfall,r.currency)}</p></div>}</div><h2>Khoản nhận về email {r.email}</h2>{r.receipts.length?r.receipts.map(f=><div className="pr-receipt" key={f.id}><span>{dateText(f.date)}</span><strong>{displayMoney(f.amount,f.currency)}</strong><span>{receiptStatuses[f.status]||f.status}</span><span>Mã giao dịch: {f.transactionId||'Chưa ghi'}</span></div>):<p className="pm-muted">Chưa ghi khoản thực nhận. “Đã gửi trên EarnApp” chưa phải tiền đã về PayPal.</p>}</td></tr>}</>;
}
