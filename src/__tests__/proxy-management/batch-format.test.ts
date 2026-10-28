import {describe,expect,it} from 'vitest';
import {amountText,viDate} from '@/components/account-store/batch-format';
// US number format (owner decision 28/10/2026): "." decimal point, "," thousands.
describe('Lịch sử nhập kho display',()=>{
  it('shows ledger amounts in US format without losing significant decimals',()=>{
    expect(amountText('2.120000')).toBe('2.12');expect(amountText('125000.00000000')).toBe('125,000');expect(amountText('1250000.5')).toBe('1,250,000.5');
    expect(amountText('0.000001')).toBe('0.000001');expect(amountText('12345678901234.123456')).toBe('12,345,678,901,234.123456');expect(amountText('-30.5')).toBe('-30.5');
    expect(amountText('5')).toBe('5');expect(amountText(null)).toBe('');
  });
  it('shows the purchase date as dd/MM/yyyy',()=>{expect(viDate('2026-10-18')).toBe('18/10/2026');expect(viDate('')).toBe('');});
});
describe('ledger money',()=>{
  it('keeps two decimals at least and every recorded decimal',async()=>{
    const {ledgerNumber}=await import('@/components/account-store/batch-format');
    expect(ledgerNumber('46.00')).toBe('46.00');expect(ledgerNumber('1234.5')).toBe('1,234.50');expect(ledgerNumber('-15.00')).toBe('-15.00');expect(ledgerNumber('0.00')).toBe('0.00');expect(ledgerNumber('9.9')).toBe('9.90');expect(ledgerNumber('3.824019')).toBe('3.824019');
  });
});
