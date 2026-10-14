"use client";
import {useParams} from 'next/navigation';
import LegacyPage from './LegacyPage';
import {ManagedPage} from '@/components/vm-management/ManagedPage';
import {ServerWorkspace} from '@/components/vm-management/ServerWorkspace';
export default function ServerPage(){const params=useParams<{id:string}>();return <ManagedPage legacy={<LegacyPage/>}>{projectId=><ServerWorkspace key={params.id} projectId={projectId} serverId={params.id}/>}</ManagedPage>;}
