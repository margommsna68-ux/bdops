"use client";
import LegacyPage from './LegacyPage';
import {ManagedPage} from '@/components/vm-management/ManagedPage';
import {ProxyDashboard} from '@/components/vm-management/ProxyDashboard';
export default function DashboardPage(){return <ManagedPage legacy={<LegacyPage/>}>{projectId=><ProxyDashboard projectId={projectId}/>}</ManagedPage>;}
