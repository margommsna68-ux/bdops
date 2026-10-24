/** Login health only; assignment, prior use and EarnApp lifecycle remain separate facts. */
export type LoginIssueStatus='APPLE_LOCKED'|'GOOGLE_VERIFY'|'GOOGLE_DISABLED';
export const LOGIN_ISSUE_LABEL:Record<LoginIssueStatus,string>={
 APPLE_LOCKED:'Apple Locked',
 GOOGLE_VERIFY:'Google Verify',
 GOOGLE_DISABLED:'Google Disabled',
};
export const LOGIN_STATUS_LABEL={ACTIVE:'Bình thường',SUSPENDED:'Tạm ngưng',NEEDS_RECOVERY:'Cần khôi phục',NEEDS_2FA_UPDATE:'Cần cập nhật 2FA',BLOCKED:'Bị khóa',DISABLED:'Ngừng dùng',...LOGIN_ISSUE_LABEL};
export function isLoginIssueStatus(status:unknown):status is LoginIssueStatus{return typeof status==='string'&&Object.prototype.hasOwnProperty.call(LOGIN_ISSUE_LABEL,status);}
export function validateLoginIssue(type:unknown,status:unknown):boolean{return isLoginIssueStatus(status)&&(status==='APPLE_LOCKED'?type==='APPLE_ID':type==='GMAIL');}
