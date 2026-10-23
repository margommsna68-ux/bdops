import {afterAll,describe,expect,it} from 'vitest';
import {db,setup} from '../ops-api/ops-fixture';
import {totpCodeFor,verifyTotpCode,beginTotpSetup,confirmTotpSetup,checkTotp,unlockWebSessionTotp,securityStatus,adminResetTotp,adminRequireTotp,TOTP_LOCK_MS} from '@/server/users/totp';
import {checkWebSession,openWebSession} from '@/server/users/access';
import {maskSdk} from '@/lib/sdk-mask';
afterAll(()=>db.$disconnect());
// 2FA (TOTP) replaces the fixed PIN (owner decision 23/10/2026). Synthetic users on the test database only.
describe('TOTP codes (RFC 6238, SHA-1, 6 digits, 30 s)',()=>{
  it('matches the RFC test vector and accepts ±1 step only',()=>{
    // RFC 6238 appendix B (SHA-1), seed "12345678901234567890" = base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ.
    const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(totpCodeFor(secret,59_000)).toBe('287082');
    expect(totpCodeFor(secret,1111111109_000)).toBe('081804');
    const now=1111111109_000,step=Math.floor(now/30000);
    expect(verifyTotpCode(secret,'081804',now)).toBe(step);
    expect(verifyTotpCode(secret,totpCodeFor(secret,now-30000),now)).toBe(step-1);
    expect(verifyTotpCode(secret,totpCodeFor(secret,now+30000),now)).toBe(step+1);
    expect(verifyTotpCode(secret,totpCodeFor(secret,now-60000),now)).toBeNull();
    expect(verifyTotpCode(secret,'000000',now)).toBeNull();
    expect(verifyTotpCode(secret,'08180',now)).toBeNull();
  });
  it('masks SDK codes to the first 4 and last 4 characters',()=>{
    expect(maskSdk('sdk-win-abcdef1234567890')).toBe('sdk-…7890');
    expect(maskSdk('short')).toBe('…');
  });
});
describe('setup, verify, lock, backup codes and session unlock',()=>{
  it('a user sets up 2FA with the code of the scanned secret; the PIN is retired; backup codes work once; replay of a step is refused',async()=>{
    const f=await setup();try{
      const s=await openWebSession(db,f.ai);
      const begin=await beginTotpSetup(db,f.ai,{label:'ops-user'});
      expect(begin.otpauthUrl).toMatch(/^otpauth:\/\/totp\/MoneyToHome:ops-user\?/);
      expect(begin.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      expect((await securityStatus(db,f.ai,s.id)).totpEnabled).toBe(false);
      await expect(confirmTotpSetup(db,f.ai,'000000',s.id)).rejects.toThrow(/Mã chưa đúng/);
      const now=Date.now(),code=totpCodeFor(begin.secret,now);
      const done=await confirmTotpSetup(db,f.ai,code,s.id);
      expect(done.backupCodes).toHaveLength(8);
      const u=await db.user.findUniqueOrThrow({where:{id:f.ai}});
      expect(u.totpEnabledAt).not.toBeNull();expect(u.pin).toBeNull();expect(u.totpVersion).toBe(1);
      // Confirming unlocked this session (TOTP, not PIN) and the web check reports it.
      const st=await securityStatus(db,f.ai,s.id);expect(st).toMatchObject({totpEnabled:true,unlocked:true,hasPin:false});
      const check=await checkWebSession(db,s.id,f.ai);expect(check.ok&&check.pinUnlocked).toBe(true);
      // The same code (same step) is never accepted twice.
      expect((await checkTotp(db,f.ai,code,now)).result).toBe('INVALID');
      // A later step works and unlocks a fresh session with the current version.
      const s2=await openWebSession(db,f.ai),later=now+60000,c2=totpCodeFor(begin.secret,later);
      const r2=await checkTotp(db,f.ai,c2,later);expect(r2).toMatchObject({result:'OK',via:'TOTP',totpVersion:1});
      expect(await unlockWebSessionTotp(db,s2.id,f.ai,r2.totpVersion)).toBe(true);
      // Backup code: once.
      const b=done.backupCodes[0];
      expect((await checkTotp(db,f.ai,b,later+1000)).result).toBe('OK');
      expect((await checkTotp(db,f.ai,b,later+2000)).result).toBe('INVALID');
      // 3 wrong codes lock for 30 minutes, whatever channel (the reused backup code above was the first wrong one).
      expect((await checkTotp(db,f.ai,'111111',later+3000)).result).toBe('INVALID');
      const third=await checkTotp(db,f.ai,'111111',later+5000);expect(third.result).toBe('LOCKED_NOW');
      expect((await checkTotp(db,f.ai,totpCodeFor(begin.secret,later+90000),later+90000)).result).toBe('LOCKED');
      expect(TOTP_LOCK_MS).toBe(30*60000);
      // ADMIN reset: version moves, secret gone, older unlock ends, setup required again.
      await adminResetTotp(db,f.scope.userId,f.ai,f.projectId);
      const after=await checkWebSession(db,s2.id,f.ai);expect(after.ok&&after.pinUnlocked).toBe(false);
      expect((await securityStatus(db,f.ai,s2.id)).totpEnabled).toBe(false);
      await adminRequireTotp(db,f.scope.userId,f.ai,f.projectId,true);
      expect((await securityStatus(db,f.ai,s2.id)).totpRequired).toBe(true);
      await db.userSession.deleteMany({where:{userId:f.ai}});await db.userBackupCode.deleteMany({where:{userId:f.ai}});
    }finally{await f.cleanup();}
  });
});
