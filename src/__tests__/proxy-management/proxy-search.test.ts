import {expect,it} from 'vitest';
import {normalizeProxySearch,proxySearchEndpoint} from '@/lib/proxy-search';
import {readRegistryUrl,writeRegistryUrl} from '@/components/proxy-management/registry-url';
it('drops pasted credentials before URL state and request filters, retaining exact endpoint identity',()=>{
 const raw='198.51.100.30:11000:sample-user:sample-password';
 expect(normalizeProxySearch(raw)).toBe('198.51.100.30:11000');
 expect(proxySearchEndpoint(raw)).toEqual({ip:'198.51.100.30',port:11000});
 const state=readRegistryUrl(new URLSearchParams({q:raw,state:'NEW'}));
 expect(state.q).toBe('198.51.100.30:11000');
 expect(writeRegistryUrl({...state,q:raw})).not.toMatch(/sample-user|sample-password/);
 expect(normalizeProxySearch('moon05/VM_078')).toBe('moon05/VM_078');
});
