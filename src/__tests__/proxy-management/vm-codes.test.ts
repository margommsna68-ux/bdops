import {expect,it} from 'vitest';
import {displayNote,expandVmRange,splitVmCodes,suggestNextVmCode,VmCodeError} from '@/server/vm-management/vm-codes';
it('suggests the next code only when every code follows one clear pattern',()=>{
  expect(suggestNextVmCode(['VM_001','VM_002','VM_078'])).toBe('VM_079');
  expect(suggestNextVmCode(['M-001','M-030'])).toBe('M-031');
  expect(suggestNextVmCode([])).toBeNull();
  expect(suggestNextVmCode(['VM_001','M-002'])).toBeNull(); // mixed prefixes
  expect(suggestNextVmCode(['VM_001','VM_02'])).toBeNull(); // mixed widths
  expect(suggestNextVmCode(['VM_001','main'])).toBeNull();
});
it('splits a pasted list and keeps ranges strict',()=>{
  expect(splitVmCodes('VM_001, VM_005\nM-012;VM_001')).toEqual(['VM_001','VM_005','M-012']);
  expect(expandVmRange('VM_078','VM_080')).toEqual(['VM_078','VM_079','VM_080']);
  expect(()=>expandVmRange('VM_080','VM_078')).toThrow(VmCodeError);
});
it('hides import system notes and translates review codes, keeping real notes',()=>{
  expect(displayNote('Recorded on Sheet; actual installation not yet confirmed')).toBeNull();
  expect(displayNote('Imported from personal Sheet; actual host credentials and operations are not imported')).toBeNull();
  expect(displayNote('VM_UNRESOLVED')).toMatch(/chưa đọc được/);expect(displayNote('Proxiware — proxy gói khác')).toBe('Proxiware — proxy gói khác');expect(displayNote(null)).toBeNull();
});
