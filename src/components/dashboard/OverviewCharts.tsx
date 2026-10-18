"use client";
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {Bar,BarChart,CartesianGrid,LabelList,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {links,type VmView} from '@/lib/links';
import type {Overview} from './Overview';
import type {FinanceTargets} from './finance-links';
type Ops=NonNullable<Overview['operations']>;
type Fin=Extract<NonNullable<Overview['finance']>,{enabled:true}>;
// Colours carry meaning and match the badges on the target pages: installed green, waiting blue, review amber, missing red;
// proxy NEW blue, LIVE green, BLOCKED red, other grey.
export const VM_SERIES=[{key:'INSTALLED',label:'Đã xác nhận cài',color:'#16a34a'},{key:'PENDING',label:'Chờ cài',color:'#3b82f6'},{key:'REVIEW',label:'Cần kiểm tra',color:'#f59e0b'},{key:'MISSING',label:'Thiếu proxy',color:'#ef4444'}] as const;
export const STOCK_SERIES=[{key:'NEW',label:'NEW',color:'#3b82f6'},{key:'LIVE',label:'LIVE',color:'#16a34a'},{key:'BLOCKED',label:'BLOCKED',color:'#ef4444'},{key:'OTHER',label:'Khác',color:'#94a3b8'}] as const;
const fmt=(n:number)=>n.toLocaleString('vi-VN');
// Segment label only where it fits; every number is also in the legend totals and the table under the chart. The label lets clicks
// through (pointer-events: none) so clicking the number opens the same list as clicking the coloured segment under it.
const segmentLabel=(min:number)=>function SegmentLabel(props:{x?:number|string;y?:number|string;width?:number|string;height?:number|string;value?:unknown}){const w=Number(props.width),v=Number(props.value);if(!v||w<min)return null;return <text x={Number(props.x)+w/2} y={Number(props.y)+Number(props.height)/2} dy={4} textAnchor="middle" fontSize={11} fontWeight={600} fill="#fff" pointerEvents="none" style={{pointerEvents:'none'}}>{fmt(v)}</text>;};
const tooltipStyle={contentStyle:{background:'var(--ds-card)',border:'1px solid var(--ds-border)',borderRadius:8,fontSize:12,color:'var(--ds-text-primary)'},labelStyle:{fontWeight:600,color:'var(--ds-text-primary)'},cursor:{fill:'rgba(59,130,246,.06)'}};
function Legend({items,totals,href}:{items:readonly {key:string;label:string;color:string}[];totals:Record<string,number>;href:(key:string)=>string}){
  return <ul className="ov-legend">{items.map(i=><li key={i.key}><Link href={href(i.key)}><span className="ov-dot" style={{background:i.color}}/>{i.label} <strong>{fmt(totals[i.key]??0)}</strong></Link></li>)}</ul>;
}
export function VmByServerChart({ops}:{ops:Ops}){
  const router=useRouter(),rows=ops.servers.map(s=>({...s,name:`${s.code} · ${fmt(s.total)}`})),axis=Math.min(170,Math.max(72,Math.max(0,...rows.map(r=>r.name.length))*7+14));
  if(!rows.length)return <p className="ov-empty">Chưa có server đang vận hành. <Link className="pm-link" href={links.vms()}>Thêm server ở Server / VM</Link></p>;
  const open=(serverId:string,view?:VmView)=>router.push(links.vms({serverId,view}));
  return <div>
    <Legend items={VM_SERIES} totals={ops.totals} href={k=>links.vms({view:k as VmView})}/>
    <div style={{height:Math.max(140,rows.length*30+34)}} role="img" aria-label={`VM theo server: ${rows.map(r=>`${r.code} ${r.total} VM`).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{top:4,right:12,bottom:4,left:4}} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke="var(--ds-border)"/>
          <XAxis type="number" allowDecimals={false} tick={{fontSize:11,fill:'var(--ds-text-secondary)'}} axisLine={false} tickLine={false}/>
          <YAxis type="category" dataKey="name" width={axis} interval={0} tick={{fontSize:12,fill:'var(--ds-text-primary)',cursor:'pointer'}} axisLine={false} tickLine={false} onClick={(t:{value?:string})=>{const s=rows.find(r=>r.name===t?.value);if(s)open(s.id);}}/>
          <Tooltip {...tooltipStyle} formatter={(v,name)=>[fmt(Number(v)),VM_SERIES.find(s=>s.key===name)?.label||String(name)]}/>
          {VM_SERIES.map(s=><Bar key={s.key} dataKey={s.key} stackId="vm" fill={s.color} cursor="pointer" isAnimationActive={false} onClick={(d:{payload?:{id:string}})=>{if(d?.payload)open(d.payload.id,s.key);}}>
            <LabelList dataKey={s.key} content={segmentLabel(22)}/>
          </Bar>)}
        </BarChart>
      </ResponsiveContainer>
    </div>
    <details className="ov-details"><summary>Bảng số theo server</summary><div className="pm-table-scroll"><table className="pm-table ov-table"><thead><tr><th>Server</th>{VM_SERIES.map(s=><th key={s.key}>{s.label}</th>)}<th>Tổng</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><Link className="pm-link" href={links.vms({serverId:r.id})}>{r.code}</Link></td>{VM_SERIES.map(s=><td key={s.key}>{r[s.key]?<Link className="pm-link" href={links.vms({serverId:r.id,view:s.key})}>{fmt(r[s.key])}</Link>:<span className="pm-muted">0</span>}</td>)}<td>{fmt(r.total)}</td></tr>)}</tbody></table></div></details>
  </div>;
}
export function StockChart({ops}:{ops:Ops}){
  const router=useRouter(),rows=ops.stock.rows.map(r=>({...r,name:`${r.label} · ${fmt(r.total)}`})),totals=Object.fromEntries(STOCK_SERIES.map(s=>[s.key,rows.reduce((a,r)=>a+r[s.key],0)]));
  if(!ops.stock.total)return <p className="ov-empty">Chưa có proxy trong kho đang quản lý. <Link className="pm-link" href={links.proxies()}>Mở Kho proxy</Link></p>;
  return <div>
    <Legend items={STOCK_SERIES} totals={totals} href={k=>links.proxies({state:k})}/>
    <div style={{height:rows.length*34+34}} role="img" aria-label={`Kho proxy: ${rows.map(r=>`${r.label} ${r.total}`).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{top:4,right:12,bottom:4,left:4}} barCategoryGap={7}>
          <CartesianGrid horizontal={false} stroke="var(--ds-border)"/>
          <XAxis type="number" allowDecimals={false} tick={{fontSize:11,fill:'var(--ds-text-secondary)'}} axisLine={false} tickLine={false}/>
          <YAxis type="category" dataKey="name" width={200} interval={0} tick={{fontSize:12,fill:'var(--ds-text-primary)',cursor:'pointer'}} axisLine={false} tickLine={false} onClick={(t:{value?:string})=>{const r=rows.find(x=>x.name===t?.value);if(r)router.push(links.proxies({group:r.key}));}}/>
          <Tooltip {...tooltipStyle} formatter={(v,name)=>[fmt(Number(v)),STOCK_SERIES.find(s=>s.key===name)?.label||String(name)]}/>
          {STOCK_SERIES.map(s=><Bar key={s.key} dataKey={s.key} stackId="stock" fill={s.color} cursor="pointer" isAnimationActive={false} onClick={(d:{payload?:{key:string}})=>{if(d?.payload)router.push(links.proxies({group:d.payload.key,state:s.key}));}}>
            <LabelList dataKey={s.key} content={segmentLabel(26)}/>
          </Bar>)}
        </BarChart>
      </ResponsiveContainer>
    </div>
    <details className="ov-details"><summary>Bảng số theo nhóm</summary><div className="pm-table-scroll"><table className="pm-table ov-table"><thead><tr><th>Từ nhóm</th>{STOCK_SERIES.map(s=><th key={s.key}>{s.label}</th>)}<th>Tổng</th></tr></thead><tbody>{rows.map(r=><tr key={r.key}><td><Link className="pm-link" href={links.proxies({group:r.key})}>{r.label}</Link></td>{STOCK_SERIES.map(s=><td key={s.key}>{r[s.key]?<Link className="pm-link" href={links.proxies({group:r.key,state:s.key})}>{fmt(r[s.key])}</Link>:<span className="pm-muted">0</span>}</td>)}<td>{fmt(r.total)}</td></tr>)}</tbody></table></div></details>
  </div>;
}
// A column opens the list of that day (and month) when the member may read it; otherwise it is only a number.
export function CashChart({fin,month,targets}:{fin:Fin;month:string;targets:FinanceTargets}){
  const router=useRouter(),go=(href:string|null)=>{if(href)router.push(href);};
  if(!fin.series.length)return <p className="ov-empty">Chưa có khoản nhận hoặc chi phí trong tháng {month.split('-').reverse().join('/')}.</p>;
  const data=fin.series.map(d=>({day:d.date.slice(8),date:d.date,received:Number(d.received),cost:Number(d.cost)}));
  return <div style={{height:220}} role="img" aria-label={`Thu chi theo ngày tháng ${month}: thực nhận ${fin.received} USDT, chi phí ${fin.cost} USDT`}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{top:8,right:8,bottom:0,left:0}} barGap={1}>
        <CartesianGrid vertical={false} stroke="var(--ds-border)"/>
        <XAxis dataKey="day" tick={{fontSize:10,fill:'var(--ds-text-secondary)'}} interval="preserveStartEnd" axisLine={false} tickLine={false}/>
        <YAxis width={44} tick={{fontSize:10,fill:'var(--ds-text-secondary)'}} axisLine={false} tickLine={false}/>
        <Tooltip {...tooltipStyle} labelFormatter={(_,p)=>{const d=(p?.[0]?.payload as {date?:string}|undefined)?.date;return d?d.split('-').reverse().join('/'):'';}} formatter={(v,name)=>[Number(v).toLocaleString('vi-VN',{maximumFractionDigits:2})+' USDT',name==='received'?'Thực nhận':'Chi phí']}/>
        <Bar dataKey="received" fill="#16a34a" radius={[3,3,0,0]} cursor={targets.received?'pointer':'default'} isAnimationActive={false} onClick={(d:{payload?:{date:string}})=>{if(d?.payload)go(targets.receivedDay(d.payload.date));}}/>
        <Bar dataKey="cost" fill="#ef4444" radius={[3,3,0,0]} cursor={targets.cost?'pointer':'default'} isAnimationActive={false} onClick={(d:{payload?:{date:string}})=>{if(d?.payload)go(targets.costDay(d.payload.date));}}/>
      </BarChart>
    </ResponsiveContainer>
  </div>;
}
