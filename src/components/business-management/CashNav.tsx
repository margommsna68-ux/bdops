"use client";
import {Suspense} from 'react';
import Link from 'next/link';
import {usePathname,useSearchParams} from 'next/navigation';
import {trpc} from '@/lib/trpc';
import {links,readPeriod} from '@/lib/links';
// Team-cash pages. Three different money flows, three different places: USDT received by the team (profit income), money arriving in
// PayPal, and original withdrawals/transfers (reconciliation only). The month in the URL goes along.
export function CashNav({projectId}:{projectId:string}){return <Suspense fallback={<nav aria-label="Thu chi" className="min-h-9"/>}><CashNavLinks projectId={projectId}/></Suspense>;}
function CashNavLinks({projectId}:{projectId:string}){
 const a=trpc.businessManagement.cashAccess.useQuery({projectId}),pathname=usePathname(),params=useSearchParams(),view=params.get('view'),month=params.get('month')?readPeriod(params,'').month||undefined:undefined;
 const item=(href:string,label:string,active:boolean)=><Link key={href} className={'pm-button'+(active?' pm-button-primary':'')} aria-current={active?'page':undefined} href={href}>{label}</Link>;
 return <nav aria-label="Thu chi" className="flex gap-2 flex-wrap">{a.data?.costs&&item(links.costs({month}),'Chi phí',pathname==='/costs')}{a.data?.withdrawals&&item(links.teamReceipts({month}),'Nhận USDT về team',pathname==='/withdrawals'&&view!=='original')}{a.data?.funds&&item(links.paypalIn(),'Tiền vào PayPal',pathname==='/funds')}{a.data?.withdrawals&&item(links.originalWithdrawals(true),'Rút / chuyển gốc',pathname==='/withdrawals'&&view==='original')}{a.data?.profit&&item(links.profit({month}),'Lợi nhuận USDT',pathname==='/profit')}{item(links.history(),'Lịch sử',pathname==='/history')}</nav>;
}
