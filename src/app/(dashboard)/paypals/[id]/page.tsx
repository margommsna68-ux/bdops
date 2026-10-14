"use client";
import {useParams} from 'next/navigation';
import LegacyPage from './LegacyPage';
import {ManagedPage} from '@/components/vm-management/ManagedPage';
import {AccountsWorkspace} from '@/components/business-management/AccountsWorkspace';
export default function PayPalPage(){const {id}=useParams<{id:string}>();return <ManagedPage legacy={<LegacyPage/>}>{projectId=><AccountsWorkspace projectId={projectId} kind="PAYPAL" accountId={id}/>}</ManagedPage>;}
