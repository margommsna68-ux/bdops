"use client";
import LegacyPage from './LegacyPage';
import {ManagedPage} from '@/components/vm-management/ManagedPage';
import {ProfitWorkspace} from '@/components/business-management/ProfitWorkspace';
export default function ProfitPage(){return <ManagedPage legacy={<LegacyPage/>}>{projectId=><ProfitWorkspace projectId={projectId}/>}</ManagedPage>;}
