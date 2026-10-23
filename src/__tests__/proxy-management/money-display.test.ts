import {describe,it,expect} from 'vitest';
import {displayMoney,parseViNumber} from '@/lib/money-input';
import {normalizeCostMoney} from '@/server/business-management/usdt-money';

describe('readable money without changing recorded precision',()=>{
 it('labels dollars and VND explicitly and caps displayed decimals',()=>{
  expect(displayMoney('32.125','PPUSD')).toBe('$32.13 PayPal');
  expect(displayMoney('32.12','USD')).toBe('$32.12');
  expect(displayMoney('420000','VND')).toBe('420.000 ₫');
  expect(displayMoney('16266.460108','USDT')).toBe('16,266.46 USDT');
  expect(displayMoney('0','PPUSD')).toBe('$0.00 PayPal');
  expect(displayMoney('-1234.567','USD')).toBe('-$1,234.57');
 });
 it('rounds only the display, preserving input and conversion precision',()=>{
  const result=normalizeCostMoney({amount:'408000',currency:'VND',rate:'25940'});
  expect(displayMoney(result.usdt,'USDT')).toBe('15.73 USDT');
  expect(result.usdt).toBe('15.728604');
  expect(parseViNumber('0,424').value).toBe('0.424');
 });
});
