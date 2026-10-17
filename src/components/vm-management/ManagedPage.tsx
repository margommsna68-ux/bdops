"use client";
import type {ReactNode} from 'react';
import {useProjectStore} from '@/lib/store';
import {trpc} from '@/lib/trpc';
import '@/components/proxy-management/proxy-management.css';
import './vm-grid/vm-grid.css';
export function ManagedPage({legacy,children}:{legacy:ReactNode;children:(projectId:string)=>ReactNode}){
  const projectId=useProjectStore(s=>s.currentProjectId),access=trpc.project.myMembership.useQuery({projectId:projectId||''},{enabled:!!projectId});
  if(!projectId)return <p className="pm-muted text-sm">Chọn dự án để làm việc.</p>;
  if(access.isLoading)return <p className="pm-muted text-sm">Đang mở dự án…</p>;
  if(access.error)return <p role="alert" className="pm-error">{access.error.message}</p>;
  return access.data?.businessMode==='PROXY_VM'?<div key={projectId}>{children(projectId)}</div>:legacy;
}
