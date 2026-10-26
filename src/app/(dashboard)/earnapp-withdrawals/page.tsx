"use client";
import {Suspense} from 'react';
import {useProjectStore} from '@/lib/store';
import {PayoutReportWorkspace} from '@/components/business-management/PayoutReportWorkspace';
export default function EarnAppWithdrawalsPage(){const projectId=useProjectStore(s=>s.currentProjectId);return projectId?<Suspense fallback={<p>Đang mở lịch sử rút…</p>}><PayoutReportWorkspace key={projectId} projectId={projectId}/></Suspense>:<p>Chọn dự án để xem yêu cầu rút.</p>;}
