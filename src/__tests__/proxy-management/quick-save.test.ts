import {expect,it,vi} from 'vitest';
import {submitCheckedBatch,previewSummary,rejectedReport} from '@/components/proxy-management/quick-save';
import type {BatchPreview,BatchInput,PreviewRow} from '@/server/proxy-management/types';
const input:BatchInput={kind:'NEW',text:'192.0.2.1:80:u:p',idempotencyKey:'fixed-retry-key'};
const clean:BatchPreview={kind:'NEW',token:'opaque-token',ready:1,skipped:0,errors:0,duplicates:0,expiresAt:'2099-01-01',rows:[{row:1,outcome:'READY',message:'OK',sourceRefs:[],packageCode:'known'}]};
it('one click checks then commits exactly the server token and original key',async()=>{
  const check=vi.fn().mockResolvedValue(clean),commit=vi.fn().mockResolvedValue({applied:1}),review=vi.fn();
  const result=await submitCheckedBatch(input,check,commit,review);expect(commit).toHaveBeenCalledWith({token:'opaque-token',idempotencyKey:'fixed-retry-key'});expect(review).toHaveBeenCalledWith(clean);expect(result.phase).toBe('SAVED');
});
it('errors or unknown package stop at review, with no implicit partial commit',async()=>{
  for(const preview of [{...clean,errors:1},{...clean,rows:[{...clean.rows[0],code:'UNKNOWN_PACKAGE' as const}]}]){const commit=vi.fn();expect((await submitCheckedBatch(input,async()=>preview,commit,()=>{})).phase).toBe('REVIEW');expect(commit).not.toHaveBeenCalled();}
});
it('commit failure leaves preview token available for retry, inspect failure never commits',async()=>{
  const review=vi.fn(),commit=vi.fn().mockRejectedValue(new Error('Connection lost'));await expect(submitCheckedBatch(input,async()=>clean,commit,review)).rejects.toThrow('Connection lost');expect(review).toHaveBeenCalledWith(clean);
  commit.mockClear();await expect(submitCheckedBatch(input,async()=>{throw new Error('Inspect failed');},commit,review)).rejects.toThrow('Inspect failed');expect(commit).not.toHaveBeenCalled();
});
it('summary splits duplicates from other review rows and the rejected report carries IPs and reasons, never credentials',()=>{
  const rows:PreviewRow[]=[
    {row:1,outcome:'READY',message:'Sẵn sàng',sourceRefs:[],newIp:'192.0.2.1'},
    {row:2,outcome:'ERROR',code:'CURRENT_IP',message:'Đã có trong kho (đang dùng) · An-01/VM_001',sourceRefs:[],newIp:'192.0.2.2'},
    {row:3,outcome:'ERROR',code:'DUPLICATE_INPUT',message:'Trùng IP với dòng 2 trong danh sách dán',sourceRefs:[],newIp:'192.0.2.2'},
    {row:4,outcome:'ERROR',code:'INVALID_INPUT',message:'Dòng không phải IP hoặc IP:port:user:pass hợp lệ',sourceRefs:[]},
    {row:5,outcome:'SKIP',message:'Cặp replace đã được ghi nhận',sourceRefs:[],oldIp:'192.0.2.5',newIp:'198.51.100.5'},
    {row:6,outcome:'ERROR',code:'HISTORICAL_IP',message:'Đã replace bằng 198.51.100.9',sourceRefs:[],oldIp:'192.0.2.6',newIp:'198.51.100.6'},
  ];
  expect(previewSummary({...clean,rows,ready:1,skipped:1,errors:4,duplicates:3})).toBe('1 hợp lệ | 3 trùng | 1 cần kiểm tra | 1 giữ nguyên');
  expect(previewSummary({...clean,rows:[rows[0]],ready:1,skipped:0,errors:0,duplicates:0})).toBe('1 hợp lệ | 0 trùng | 0 cần kiểm tra');
  const report=rejectedReport(rows);
  expect(report.split('\n')).toEqual(['Dòng 2\t192.0.2.2\tTrùng\tĐã có trong kho (đang dùng) · An-01/VM_001','Dòng 3\t192.0.2.2\tTrùng\tTrùng IP với dòng 2 trong danh sách dán','Dòng 4\t(không đọc được)\tCần kiểm tra\tDòng không phải IP hoặc IP:port:user:pass hợp lệ','Dòng 6\t192.0.2.6 → 198.51.100.6\tTrùng\tĐã replace bằng 198.51.100.9']);
  expect(report).not.toContain(':80:');
});
