"use client";
import LegacyPage from './LegacyPage';
import {BusinessOverview} from '@/components/business-management/BusinessOverview';
import {FinancePage} from '@/components/business-management/FinancePage';
import {TeamCashOverview} from '@/components/business-management/TeamCashOverview';
export default function DashboardPage(){return <FinancePage legacy={<LegacyPage/>} cash={projectId=><TeamCashOverview projectId={projectId}/>}>{projectId=><BusinessOverview projectId={projectId}/>}</FinancePage>;}
