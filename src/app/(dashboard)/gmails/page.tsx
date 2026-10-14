"use client";
import LegacyPage from './LegacyPage';
import {ManagedPage} from '@/components/vm-management/ManagedPage';
import {AccountsWorkspace} from '@/components/business-management/AccountsWorkspace';
export default function GmailPage(){return <ManagedPage legacy={<LegacyPage/>}>{projectId=><AccountsWorkspace projectId={projectId} kind="GMAIL"/>}</ManagedPage>;}
