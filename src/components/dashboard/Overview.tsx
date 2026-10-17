"use client";
import Link from 'next/link';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {RefreshCw,ChevronRight} from 'lucide-react';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {links,query} from '@/lib/links';
import {today} from '@/components/business-management/workflow';
import {CashChart,StockChart,VmByServerChart} from './OverviewCharts';
import '@/components/proxy-management/proxy-management.css';
import './dashboard.css';
export type Overview=inferRouterOutputs<AppRouter>['businessManagement']['overview'];
type Ops=NonNullable<Overview['operations']>;
const fmt=(n:number)=>n.toLocaleString('vi-VN');
const usdt=(s:string)=>Number(s).toLocaleString('vi-VN',{minimumFractionDigits:2,maximumFractionDigits:2});
// Tổng quan: operations (current state) and what needs attention first, finance in its own section (the month only filters finance). Every number
// links to the list it counts; the read model uses the same rules as those lists (see src/server/dashboard/overview.ts).
export function Overview({projectId}:{projectId:string}){
  const params=useSearchParams(),router=useRouter(),pathname=usePathname();
  const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month')||'')?params.get('month')!:today().slice(0,7);
  // A month change is a history entry: Back returns to the previous month.
  const setMonth=(m:string)=>router.push(pathname+query({month:m===today().slice(0,7)?undefined:m}),{scroll:false});
  const data=trpc.businessManagement.overview.useQuery({projectId,month},{keepPreviousData:true,refetchOnWindowFocus:true});
  const o=data.data;
  return <div className="proxy-workspace ov">
    <div className="ov-head"><h1>Tổng quan</h1>
      <span className="pm-muted text-xs">{o?'Vận hành hiện tại · cập nhật '+new Date(o.generatedAt).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'}):data.isLoading?'Đang tải…':''}</span>
      <button className="pm-icon-button" aria-label="Tải lại" title="Tải lại" disabled={data.isFetching} onClick={()=>void data.refetch()}><RefreshCw size={16} className={data.isFetching?'animate-spin':''}/></button></div>
    {data.error&&<div className="ov-error" role="alert"><span>Chưa tải được tổng quan: {data.error.message}</span><button className="pm-button" onClick={()=>void data.refetch()}>Thử lại</button></div>}
    {data.isLoading&&<div className="ov-skeleton" aria-busy="true"><div/><div/><div/></div>}
    {o&&!o.operations&&!showFinance(o)&&<p className="ov-empty">Tài khoản này chưa được cấp mục nào hiển thị ở Tổng quan. Mở các mục ở menu bên trái theo quyền được giao.</p>}
    {o?.operations&&<Operations ops={o.operations}/>}
    {o&&showFinance(o)&&<Finance projectId={projectId} o={o} month={month} onMonth={setMonth} fetching={data.isFetching}/>}
  </div>;
}
// Finance shows for members who may read it (team cash on), or as the switch-on prompt for an admin while it is off.
const showFinance=(o:Overview)=>o.finance?.enabled===true||(o.rights.admin&&!o.rights.cashEnabled);
function Kpi({href,label,value,tone,hint}:{href:string;label:string;value:number|string|null;tone?:'green'|'blue'|'amber'|'red';hint?:string}){
  return <Link href={href} className={'ov-kpi'+(tone?' ov-'+tone:'')}><span>{label}</span><strong>{value===null?'—':typeof value==='number'?fmt(value):value}</strong>{hint&&<small>{hint}</small>}</Link>;
}
function Operations({ops}:{ops:Ops}){
  const t=ops.totals;
  // A project without servers or proxies: one short line with the next step, not a block of zeros.
  if(!t.servers&&!ops.stock.total)return <div className="pm-surface ov-card"><p className="ov-empty">Dự án chưa có server / VM và proxy. <Link className="pm-link" href={links.vms()}>Thêm server ở Server / VM</Link> · <Link className="pm-link" href={links.proxies()}>Nhập proxy ở Kho proxy</Link></p></div>;
  return <>
    <div className="ov-kpis">
      <Kpi href={links.vms()} label="Server / VM" value={`${fmt(t.servers)} / ${fmt(t.vms)}`} hint="đang vận hành"/>
      <Kpi href={links.vms({view:'INSTALLED'})} label="Đã xác nhận cài" value={t.INSTALLED} tone="green"/>
      <Kpi href={links.vms({view:'PENDING'})} label="Chờ cài" value={t.PENDING} tone="blue"/>
      <Kpi href={links.vms({view:'REVIEW'})} label="Cần kiểm tra" value={t.REVIEW} tone="amber"/>
      <Kpi href={links.vms({view:'MISSING'})} label="Thiếu proxy" value={t.MISSING} tone="red"/>
    </div>
    <div className="ov-grid"><div className="ov-main">
      <section className="pm-surface ov-card ov-wide" aria-labelledby="ov-vm"><div className="ov-card-head"><h2 id="ov-vm">VM theo server</h2><Link className="pm-link text-xs" href={links.vms()}>Mở Server / VM</Link></div><VmByServerChart ops={ops}/></section>
      <section className="pm-surface ov-card ov-wide" aria-labelledby="ov-stock"><div className="ov-card-head"><h2 id="ov-stock">Kho proxy · đang quản lý</h2><Link className="pm-link text-xs" href={links.proxies()}>Mở Kho proxy</Link></div><StockChart ops={ops}/>
        <p className="text-xs mt-2"><Link className="pm-link" href={links.vms({view:'MISSING'})}>NEW đủ điều kiện giao VM: TUT {fmt(ops.stock.ready.autofill)} (tự điền được) · Chung mooon–Genjy {fmt(ops.stock.ready.sharedManual)} (chỉ giao tay)</Link></p>
        <p className="pm-muted text-xs mt-1">Phạm vi: tab Đang quản lý của Kho proxy ({fmt(ops.stock.total)} dòng, không gồm IP đã replace / thu hồi / ngừng quản lý). NEW chưa chắc giao được (gói, thông tin đăng nhập, lịch sử). LIVE là đang ghi nhận sử dụng, không chứng minh proxy hoạt động.</p></section>
      </div><div className="ov-aside"><Attention ops={ops}/><Gaps ops={ops}/></div>
    </div>
  </>;
}
function Row({href,label,count,tone,children}:{href:string;label:string;count:number|null;tone?:'red'|'amber'|'blue'|'muted';children?:React.ReactNode}){
  return <li><Link href={href} className="ov-row"><span className="ov-row-label">{label}{children}</span><span className={'ov-count'+(count&&tone?' ov-'+tone:'')}>{count===null?'—':fmt(count)}</span><ChevronRight size={15} className="pm-muted shrink-0"/></Link></li>;
}
// Short list of what needs handling now: broken proxies, VMs to check, packages to pay, install tasks left open at a VM.
function Attention({ops}:{ops:Ops}){
  const overdue=ops.packages.filter(p=>p.daysLeft<0).length,blocked=ops.stock.rows.reduce((a,r)=>a+r.BLOCKED,0),o=ops.orphanTasks;
  const clear=!blocked&&!ops.totals.REVIEW&&!ops.packages.length&&!o.count;
  return <section className="pm-surface ov-card ov-side" aria-labelledby="ov-attention"><div className="ov-card-head"><h2 id="ov-attention">Cần xử lý</h2></div>
    {clear?<p className="ov-empty">Không có việc cần xử lý.</p>:<ul className="ov-list">
      {blocked>0&&<Row href={links.proxies({state:'BLOCKED'})} label="Proxy BLOCKED" count={blocked} tone="red"><small className="ov-sub">báo nhà cung cấp hoặc nhận replace</small></Row>}
      {ops.totals.REVIEW>0&&<Row href={links.vms({view:'REVIEW'})} label="VM cần kiểm tra" count={ops.totals.REVIEW} tone="amber"/>}
      {ops.packages.length>0&&<Row href={links.packages()} label="Gói proxy cần thanh toán" count={ops.packages.length} tone={overdue?'red':'amber'}>{overdue?<small className="ov-sub">{overdue} quá hạn</small>:null}</Row>}
      {ops.packages.slice(0,3).map(p=><li key={p.id}><Link href={p.link} className={'ov-row ov-row-child ov-'+(p.severity==='error'?'red':p.severity==='warning'?'amber':'blue')}><span className="ov-row-label">{p.title}</span><ChevronRight size={14} className="pm-muted shrink-0"/></Link></li>)}
      {o.count>0&&<Row href={o.link} label="Việc cài bị bỏ lại" count={o.count} tone="amber"><small className="ov-sub">còn mở, không còn cấu hình chờ cài · đóng tại VM</small></Row>}
    </ul>}</section>;
}
function Gaps({ops}:{ops:Ops}){
  const g=ops.gaps;
  return <section className="pm-surface ov-card ov-side" aria-labelledby="ov-gaps"><div className="ov-card-head"><h2 id="ov-gaps">VM thiếu thông tin</h2></div>
    <ul className="ov-list">
      <Row href={links.vms({view:'SDK_MISSING'})} label="Chưa có SDK" count={g.noSdk} tone="amber"/>
      <Row href={links.vms({view:'ACCOUNT_MISSING'})} label="Chưa có tài khoản EarnApp" count={g.noAccount} tone="amber"/>
      <Row href={links.vms({view:'PAYPAL_MISSING'})} label="Chưa có PayPal nhận" count={g.noPaypal} tone="amber"/>
    </ul>
    <p className="pm-muted text-xs px-4 pb-3">Các nhóm có thể trùng nhau (VM chưa có tài khoản thì cũng chưa có PayPal), không cộng thành số VM lỗi. Giao proxy, xác nhận cài, ghi SDK và đăng ký EarnApp là các việc khác nhau.</p></section>;
}
function Finance({projectId,o,month,onMonth,fetching}:{projectId:string;o:Overview;month:string;onMonth:(m:string)=>void;fetching:boolean}){
  const utils=trpc.useUtils(),activate=trpc.businessManagement.activateCash.useMutation({onSuccess:()=>{void utils.project.myMembership.invalidate();void utils.businessManagement.invalidate();}});
  const f=o.finance;
  return <section className="pm-surface ov-card ov-finance" aria-labelledby="ov-finance">
    <div className="ov-card-head"><h2 id="ov-finance">Tài chính</h2>{f?.enabled&&<><input type="month" aria-label="Tháng tài chính" className="pm-input ov-month" value={month} onChange={e=>{if(e.target.value)onMonth(e.target.value);}}/>{fetching&&<span className="pm-muted text-xs">Đang tải…</span>}<span className="pm-muted text-xs">Tháng chỉ áp dụng cho phần tài chính.</span></>}</div>
    {!f?.enabled?<div className="ov-empty">{o.rights.admin?<><span>Thu chi USDT chưa bật cho dự án này: lợi nhuận tính từ USDT thực nhận về team trừ chi phí.</span> <button className="pm-button" disabled={activate.isLoading} onClick={()=>activate.mutate({projectId,key:crypto.randomUUID()})}>Bật thu chi USDT</button>{activate.error&&<p role="alert" className="pm-error">{activate.error.message}</p>}</>:'Thu chi USDT chưa bật cho dự án này.'}</div>:<>
      {f.records===0&&f.blockingCount===0&&Number(f.received)===0&&Number(f.cost)===0?<div className="ov-empty">Tháng {month.split('-').reverse().join('/')} chưa có khoản nhận USDT hay chi phí nào.{o.rights.withdrawals&&<> <Link className="pm-link" href={links.teamReceipts()}>Ghi nhận USDT về team</Link></>}{o.rights.costs&&<> · <Link className="pm-link" href={links.costs({month})}>Ghi chi phí</Link></>}</div>:<>
      <div className="ov-kpis ov-kpis-3">
        <Kpi href={links.teamReceipts()} label="USDT thực nhận về team" value={usdt(f.received)} tone="green" hint="đã xác nhận nhận"/>
        <Kpi href={links.costs({month})} label="Chi phí" value={usdt(f.cost)} tone="red" hint="quy đổi theo tỷ giá từng khoản"/>
        <Kpi href={links.profit()} label="Lợi nhuận" value={usdt(f.net)} tone={Number(f.net)<0?'red':'blue'} hint="USDT"/>
      </div>
      {f.blockingCount>0&&<p className="ov-warn">Còn {f.blockingCount} khoản cần xử lý trước khi chốt kỳ{f.missingRate?<> · <Link className="pm-link" href={links.costs({month})}>{f.missingRate} chi phí thiếu tỷ giá</Link></>:null}{f.unverified?<> · <Link className="pm-link" href={links.teamReceipts({sources:true})}>{f.unverified} khoản nhận / collector cần đối soát</Link></>:null}</p>}
      <CashChart fin={f} month={month}/>
      {f.series.length>0&&<p className="ov-legend-line"><span className="ov-dot" style={{background:'#16a34a'}}/>Thực nhận <span className="ov-dot ml-3" style={{background:'#ef4444'}}/>Chi phí · bấm cột để mở danh sách. Tiền còn ở collector chưa tính là đã nhận.</p>}
    </>}</>}
  </section>;
}
