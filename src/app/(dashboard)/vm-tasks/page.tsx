"use client";
import {Suspense} from 'react';
import LegacyPage from './LegacyPage';
import {ManagedPage} from '@/components/vm-management/ManagedPage';
import {InstallWorkspace} from '@/components/vm-management/InstallWorkspace';
import {HiddenModule} from '@/components/layout/HiddenModule';
import {moduleOn} from '@/lib/features';
// Proxy / VM projects: install work is done at the VM while this page is hidden (src/lib/features.ts); older projects keep theirs.
export default function TasksPage(){return <ManagedPage legacy={<LegacyPage/>}>{projectId=><Suspense fallback={<p>Đang mở việc cài…</p>}>{moduleOn('INSTALL_TASKS')?<InstallWorkspace projectId={projectId}/>:<HiddenModule module="INSTALL_TASKS"/>}</Suspense>}</ManagedPage>;}
