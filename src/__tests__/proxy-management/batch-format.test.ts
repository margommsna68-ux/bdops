import {describe,expect,it} from 'vitest';
import {viAmount,viDate} from '@/components/account-store/batch-format';
describe('Lịch sử nhập kho display',()=>{
  it('shows ledger amounts in Vietnamese format without losing significant decimals',()=>{
    expect(viAmount('2.120000')).toBe('2,12');expect(viAmount('125000.00000000')).toBe('125.000');expect(viAmount('1250000.5')).toBe('1.250.000,5');
    expect(viAmount('0.000001')).toBe('0,000001');expect(viAmount('12345678901234.123456')).toBe('12.345.678.901.234,123456');expect(viAmount('-30.5')).toBe('-30,5');
    expect(viAmount('5')).toBe('5');expect(viAmount(null)).toBe('');
  });
  it('shows the purchase date as dd/MM/yyyy',()=>{expect(viDate('2026-10-18')).toBe('18/10/2026');expect(viDate('')).toBe('');});
});
describe('ledger money',()=>{
  it('keeps two decimals at least and every recorded decimal',async()=>{
    const {viMoney}=await import('@/components/account-store/batch-format');
    expect(viMoney('46.00')).toBe('46,00');expect(viMoney('1234.5')).toBe('1.234,50');expect(viMoney('-15.00')).toBe('-15,00');expect(viMoney('0.00')).toBe('0,00');expect(viMoney('9.9')).toBe('9,90');expect(viMoney('3.824019')).toBe('3,824019');
  });
});
