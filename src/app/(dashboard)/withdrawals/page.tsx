"use client";
import {Suspense} from 'react';
import LegacyPage from './LegacyPage';
import {FinanceWorkspace} from '@/components/business-management/FinanceWorkspace';
import {FinancePage} from '@/components/business-management/FinancePage';
import {TeamReceiptWorkspace} from '@/components/business-management/TeamReceiptWorkspace';
export default function WithdrawalPage(){return <FinancePage legacy={<LegacyPage/>} cash={projectId=><Suspense fallback={<p>Đang tải nhận team…</p>}><TeamReceiptWorkspace projectId={projectId}/></Suspense>}>{projectId=><Suspense fallback={<p>Đang tải thu/chi…</p>}><FinanceWorkspace projectId={projectId} kind="WITHDRAWAL"/></Suspense>}</FinancePage>;}
