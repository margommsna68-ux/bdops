import {expect,it} from 'vitest';
import {LOGIN_ISSUE_LABEL,LOGIN_STATUS_LABEL,isLoginIssueStatus,validateLoginIssue} from '@/lib/login-issue';
it('recognizes only the three login health issues and requires the explicitly known provider',()=>{
 expect(Object.keys(LOGIN_ISSUE_LABEL)).toEqual(['APPLE_LOCKED','GOOGLE_VERIFY','GOOGLE_DISABLED']);
 for(const s of Object.keys(LOGIN_ISSUE_LABEL)){expect(isLoginIssueStatus(s)).toBe(true);expect(LOGIN_STATUS_LABEL[s as keyof typeof LOGIN_STATUS_LABEL]).toBeTruthy();expect(validateLoginIssue(s==='APPLE_LOCKED'?'APPLE_ID':'GMAIL',s)).toBe(true);expect(validateLoginIssue(s==='APPLE_LOCKED'?'GMAIL':'APPLE_ID',s)).toBe(false);expect(validateLoginIssue(null,s)).toBe(false);}
 for(const s of [null,undefined,'ACTIVE','toString','__proto__','GMAIL','GOOGLE_BAD']){expect(isLoginIssueStatus(s)).toBe(false);expect(validateLoginIssue('GMAIL',s)).toBe(false);}
});
