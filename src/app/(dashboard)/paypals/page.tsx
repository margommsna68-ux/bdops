"use client";
import {Suspense} from 'react';
import LegacyPage from './LegacyPage';
import {ManagedPage} from '@/components/vm-management/ManagedPage';
import {AccountStore} from '@/components/account-store/AccountStore';
// PayPal stock is the PayPal group of Kho tài khoản (same PayPal records, no second store).
export default function PayPalPage(){return <ManagedPage legacy={<LegacyPage/>}>{projectId=><Suspense fallback={<p className="pm-muted text-sm">Đang mở kho tài khoản…</p>}><AccountStore projectId={projectId} initialTab="paypal"/></Suspense>}</ManagedPage>;}
