"use client";
import {Suspense} from 'react';
import LegacyPage from './LegacyPage';
import {ManagedPage} from '@/components/vm-management/ManagedPage';
import {AccountStore} from '@/components/account-store/AccountStore';
// Kho tài khoản (Gmail / Apple ID / PayPal) for Proxy / VM projects; older projects keep their Gmail page.
export default function GmailPage(){return <ManagedPage legacy={<LegacyPage/>}>{projectId=><Suspense fallback={<p className="pm-muted text-sm">Đang mở kho tài khoản…</p>}><AccountStore projectId={projectId} initialTab="login"/></Suspense>}</ManagedPage>;}
