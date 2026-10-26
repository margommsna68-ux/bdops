import {it,expect} from 'vitest';
import {proxyAddressFingerprint} from '@/server/dashboard/monitor';
it('normalizes only the address and ignores legacy credentials, refusing missing/ambiguous identities',()=>{
 const expected='147f2af7c3fb829a1f6614db3bedeacee4a7fbb07819d3634f797942b57650d7';
 expect(proxyAddressFingerprint({host:' 203.0.113.42 ',address:'ignored',port:8080})).toBe(expected);
 for(const address of ['203.0.113.42','203.0.113.42:8080','203.0.113.42:8080:first:secret','203.0.113.42:8080:second:other-secret'])expect(proxyAddressFingerprint({host:null,address,port:8080})).toBe(expected);
 expect(proxyAddressFingerprint({host:' PROXY.EXAMPLE.INVALID ',address:'ignored',port:8080})).toBe(proxyAddressFingerprint({host:'proxy.example.invalid',address:'ignored',port:8080}));
 for(const endpoint of [null,{host:null,address:'203.0.113.42:8081',port:8080},{host:'secret@203.0.113.42',address:'ignored',port:8080},{host:'203.0.113.42',address:'ignored',port:null},{host:'203.0.113.42',address:'ignored',port:65536}])expect(proxyAddressFingerprint(endpoint)).toBeNull();
});
