"use client";
import {useState} from 'react';
import Link from 'next/link';
import {trpc} from '@/lib/trpc';
import {today,monthRange} from './workflow';
import {ErrorNotice} from './shared';
import {BusinessOverview} from './BusinessOverview';
export function CashNav({projectId}:{projectId:string}){
 const a=trpc.businessManagement.cashAccess.useQuery({projectId});
 return <nav aria-label="Thu chi" className="flex gap-2 flex-wrap">{a.data?.costs&&<Link className="pm-button" href="/costs">Chi phí</Link>}{a.data?.withdrawals&&<><Link className="pm-button" href="/withdrawals">Nhận về team</Link><Link className="pm-button" href="/withdrawals?view=original">Rút / chuyển gốc</Link></>}{a.data?.funds&&<Link className="pm-button" href="/funds">Tiền vào PayPal</Link>}{a.data?.profit&&<Link className="pm-button" href="/profit">Lợi nhuận USDT</Link>}<Link className="pm-button" href="/history">Lịch sử</Link></nav>;
}
export function TeamCashOverview({projectId}:{projectId:string}){
 const [month,setMonth]=useState(today().slice(0,7)),range=monthRange(month),a=trpc.businessManagement.cashAccess.useQuery({projectId}),report=trpc.businessManagement.cashSummary.useQuery({projectId,...range},{enabled:!!a.data?.profit});
 return <div className="proxy-workspace space-y-5"><div className="pm-heading"><div><h1>Tiền về team</h1><p className="pm-muted">Lợi nhuận = USDT thực nhận − chi phí quy đổi trong kỳ.</p></div><input className="pm-input w-auto" type="month" aria-label="Tháng báo cáo" value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}}/></div><CashNav projectId={projectId}/>{report.data&&<><div className="pm-summary tabular-nums"><div><span>Đã về team</span><strong>{report.data.teamReceived}</strong><small>USDT</small></div><div><span>Chi phí</span><strong>{report.data.cost}</strong><small>USDT</small></div><div><span>Lợi nhuận</span><strong>{report.data.net}</strong><small>USDT</small></div></div>{report.data.blockingCount>0&&<div className="pm-surface p-4"><strong>Còn {report.data.blockingCount} khoản cần xử lý trước khi chốt kỳ</strong><div className="flex gap-3 mt-2"><Link className="underline" href="/costs">Bổ sung tỷ giá</Link><Link className="underline" href="/withdrawals?view=sources">Đối soát collector</Link></div></div>}<p className="pm-muted text-sm">{report.data.unlinkedReceiptCount} phiếu đã nhận USDT cần đối soát nguồn USD. {report.data.excludedNettedCostCount} khoản phí đã trừ trước khi nhận, không bị trừ thêm.</p></>}{a.data&&!a.data.profit&&<p className="pm-muted">Chọn mục thu chi được cấp quyền ở trên để thao tác.</p>}<ErrorNotice error={a.error||report.error}/>{a.data?.infra&&<BusinessOverview projectId={projectId} operationsOnly/>}</div>;
}
