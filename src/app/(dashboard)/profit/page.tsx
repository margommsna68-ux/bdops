"use client";
import LegacyPage from './LegacyPage';
import {ProfitWorkspace} from '@/components/business-management/ProfitWorkspace';
import {FinancePage} from '@/components/business-management/FinancePage';
import {TeamCashProfitWorkspace} from '@/components/business-management/TeamCashProfitWorkspace';
export default function ProfitPage(){return <FinancePage legacy={<LegacyPage/>} cash={projectId=><TeamCashProfitWorkspace projectId={projectId}/>}>{projectId=><ProfitWorkspace projectId={projectId}/>}</FinancePage>;}
