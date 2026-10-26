"use client";
import {useState} from 'react';
import Link from 'next/link';
import {HEALTH_LABEL,PROBLEM_LABEL,type BusinessPulse as Pulse} from '@/lib/business-pulse';
import {links} from '@/lib/links';
import './business-pulse.css';

export interface PulsePackage {
  id:string;code:string;link:string;daysLeft:number;
  dueAt?:string|null;amount?:string|null;currency?:string|null;
}
type Row=Pulse['rows'][number];
const active=(r:Row)=>r.health!=='PAUSED'&&r.health!=='NEW';
// Counts and drilldowns share predicates over the server's authorized projection. Never infer health from money or stored status.
const filters={
  ALL:{label:'Tất cả VM',match:(_r:Row)=>true},
  ACTIVE:{label:'Đang hoạt động',match:active},
  GOOD:{label:HEALTH_LABEL.GOOD,match:(r:Row)=>r.health==='GOOD'},
  ERROR:{label:HEALTH_LABEL.ERROR,match:(r:Row)=>r.health==='ERROR'},
  REPORTED:{label:'Đã báo / chờ xử lý',match:(r:Row)=>active(r)&&!!r.recordedIssue},
  UNKNOWN:{label:HEALTH_LABEL.UNKNOWN,match:(r:Row)=>r.health==='UNKNOWN'},
  PAUSED:{label:HEALTH_LABEL.PAUSED,match:(r:Row)=>r.health==='PAUSED'},
  NEW:{label:HEALTH_LABEL.NEW,match:(r:Row)=>r.health==='NEW'},
  COVERED:{label:'Có số tăng ghi nhận',match:(r:Row)=>active(r)&&r.delta!==null},
  INCREASING:{label:'Có tăng',match:(r:Row)=>active(r)&&r.trend==='INCREASING'},
  FLAT:{label:'Chưa thấy tăng',match:(r:Row)=>active(r)&&r.trend==='FLAT'},
  DECREASED:{label:'Số dư giảm',match:(r:Row)=>active(r)&&r.trend==='DECREASED'},
  MONEY_UNKNOWN:{label:'Chưa đủ lần đọc',match:(r:Row)=>active(r)&&r.trend==='UNKNOWN'},
  ENOUGH:{label:'Đủ tiền rút',match:(r:Row)=>r.threshold==='ENOUGH'},
  SOON:{label:'Sắp đủ',match:(r:Row)=>r.threshold==='SOON'},
  THRESHOLD_UNKNOWN:{label:'Chưa rõ mức tiền',match:(r:Row)=>active(r)&&r.threshold==='UNKNOWN'},
};
type Filter=keyof typeof filters;
const moneyFilters=new Set<Filter>(['COVERED','INCREASING','FLAT','DECREASED','MONEY_UNKNOWN','ENOUGH','SOON','THRESHOLD_UNKNOWN']);
const number=(n:number)=>n.toLocaleString('vi-VN');
const units=(s:string)=>{const [whole,fraction='']=s.split('.');return BigInt(whole)*BigInt(1000000)+BigInt(fraction.padEnd(6,'0'));};
// Keep all six observed decimal places when summing; round only the displayed amount.
function decimal(s:string){
  const cents=(units(s)+BigInt(5000))/BigInt(10000),fraction=(cents%BigInt(100)).toString().padStart(2,'0').replace(/0+$/,'');
  return (cents/BigInt(100)).toLocaleString('vi-VN')+(fraction?','+fraction:'');
}
const dollars=(s:string)=>'$'+decimal(s);
function packageCost(amount:string,currency:string|null|undefined){
  if(currency==='USD_PAYPAL')return dollars(amount)+' PayPal';
  if(currency==='USD')return dollars(amount);
  return `${decimal(amount)} ${currency==='VND'?'₫':currency||'(chưa có đơn vị tiền)'}`;
}
function sumAmounts(amounts:string[]){
  const sum=amounts.reduce((total,amount)=>total+units(amount),BigInt(0));
  return (sum/BigInt(1000000)).toString()+'.'+(sum%BigInt(1000000)).toString().padStart(6,'0');
}
function growth(rows:Row[]){
  const covered=rows.filter(filters.COVERED.match);
  if(!covered.length)return null;
  return sumAmounts(covered.map(r=>r.delta!));
}
function Time({at,dateOnly=false}:{at:string|null|undefined;dateOnly?:boolean}){
  if(!at||!Number.isFinite(Date.parse(at)))return <>Chưa có thời điểm</>;
  return <time dateTime={at}>{new Date(at).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric',...(!dateOnly?{hour:'2-digit',minute:'2-digit'} as const:{})})}</time>;
}
const healthTone=(r:Row)=>r.health==='GOOD'?'good':r.health==='ERROR'?'error':r.health==='UNKNOWN'?'warn':'neutral';

export function BusinessPulse({pulse,packages,costsVisible}:{pulse:Pulse;packages:PulsePackage[];costsVisible:boolean}) {
  // Local selections survive the 30-second query refresh; a new project remounts this component in Overview.
  const [serverId,setServerId]=useState(''),[selected,setSelected]=useState<Filter|null>(null),[limit,setLimit]=useState(12);
  const servers=Array.from(new Map(pulse.rows.map(r=>[r.serverId,r.server])).entries()).sort((a,b)=>a[1].localeCompare(b[1],'vi',{numeric:true}));
  const rows=serverId?pulse.rows.filter(r=>r.serverId===serverId):pulse.rows;
  const filter=selected&&(!moneyFilters.has(selected)||pulse.moneyRead)?selected:null;
  const count=(key:Filter,source=rows)=>source.filter(filters[key].match).length;
  const choose=(key:Filter,server=serverId)=>{setSelected(key);setServerId(server);setLimit(12);};
  const matched=filter?rows.filter(filters[filter].match):[];
  const totalActive=count('ACTIVE'),daily=pulse.moneyRead?growth(rows):null;
  const enough=pulse.moneyRead?rows.filter(filters.ENOUGH.match):[];
  const enoughAmount=enough.length?sumAmounts(enough.map(r=>r.amount!)):null;
  const latestCheck=rows.filter(active).map(r=>r.checkedAt).filter((at):at is string=>!!at&&Number.isFinite(Date.parse(at))&&Date.parse(at)<=Date.parse(pulse.generatedAt)).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null;
  const metric=(key:Filter,children?:React.ReactNode,className='bp-chip')=><button type="button" className={className} aria-label={`${filters[key].label}: ${number(count(key))} VM`} aria-pressed={filter===key} aria-controls="bp-vm-list" onClick={()=>choose(key)}>{children??<>{filters[key].label} <strong>{number(count(key))}</strong></>}</button>;
  return <div className="business-pulse">
    <div className="bp-toolbar"><label>Phạm vi VM <select className="pm-input" aria-label="Chọn server" value={serverId} onChange={e=>{setServerId(e.target.value);setLimit(12);}}>
      <option value="">Tất cả server được xem</option>{servers.map(([id,name])=><option key={id} value={id}>{name}</option>)}
      {serverId&&!servers.some(([id])=>id===serverId)&&<option value={serverId}>Server không còn trong phạm vi</option>}
    </select></label><span className="bp-note">Ngày {pulse.day.split('-').reverse().join('/')} · giờ Việt Nam</span></div>
    {!pulse.rows.length?<p className="bp-empty">Chưa có VM trong phạm vi được xem. <Link href={links.vms()} className="pm-link">Mở Server / VM</Link></p>:<>
      <div className="bp-cards">
        <section className="bp-card" aria-labelledby="bp-health"><h2 id="bp-health">VM hoạt động</h2>
          <div className="bp-main-number">{metric('GOOD',<strong className="bp-good">{number(count('GOOD'))}</strong>,'bp-number-button')}<span>/</span>{metric('ACTIVE',<strong>{number(totalActive)}</strong>,'bp-number-button')}<span className="bp-unit">VM</span></div>
          <p className="bp-note">Đang kiếm tiền / đang hoạt động</p>
          <div className="bp-chips">{metric('ERROR',undefined,'bp-chip bp-error')}{metric('UNKNOWN',undefined,'bp-chip bp-warn')}</div>
          <div className="bp-separated">{metric('PAUSED')}{metric('NEW')}</div>
          <p className="bp-note">Tạm dừng và chưa cài được tính riêng. Kiếm tiền cần kết quả kiểm tra trong 24 giờ.</p>
          <p className="bp-note">Từ kết quả kiểm tra từng VM. Gần nhất: <Time at={latestCheck}/>. Mốc này không đại diện cho tất cả VM.</p>
        </section>
        <section className="bp-card" aria-labelledby="bp-growth"><h2 id="bp-growth">Tăng ghi nhận hôm nay</h2>
          {!pulse.moneyRead?<p className="bp-unavailable">Chưa có quyền xem tiền</p>:<>
            {daily===null?<p className="bp-unavailable">Chưa đủ dữ liệu</p>:metric('COVERED',<strong>{dollars(daily)}</strong>,'bp-number-button bp-main-number')}
            <p className="bp-note">Có số tăng ghi nhận: {number(count('COVERED'))} / {number(totalActive)} VM</p>
            <div className="bp-chips">{metric('INCREASING')}{metric('FLAT')}{metric('DECREASED')}{metric('MONEY_UNKNOWN')}</div>
            <p className="bp-note">Từ lần đọc đầu đến lần đọc cuối hôm nay trên cùng mã SDK, VM và lượt. Số giảm được đối chiếu riêng; đây chưa phải tiền nhận.</p>
          </>}
        </section>
        <section className="bp-card" aria-labelledby="bp-withdrawal"><h2 id="bp-withdrawal">Đủ tiền rút</h2>
          {!pulse.moneyRead?<p className="bp-unavailable">Chưa có quyền xem tiền</p>:<>
            {metric('ENOUGH',<><strong>{number(count('ENOUGH'))}</strong><span className="bp-unit">VM từ $10</span></>,'bp-number-button bp-main-number')}
            {enoughAmount!==null&&<p>Tiền trong {number(enough.length)} VM: <strong>{dollars(enoughAmount)}</strong></p>}
            <div className="bp-chips">{metric('SOON',<>Sắp đủ <strong>{number(count('SOON'))}</strong><span> · từ $8 đến dưới $10</span></>)}{metric('THRESHOLD_UNKNOWN')}</div>
            <p className="bp-note">Chỉ là số tiền đã đọc, chưa phải tiền nhận hoặc cam kết rút được. Cần kiểm tra tài khoản, email PayPal và yêu cầu rút trước khi thao tác.</p>
          </>}
        </section>
      </div>
      <section className="bp-panel" aria-labelledby="bp-attention"><div className="bp-section-head"><h2 id="bp-attention">Cần xem</h2><span className="bp-note">Một VM có thể ở nhiều nhóm.</span></div>
        <div className="bp-actions">
          <Action label="Đã báo / chờ xử lý" hint="Vấn đề đã ghi trên web, cần xử lý hoặc xác nhận lại." count={count('REPORTED')} tone="warn" selected={filter==='REPORTED'} onClick={()=>choose('REPORTED')}/>
          <Action label="Có lỗi" hint="Xem lỗi EarnApp, VM hoặc proxy và thời điểm kiểm tra." count={count('ERROR')} tone="error" selected={filter==='ERROR'} onClick={()=>choose('ERROR')}/>
          <Action label="Chưa xác minh" hint="Chưa có kiểm tra đủ mới để biết VM có kiếm tiền." count={count('UNKNOWN')} tone="warn" selected={filter==='UNKNOWN'} onClick={()=>choose('UNKNOWN')}/>
          {pulse.moneyRead&&<>
            <Action label="Chưa thấy tăng" hint="Các lần đọc hôm nay bằng nhau; chưa kết luận ngừng kiếm tiền." count={count('FLAT')} selected={filter==='FLAT'} onClick={()=>choose('FLAT')}/>
            <Action label="Chưa đủ lần đọc" hint="Cần ít nhất hai lần đọc hợp lệ hôm nay để tính mức tăng." count={count('MONEY_UNKNOWN')} tone="warn" selected={filter==='MONEY_UNKNOWN'} onClick={()=>choose('MONEY_UNKNOWN')}/>
          </>}
        </div>
      </section>
      {filter&&<section id="bp-vm-list" className="bp-panel" aria-labelledby="bp-list-heading">
        <div className="bp-section-head"><h2 id="bp-list-heading">{filters[filter].label} <span className="bp-note">· {number(matched.length)} VM</span></h2><div className="bp-chips">
          {metric('ALL',<>Tất cả {number(rows.length)} VM</>)}<button type="button" className="bp-chip" onClick={()=>setSelected(null)}>Đóng danh sách</button></div></div>
        <p className="bp-note bp-list-note" role="status">{serverId?(servers.find(([id])=>id===serverId)?.[1]??'Server đã chọn'):'Tất cả server được xem'} · Hiển thị {number(Math.min(limit,matched.length))} / {number(matched.length)} VM. Bấm tên VM để mở chi tiết.</p>
        {matched.length===0?<p className="bp-empty">Không có VM trong nhóm này.</p>:<ul className="bp-vm-list" aria-label="Danh sách VM đã lọc">
          {matched.slice(0,limit).map(row=><VmRow key={row.id} row={row} moneyRead={pulse.moneyRead}/>)}
        </ul>}
        {matched.length>limit&&<button type="button" className="pm-button bp-more" onClick={()=>setLimit(n=>n+12)}>Xem thêm {number(Math.min(12,matched.length-limit))} VM</button>}
      </section>}
      <section className="bp-panel" aria-labelledby="bp-servers"><div className="bp-section-head"><h2 id="bp-servers">So sánh server</h2><span className="bp-note">Bấm số để xem đúng nhóm VM.</span></div>
        <ul className="bp-servers">{servers.filter(([id])=>!serverId||id===serverId).map(([id,name])=>{
          const own=pulse.rows.filter(r=>r.serverId===id),amount=pulse.moneyRead?growth(own):null;
          const cell=(key:Filter,value:React.ReactNode,label:string)=><button type="button" className="bp-server-cell" aria-label={`${name} · ${filters[key].label}: ${number(count(key,own))} VM`} aria-controls="bp-vm-list" onClick={()=>choose(key,id)}><span>{label}</span><strong>{value}</strong></button>;
          return <li key={id}><div className="bp-server-name"><button type="button" onClick={()=>choose('ALL',id)}>{name}</button><small>{number(count('PAUSED',own))} tạm dừng · {number(count('NEW',own))} chưa cài</small></div>
            {cell('GOOD',`${number(count('GOOD',own))} / ${number(count('ACTIVE',own))}`,'Kiếm tiền / hoạt động')}
            {cell('ERROR',number(count('ERROR',own)),'Có lỗi')}{cell('UNKNOWN',number(count('UNKNOWN',own)),'Chưa xác minh')}
            {pulse.moneyRead&&cell('COVERED',amount===null?'Chưa đủ dữ liệu':dollars(amount),`Tăng hôm nay · ${number(count('COVERED',own))}/${number(count('ACTIVE',own))} VM`)}
          </li>;
        })}</ul>
      </section>
    </>}
    <section className="bp-panel" aria-labelledby="bp-packages"><div className="bp-section-head"><h2 id="bp-packages">Gói proxy đến hạn</h2><Link href={links.packages()} className="pm-link">Mở gói proxy</Link></div>
      <p className="bp-note bp-list-note">Theo lịch thanh toán đã lưu, gồm gói sắp đến hạn và quá hạn. Không phải kết quả kiểm tra proxy.{serverId?' Danh sách gói theo toàn bộ phạm vi được xem.':''}</p>
      {packages.length===0?<p className="bp-empty">Không có gói cần nhắc thanh toán.</p>:<ul className="bp-packages">{packages.map(p=><li key={p.id}>
        <Link href={p.link} className="bp-package-link"><strong>{p.code}</strong><span className={p.daysLeft<0?'bp-error':'bp-warn'}>{p.daysLeft<0?`Quá hạn ${number(-p.daysLeft)} ngày`:p.daysLeft===0?'Đến hạn hôm nay':`Còn ${number(p.daysLeft)} ngày`}</span></Link>
        <span className="bp-note">Ngày đến hạn: <Time at={p.dueAt} dateOnly/></span>
        <span className="bp-package-cost">{!costsVisible?'Chi phí được ẩn':p.amount==null?'Chưa ghi chi phí':packageCost(p.amount,p.currency)}</span>
      </li>)}</ul>}
    </section>
  </div>;
}

function Action({label,hint,count,tone='neutral',selected,onClick}:{label:string;hint:string;count:number;tone?:string;selected:boolean;onClick:()=>void}){
  return <button type="button" className={'bp-action bp-'+tone} aria-label={`${label}: ${number(count)} VM`} aria-pressed={selected} aria-controls="bp-vm-list" onClick={onClick}>
    <span><strong>{label}</strong><small>{hint}</small></span><b>{number(count)}</b>
  </button>;
}
function VmRow({row:r,moneyRead}:{row:Row;moneyRead:boolean}){
  const stateNote=r.moneyState==='FAILED'?'Lần đọc gần nhất thất bại':r.moneyState==='STALE'?'Số tiền đã cũ, quá 24 giờ':r.moneyState==='NO_TIME'?'Số tiền chưa có thời điểm đọc':r.moneyState==='UNCHECKED'?'Chưa kiểm tra tiền':null;
  return <li className="bp-vm-row">
    <div className="bp-vm-name"><Link href={links.vms({serverId:r.serverId,vm:r.id})}>{r.code}</Link><small>{r.server}</small></div>
    <div className="bp-vm-health"><strong className={'bp-'+healthTone(r)}>{r.problem?PROBLEM_LABEL[r.problem]:HEALTH_LABEL[r.health]}</strong>
      {r.recordedIssue&&<small className="bp-warn">Đã ghi trên web: {r.recordedIssue}</small>}
      <small>Kiểm tra VM: <Time at={r.checkedAt}/></small>{r.health==='UNKNOWN'&&<small>Chưa có bằng chứng kiếm tiền còn hiệu lực.</small>}
    </div>
    {moneyRead&&<div className="bp-vm-money">
      <strong>{r.amount===null?'Chưa kiểm tra tiền':dollars(r.amount)}</strong>{stateNote&&<small className="bp-warn">{stateNote}</small>}
      <small>Đọc tiền: <Time at={r.observedAt}/></small>
      {active(r)&&<small>{r.trend==='INCREASING'&&r.delta!==null?`Tăng ghi nhận hôm nay ${dollars(r.delta)}`:r.trend==='FLAT'?'Chưa thấy tăng giữa các lần đọc hôm nay':r.trend==='DECREASED'?r.decreaseNote:'Chưa đủ dữ liệu tính tăng hôm nay'}</small>}
      {r.threshold==='ENOUGH'&&<small>Đủ mức $10; chưa xác nhận rút được.</small>}{r.threshold==='SOON'&&<small>Sắp đủ: từ $8 đến dưới $10.</small>}
      {r.steps.length>0&&<small className="bp-warn">{r.steps.join(' · ')}</small>}
    </div>}
  </li>;
}
