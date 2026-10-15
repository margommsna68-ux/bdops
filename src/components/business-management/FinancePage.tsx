"use client";
import type {ReactNode} from 'react';
import {useProjectStore} from '@/lib/store';
import {trpc} from '@/lib/trpc';
import {selectFinanceView} from './team-cash-workflow';
import '@/components/proxy-management/proxy-management.css';
export function FinancePage({legacy,children,cash}:{legacy:ReactNode;children:(id:string)=>ReactNode;cash:(id:string)=>ReactNode}){
 const projectId=useProjectStore(s=>s.currentProjectId),access=trpc.project.myMembership.useQuery({projectId:projectId||''},{enabled:!!projectId}),utils=trpc.useUtils();
 const activate=trpc.businessManagement.activateCash.useMutation({onSuccess:()=>{void utils.project.myMembership.invalidate();void utils.businessManagement.invalidate();}});
 if(!projectId)return <p>Chọn dự án để làm việc.</p>;
 if(access.isLoading)return <p>Đang mở thu chi…</p>;
 if(access.error)return <p role="alert" className="pm-error">{access.error.message}</p>;
 const mode=selectFinanceView({businessMode:access.data?.businessMode??null,teamCashEnabled:!!access.data?.teamCashEnabled});
 return <div key={projectId}>{mode!=='TEAM_CASH'&&access.data?.role==='ADMIN'&&<div className="proxy-workspace mb-4 pm-surface p-4 flex flex-wrap gap-3 items-center"><span>Thu chi mới: tính lợi nhuận từ USDT thực nhận về team.</span><button className="pm-button" disabled={activate.isLoading} onClick={()=>activate.mutate({projectId,key:crypto.randomUUID()})}>Bật thu chi USDT</button>{activate.error&&<p role="alert">{activate.error.message}</p>}</div>}{mode==='TEAM_CASH'?cash(projectId):mode==='MANAGED_LEGACY_BASIS'?children(projectId):legacy}</div>;
}
