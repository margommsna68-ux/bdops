"use client";
import LegacyPage from './LegacyPage';
import {ManagedPage} from '@/components/vm-management/ManagedPage';
import {ServerWorkspace} from '@/components/vm-management/ServerWorkspace';
export default function ServersPage(){return <ManagedPage legacy={<LegacyPage/>}>{projectId=><ServerWorkspace projectId={projectId}/>}</ManagedPage>;}
