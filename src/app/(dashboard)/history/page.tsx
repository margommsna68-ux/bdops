"use client";
import LegacyPage from './LegacyPage';
import {OperationHistoryDialog} from '@/components/proxy-management/OperationHistoryDialog';
import {useVMRefresh} from '@/components/vm-management/shared';
import {FinancePage} from '@/components/business-management/FinancePage';
export default function HistoryPage(){const refresh=useVMRefresh();const body=(projectId:string)=><div className="proxy-workspace"><OperationHistoryDialog projectId={projectId} embedded onClose={()=>{}} onChanged={()=>void refresh()}/></div>;return <FinancePage legacy={<LegacyPage/>} cash={body}>{body}</FinancePage>;}
