import {expect,it} from 'vitest';
import {parseSdkPaste,normalizeSdk} from '@/server/vm-management/sdk-parse';
it('normalizes SDK codes and rejects malformed values',()=>{
  expect(normalizeSdk('  abc-def-0123456789 ')).toBe('abc-def-0123456789');
  expect(normalizeSdk('short')).toBeNull();
  expect(normalizeSdk('has space here-0123')).toBeNull();
  expect(normalizeSdk('x'.repeat(129))).toBeNull();
  expect(normalizeSdk('')).toBeNull();
});
it('parses VM|SDK pairs with tab, pipe, comma or semicolon and skips a header line',()=>{
  const rows=parseSdkPaste('VM\tSDK\nVM_001\tsdk-aaaa-0001\nVM_002 | sdk-aaaa-0002\nVM_003,sdk-aaaa-0003\nVM_004;sdk-aaaa-0004\n\n');
  expect(rows).toEqual([
    {line:2,server:null,vm:'VM_001',sdk:'sdk-aaaa-0001',issue:null},
    {line:3,server:null,vm:'VM_002',sdk:'sdk-aaaa-0002',issue:null},
    {line:4,server:null,vm:'VM_003',sdk:'sdk-aaaa-0003',issue:null},
    {line:5,server:null,vm:'VM_004',sdk:'sdk-aaaa-0004',issue:null},
  ]);
});
it('parses Server|VM|SDK rows and keeps blank SDK cells as unchanged, never as delete',()=>{
  const rows=parseSdkPaste('vt-01\tVM_001\tsdk-aaaa-0001\nvt-02\tVM_002\t\nvt-03\tVM_003');
  expect(rows[0]).toEqual({line:1,server:'vt-01',vm:'VM_001',sdk:'sdk-aaaa-0001',issue:null});
  expect(rows[1]).toEqual({line:2,server:'vt-02',vm:'VM_002',sdk:null,issue:'BLANK'});
  expect(rows[2]).toEqual({line:3,server:null,vm:'vt-03',sdk:null,issue:'INVALID_SDK'});
});
it('flags malformed SDK values and lines with too many columns without guessing',()=>{
  const rows=parseSdkPaste('VM_001\tbad sdk\nvt-01\tVM_002\tsdk-aaaa-0002\textra');
  expect(rows[0]).toMatchObject({vm:'VM_001',sdk:null,issue:'INVALID_SDK'});
  expect(rows[1]).toMatchObject({issue:'TOO_MANY_COLUMNS'});
});
it('splits a single space separated pair only when exactly two tokens exist',()=>{
  expect(parseSdkPaste('VM_001 sdk-aaaa-0001')[0]).toMatchObject({vm:'VM_001',sdk:'sdk-aaaa-0001',issue:null});
  expect(parseSdkPaste('vt-01 VM_001 sdk-aaaa-0001')[0]).toMatchObject({server:'vt-01',vm:'VM_001',sdk:'sdk-aaaa-0001',issue:null});
});
