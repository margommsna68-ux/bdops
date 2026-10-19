"use client";
import {Suspense} from 'react';
import LegacyPage from './LegacyPage';
import {ManagedPage} from '@/components/vm-management/ManagedPage';
import {HiddenModule} from '@/components/layout/HiddenModule';
// Proxy / VM projects: there is no install step since 19/10/2026 (assigning a proxy is the record); old links open Server / VM.
// Older (legacy) projects keep their page.
export default function TasksPage(){return <ManagedPage legacy={<LegacyPage/>}>{projectId=><Suspense fallback={<p>Đang mở Server / VM…</p>}>{projectId?<HiddenModule module="INSTALL_TASKS"/>:null}</Suspense>}</ManagedPage>;}
