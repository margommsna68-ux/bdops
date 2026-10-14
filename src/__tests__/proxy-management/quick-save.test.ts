import {expect,it,vi} from 'vitest';
import {submitCheckedBatch} from '@/components/proxy-management/quick-save';
import type {BatchPreview,BatchInput} from '@/server/proxy-management/types';
const input:BatchInput={kind:'NEW',text:'192.0.2.1:80:u:p',idempotencyKey:'fixed-retry-key'};
const clean:BatchPreview={kind:'NEW',token:'opaque-token',ready:1,skipped:0,errors:0,expiresAt:'2099-01-01',rows:[{row:1,outcome:'READY',message:'OK',sourceRefs:[],packageCode:'known'}]};
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
