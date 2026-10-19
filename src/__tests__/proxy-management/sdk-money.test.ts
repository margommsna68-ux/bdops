import {describe,expect,it} from 'vitest';
import {parseSdkAmount,formatSdkAmount,canonicalAmount,amountInput} from '@/lib/sdk-money';
describe('SDK accumulated money (USD, recorded by operators)',()=>{
  it('reads Vietnamese and English decimals the same way and keeps the exact value',()=>{
    for(const [text,value] of [['12,40','12.4'],['12.40','12.4'],['1.234,56','1234.56'],['1,234.56','1234.56'],['0','0'],['0,000001','0.000001'],['15 USD','15'],['$7.5','7.5']] as const)expect(parseSdkAmount(text)).toEqual({value});
  });
  it('refuses what is not an amount: empty, negative, letters, too many decimals or separators',()=>{
    for(const text of ['','-1','abc','1,2,3','1.2.3','0,0000001','12,4x'])expect('error' in parseSdkAmount(text)).toBe(true);
  });
  it('not recorded stays different from 0; display keeps at least 2 decimals',()=>{
    expect(formatSdkAmount(null)).toBeNull();expect(formatSdkAmount('0')).toMatch(/^0,00 USD$/);expect(formatSdkAmount('12.4')).toBe('12,40 USD');expect(formatSdkAmount('1234.5')).toMatch(/^1\.234,50 USD$/);
    expect(canonicalAmount('12.400000')).toBe('12.4');expect(canonicalAmount(null)).toBeNull();expect(amountInput('12.4')).toBe('12,40');expect(amountInput(null)).toBe('');
  });
});
import {sdkFormValues} from '@/components/vm-management/vm-grid/sdk-form';
describe('SDK frame fields (bug found in the browser acceptance 19/10/2026)',()=>{
  it('fields the person did not edit show the stored values of the code and are never sent, even when the store loads after typing',()=>{
    const early=sdkFormValues({amount:null,note:null},{});expect(early).toMatchObject({amountText:'',amount:undefined,note:undefined,amountChanged:false,noteChanged:false});
    const loaded=sdkFormValues({amount:'3.5',note:'dự phòng'},{});expect(loaded).toMatchObject({amountText:'3,50',noteText:'dự phòng',amount:undefined,note:undefined});
  });
  it('an edited field is sent; emptying it is an explicit clear; the same value is no change; a bad amount is not sent',()=>{
    expect(sdkFormValues({amount:'3.5',note:'a'},{amount:'4'})).toMatchObject({amount:'4',amountChanged:true,note:undefined});
    expect(sdkFormValues({amount:'3.5',note:'a'},{amount:'',note:''})).toMatchObject({amount:null,note:null});
    expect(sdkFormValues({amount:'3.5',note:'a'},{amount:'3,50',note:'a'})).toMatchObject({amountChanged:false,noteChanged:false});
    expect(sdkFormValues({amount:null,note:null},{amount:'abc'})).toMatchObject({amountChanged:false,amount:undefined,amountError:expect.stringMatching(/không hợp lệ/)});
  });
});
