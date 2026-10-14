"use client";
import {Suspense} from 'react';
import LegacyPage from './LegacyPage';
import {ManagedPage} from '@/components/vm-management/ManagedPage';
import {InstallWorkspace} from '@/components/vm-management/InstallWorkspace';
export default function TasksPage(){return <ManagedPage legacy={<LegacyPage/>}>{projectId=><Suspense fallback={<p>Đang mở việc cài…</p>}><InstallWorkspace projectId={projectId}/></Suspense>}</ManagedPage>;}
