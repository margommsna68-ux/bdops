import {describe,expect,it} from 'vitest';
import {countAccountPurchaseQuantity} from '@/components/account-store/purchase-quantity';
import {applySuggestedQuantity,editQuantity,resetSuggestedQuantity,emptyPurchase,readPurchase,switchMode} from '@/components/account-store/purchase-money';
describe('input purchase quantity (no database)',()=>{
 it('counts distinct valid login input, ignoring headers, blanks, duplicates and malformed rows',()=>{
  expect(countAccountPurchaseQuantity('Email | Mật khẩu\n\nA@example.invalid|p\na@example.invalid|other\nbad\nb@example.invalid|p\nc@example.invalid|p||bad-recovery','LOGIN')).toBe(2);
 });
 it('validates Apple five-column input and never splits URL colons as account fields',()=>{
  const text='Apple ID|Mật khẩu|2FA|SMS|Phone\na@example.invalid|p|https://example.invalid/code?q=x|https://example.invalid/sms|0123456789\nb@example.invalid|p|not-a-link||0123';
  expect(countAccountPurchaseQuantity(text,'LOGIN','APPLE5')).toBe(1);
 });
 it('counts PP codes case-insensitively, not emails or pasted lines',()=>{
  expect(countAccountPurchaseQuantity('Mã PP Email\nPP-1 a@example.invalid b@example.invalid\npp-1 c@example.invalid\nPP-2|d@example.invalid\nPP-3 invalid\nPP-4\n','PAYPAL')).toBe(2);
 });
 it('zero valid input produces no suggested purchase rather than a default quantity of one',()=>{expect(countAccountPurchaseQuantity('header\ninvalid','LOGIN')).toBe(0);expect(applySuggestedQuantity(emptyPurchase(),0).quantity).toBe('');});
 it('derives quantity before price validation so a typed unit price can preview immediately',()=>{
  const s=applySuggestedQuantity({...emptyPurchase(),mode:'UNIT',unit:'2,5'},48);
  expect(readPurchase(s,'tài khoản')).toMatchObject({errors:{},payload:{priceMode:'UNIT',amount:'2.5',quantity:48},total:'120'});
 });
 it('keeps a manual actual quantity of 50 when the received list changes from 48 to 47',()=>{
  const s=editQuantity(applySuggestedQuantity(emptyPurchase(),48),'50');
  expect(applySuggestedQuantity(s,47)).toMatchObject({quantity:'50',quantityMode:'MANUAL'});
  expect(resetSuggestedQuantity(s,47)).toMatchObject({quantity:'47',quantityMode:'AUTO'});
 });
 it('manual clear stays manual; restoring legacy nonempty drafts does not overwrite actual quantity',()=>{
  expect(applySuggestedQuantity(editQuantity(emptyPurchase(),''),12).quantity).toBe('');
  const {quantityMode:_old,...old}=emptyPurchase();expect(applySuggestedQuantity({...old,quantity:'50'},48).quantity).toBe('50');
 });
 it('restores automatic/manual intent from a serialized draft and handles list removal',()=>{
  const auto=JSON.parse(JSON.stringify(applySuggestedQuantity(emptyPurchase(),3)));
  expect(applySuggestedQuantity(auto,4).quantity).toBe('4');expect(applySuggestedQuantity(auto,0).quantity).toBe('');
  const manual=JSON.parse(JSON.stringify(editQuantity(auto,'50')));expect(applySuggestedQuantity(manual,4).quantity).toBe('50');
 });
 it('freezes quantity for uncertain or partial saves',()=>{
  const s=applySuggestedQuantity({...emptyPurchase(),mode:'UNIT',unit:'2'},48);
  expect(applySuggestedQuantity(s,2,{locked:true})).toBe(s);
  expect(resetSuggestedQuantity(editQuantity(s,'50'),2,{locked:true}).quantity).toBe('50');
 });
 it('never replaces a total actually paid when the list quantity changes',()=>{
  const s=applySuggestedQuantity({...emptyPurchase(),total:'120'},48),changed=applySuggestedQuantity(s,47);
  expect(readPurchase(changed,'tài khoản')).toMatchObject({total:'120',payload:{amount:'120',quantity:47}});
  expect(switchMode(changed,'TOTAL').total).toBe('120');expect(editQuantity(changed,'50').total).toBe('120');
 });
 it('optional suggestion leaves existing batch-cost callers untouched',()=>{const s={...emptyPurchase(),quantity:'6'};expect(applySuggestedQuantity(s,undefined)).toBe(s);});
});
