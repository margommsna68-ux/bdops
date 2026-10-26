"use client";
import Link from 'next/link';
import {ArrowUpRight,CheckCheck,Clock3,Send,TriangleAlert} from 'lucide-react';
import {trpc} from '@/lib/trpc';
import {displayMoney} from '@/lib/money-input';
import './payout-summary.css';

const metrics=[
 {key:'sent',view:'SENT_TODAY',label:'Đã gửi hôm nay',hint:'Đã gửi trên EarnApp',empty:'Chưa có lượt gửi',Icon:Send},
 {key:'waiting',view:'WAITING',label:'Đang chờ về',hint:'Gồm cả những ngày trước',empty:'Không còn khoản chờ',Icon:Clock3},
 {key:'received',view:'RECEIVED_TODAY',label:'PayPal nhận hôm nay',hint:'Tiền thực nhận đã xác nhận',empty:'Chưa có khoản nhận',Icon:CheckCheck},
 {key:'attention',view:'ATTENTION',label:'Cần xử lý',hint:'Thất bại · chưa rõ · đối chiếu',empty:'Không có yêu cầu cần xử lý',Icon:TriangleAlert},
] as const;

export function PayoutSummary({projectId,serverId}:{projectId:string;serverId?:string}){
 const query=trpc.vmOps.payoutDashboard.useQuery({projectId,serverId:serverId||undefined},{keepPreviousData:false,refetchInterval:30000,refetchOnWindowFocus:true,retry:1});
 // An error or revoked right hides cached financial values immediately.
 if(query.error)return <section className="ps-summary ps-error" role="alert"><span>Chưa tải được báo cáo EarnApp → PayPal.</span><button className="pm-button" disabled={query.isFetching} onClick={()=>void query.refetch()}>Thử lại</button></section>;
 const data=query.data;
 if(data&&!data.available)return null;
 const params=new URLSearchParams(serverId?{server:serverId}:{}),all='/earnapp-withdrawals'+(params.size?'?'+params:'');
 return <section className="ps-summary" aria-labelledby="ps-title" aria-busy={!data}>
  <header className="ps-header"><div><h2 id="ps-title">EarnApp <span aria-hidden="true">→</span> PayPal</h2><span className="ps-meta">{data?data.day.split('-').reverse().join('/')+' · Giờ Việt Nam':'Đang tải báo cáo…'}</span></div><Link href={all} className="ps-report-link">Xem báo cáo <ArrowUpRight size={14} aria-hidden="true"/></Link></header>
  <div className="ps-metrics">{metrics.map(({key,view,label,hint,empty,Icon})=>{
   const card=data?.available?data.cards[key]:undefined;
   const target=new URLSearchParams(params);target.set('view',view);if(data&&view.endsWith('TODAY'))target.set('day',data.day);
   const content=<><span className="ps-label"><Icon size={15} aria-hidden="true"/>{label}</span><div className="ps-value">{!card?<strong>…</strong>:key==='attention'?<strong>{card.requests.toLocaleString('vi-VN')} <small>yêu cầu</small></strong>:card.amounts.length?card.amounts.map(s=><strong key={s.currency}>{displayMoney(s.amount,s.currency)}</strong>):<strong>—</strong>}</div><span className="ps-count">{card?`${card.vms.toLocaleString('vi-VN')} VM${card.requests!==card.vms?' · '+card.requests.toLocaleString('vi-VN')+' yêu cầu':''}`:'Đang tải…'}<ArrowUpRight size={13} aria-hidden="true"/></span><span className="ps-hint">{card?.requests===0?empty:hint}</span></>;
   return card?<Link key={key} href={'/earnapp-withdrawals?'+target} className={'ps-metric ps-'+key+(card.requests===0?' ps-empty':'')}>{content}</Link>:<div key={key} className="ps-metric">{content}</div>;
  })}</div>
  {data&&<footer className="ps-foot"><span>Tiền về PayPal được theo dõi riêng với USDT về team.</span><time dateTime={data.updatedAt} title={new Date(data.updatedAt).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok'})}>Cập nhật {new Date(data.updatedAt).toLocaleTimeString('vi-VN',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'})}</time></footer>}
 </section>;
}
