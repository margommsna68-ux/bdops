"use client";
import LegacyPage from './LegacyPage';
import {ManagedPage} from '@/components/vm-management/ManagedPage';
import {OperationHistoryDialog} from '@/components/proxy-management/OperationHistoryDialog';
import {useVMRefresh} from '@/components/vm-management/shared';
export default function HistoryPage(){const refresh=useVMRefresh();return <ManagedPage legacy={<LegacyPage/>}>{projectId=><div className="proxy-workspace"><OperationHistoryDialog projectId={projectId} embedded onClose={()=>{}} onChanged={()=>void refresh()}/></div>}</ManagedPage>;}
