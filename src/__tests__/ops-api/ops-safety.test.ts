import {describe,expect,it} from 'vitest';
import {clientIp,ipAllowed,maskEmail,maskHost,redactSecrets} from '@/server/ops-api/safety';
// Ops API helpers (21/10/2026): secrets never stored / answered from free text; only the trusted proxy's address counts.
describe('redactSecrets',()=>{
  it('masks links, passwords, 2FA secrets, full proxies and tokens; keeps the plain note',()=>{
    const t=redactSecrets('Đã thấy trong lịch sử rút; password: Abc123! link https://2fa.example.invalid/tok/XYZ?code=1 proxy 84.32.137.52:6000:user1:pa55 token mth_abcdefghijklmnop secret JBSWY3DPEHPK3PXP')!;
    expect(t).toContain('Đã thấy trong lịch sử rút');
    for(const leak of ['Abc123!','2fa.example','code=1','user1','pa55','mth_abcdefgh','JBSWY3DPEHPK3PXP'])expect(t).not.toContain(leak);
    expect(redactSecrets(null)).toBeNull();expect(redactSecrets('Nút Redeem hiện, số dư $12,40')).toBe('Nút Redeem hiện, số dư $12,40');
  });
});
describe('addresses and masks',()=>{
  it('takes the address added by the trusted proxy (rightmost), never what the client wrote further left',()=>{
    expect(clientIp('10.0.0.1, 203.0.113.9',1)).toBe('203.0.113.9');expect(clientIp('203.0.113.9',1)).toBe('203.0.113.9');
    expect(clientIp('1.1.1.1, 203.0.113.9, 100.64.0.2',2)).toBe('203.0.113.9');expect(clientIp(null)).toBeNull();expect(clientIp('not-an-ip')).toBeNull();
  });
  it('allows exact addresses and IPv4 ranges only',()=>{
    expect(ipAllowed('203.0.113.9',[])).toBe(true);expect(ipAllowed(null,['203.0.113.9'])).toBe(false);
    expect(ipAllowed('203.0.113.9',['203.0.113.0/24'])).toBe(true);expect(ipAllowed('203.0.114.9',['203.0.113.0/24'])).toBe(false);expect(ipAllowed('203.0.113.9',['203.0.113.9'])).toBe(true);
  });
  it('masks login emails and proxy hosts',()=>{
    expect(maskEmail('someone@example.invalid')).toBe('so***@example.invalid');expect(maskHost('84.32.137.52')).toBe('84.32.***.52');
  });
});
