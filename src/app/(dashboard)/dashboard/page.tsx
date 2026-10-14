"use client";
import LegacyPage from './LegacyPage';
import {ManagedPage} from '@/components/vm-management/ManagedPage';
import {BusinessOverview} from '@/components/business-management/BusinessOverview';
export default function DashboardPage(){return <ManagedPage legacy={<LegacyPage/>}>{projectId=><BusinessOverview projectId={projectId}/>}</ManagedPage>;}
