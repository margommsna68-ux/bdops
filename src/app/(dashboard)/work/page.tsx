"use client";
import {Suspense} from 'react';
import {ManagedPage} from '@/components/vm-management/ManagedPage';
import {WorkWorkspace} from '@/components/business-management/WorkWorkspace';
export default function WorkPage(){return <ManagedPage legacy={<p>Công việc hợp nhất dùng trong dự án Business Proxy / VM.</p>}>{projectId=><Suspense fallback={<p>Đang mở công việc…</p>}><WorkWorkspace projectId={projectId}/></Suspense>}</ManagedPage>;}
