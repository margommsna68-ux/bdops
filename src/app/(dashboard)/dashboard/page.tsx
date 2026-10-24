"use client";
import {Suspense,useEffect} from 'react';
import {useRouter} from 'next/navigation';
import LegacyPage from './LegacyPage';
import {useProjectStore} from '@/lib/store';
import {trpc} from '@/lib/trpc';
import {Overview} from '@/components/dashboard/Overview';
// Proxy / VM projects and projects with team cash get the new Tổng quan; older projects keep their dashboard.
export default function DashboardPage(){
  const router=useRouter();
  const projectId=useProjectStore(s=>s.currentProjectId),access=trpc.project.myMembership.useQuery({projectId:projectId||''},{enabled:!!projectId});
  useEffect(()=>{if(access.data?.serverScope==='SELECTED')router.replace('/infrastructure/servers');},[access.data?.serverScope,router]);
  if(access.data?.serverScope==='SELECTED')return <p className="text-sm text-gray-500">Đang mở server được giao…</p>;
  if(!projectId)return <LegacyPage/>;
  if(access.isLoading)return <p className="text-sm text-gray-500">Đang mở tổng quan…</p>;
  if(access.error)return <div role="alert" className="text-sm text-red-600 space-y-2"><p>{access.error.message}</p><button className="underline" onClick={()=>void access.refetch()}>Thử lại</button></div>;
  if(access.data?.businessMode!=='PROXY_VM'&&!access.data?.teamCashEnabled)return <LegacyPage/>;
  return <Suspense fallback={<p className="text-sm text-gray-500">Đang mở tổng quan…</p>}><Overview key={projectId} projectId={projectId}/></Suspense>;
}
