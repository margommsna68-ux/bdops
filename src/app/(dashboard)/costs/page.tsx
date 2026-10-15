"use client";
import {Suspense} from 'react';
import LegacyPage from './LegacyPage';
import {FinanceWorkspace} from '@/components/business-management/FinanceWorkspace';
import {FinancePage} from '@/components/business-management/FinancePage';
import {UsdtCostsWorkspace} from '@/components/business-management/UsdtCostsWorkspace';
export default function CostPage(){return <FinancePage legacy={<LegacyPage/>} cash={projectId=><Suspense fallback={<p>Đang tải chi phí…</p>}><UsdtCostsWorkspace projectId={projectId}/></Suspense>}>{projectId=><Suspense fallback={<p>Đang tải thu/chi…</p>}><FinanceWorkspace projectId={projectId} kind="COST"/></Suspense>}</FinancePage>;}
