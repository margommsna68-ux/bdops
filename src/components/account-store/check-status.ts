export const CHECK_STATE_LABEL={APPLE_LOCKED:'Locked',INVALID_CREDENTIALS:'Sai mật khẩu',CHALLENGE_REQUIRED:'Cần xác minh',PROXY_ERROR:'Lỗi proxy',NETWORK_ERROR:'Lỗi kết nối web',TIMEOUT:'Hết thời gian',UNKNOWN:'Chưa rõ kết quả',CHECKING:'Đang kiểm tra',LIVE_2FA:'Live · yêu cầu 2FA',LOGIN_SUCCESS:'Live đăng nhập',CANCELLED:'Đã huỷ',STALE:'Cần kiểm tra lại',UNCHECKED:'Chưa kiểm tra',NOT_APPLICABLE:'Không áp dụng (Gmail)',UNAVAILABLE:'Chưa tải được trạng thái'} as const;
export type CheckState=keyof typeof CHECK_STATE_LABEL;
export type CheckSummary={accountId:string;createdAt:string;result:string|null;phase:string;cleanup:string|null;stale?:boolean};
export const checkIsActive=(job:Pick<CheckSummary,'result'|'phase'|'cleanup'>)=>job.cleanup==='FAILED'||job.result==='UNKNOWN'&&job.cleanup!=='OK'||job.result===null&&!['DONE','FINISHED','COMPLETED','CANCELLED','UNKNOWN'].includes(job.phase);
export function currentCheck<T extends CheckSummary>(jobs:readonly T[]){const sorted=[...jobs].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return sorted.find(checkIsActive)??sorted[0];}
export function accountCheckState(type:string|null,id:string,jobs:readonly CheckSummary[],ready=true):CheckState{
  if(type!=='APPLE_ID')return 'NOT_APPLICABLE';if(!ready)return 'UNAVAILABLE';
  const latest=currentCheck(jobs.filter(j=>j.accountId===id));if(!latest)return 'UNCHECKED';if(latest.stale)return 'STALE';if(checkIsActive(latest))return 'CHECKING';
  return latest.result&&latest.result in CHECK_STATE_LABEL?latest.result as CheckState:'UNKNOWN';
}
export const CHECK_STATE_ORDER=Object.keys(CHECK_STATE_LABEL) as CheckState[];
