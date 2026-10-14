"use client";
import {Suspense} from 'react';
import LegacyPage from './LegacyPage';
import {ManagedPage} from '@/components/vm-management/ManagedPage';
import {FinanceWorkspace} from '@/components/business-management/FinanceWorkspace';
export default function CostPage(){return <ManagedPage legacy={<LegacyPage/>}>{projectId=><Suspense fallback={<p>Đang tải thu/chi…</p>}><FinanceWorkspace projectId={projectId} kind="COST"/></Suspense>}</ManagedPage>;}
