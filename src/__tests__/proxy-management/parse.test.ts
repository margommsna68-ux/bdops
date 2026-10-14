import {describe, expect, it} from 'vitest';
import {parseProxy, parseProxyList, parseReplacementLists, resolvePair} from '@/server/proxy-management/parse';
describe('proxy input', () => {
  it('normalizes IPv4 and validates port', () => {
    expect(parseProxy('192.000.2.10').ip).toBe('192.0.2.10');
    for (const value of ['999.0.2.1', '192.0.2.256', '192.0.2.1:0:u:p', '192.0.2.1:65536:u:p', '192.0.2.1:80:u:', 'IP: 192.0.2.1']) expect(() => parseProxy(value)).toThrow('INVALID_INPUT');
  });
  it('inherits each pair independently, while full Added overrides', () => {
    const pairs=parseReplacementLists('192.0.2.1:5432:first:one\n192.0.2.2:9000:second:two', '198.51.100.1\n198.51.100.2:8080:provided:pass');
    expect(resolvePair(pairs[0].old,pairs[0].next)).toEqual({ip:'198.51.100.1',port:5432,username:'first',password:'one',format:'FULL'});
    expect(resolvePair(pairs[1].old,pairs[1].next).username).toBe('provided');
    expect(() => resolvePair(parseProxy('192.0.2.1'),parseProxy('198.51.100.1'))).toThrow('INVALID_INPUT');
  });
  it('keeps valid full password markup and trailing backslash', () => {
    for (const password of ['secret\\', 'secret*', 'secret`', 'one:two', 'secret|']) expect(parseProxy('192.0.2.1:5432:u:'+password).password).toBe(password);
  });
  it('accepts provider message pasted into first box, decorated headings and bare presentation slashes', () => {
    const pairs=parseReplacementLists('**Updated. Check please**\\\n**REMOVED IPS**\\\n192.0.2.1\\\n**ADDED IPS**\\\n198.51.100.1\\','');
    expect(pairs[0].old.ip).toBe('192.0.2.1'); expect(pairs[0].next.ip).toBe('198.51.100.1');
    expect(parseReplacementLists('| --- |\n| `192.0.2.1` |','Added IPs\n| 198.51.100.1:80:u:p |')[0].next.port).toBe(80);
  });
  it('does not silently skip malformed middle lines or shifted sections', () => {
    for (const removed of ['192.0.2.1\nnot a proxy','192.0.2.1\nUpdated. Check please','Added IPs\n192.0.2.1','Removed IPs\n192.0.2.1\nRemoved IPs\n192.0.2.2']) expect(()=>parseReplacementLists(removed,'198.51.100.1')).toThrow();
    expect(()=>parseReplacementLists('Removed IPs\n192.0.2.1\nAdded IPs\n198.51.100.1','198.51.100.2')).toThrow();
    expect(()=>parseReplacementLists('192.0.2.1\n192.0.2.2','198.51.100.1')).toThrow('COUNT_MISMATCH');
  });
  it('detects duplicate physical IPs even with changed credentials', () => {
    expect(()=>parseProxyList('192.0.2.1\n192.0.2.1:5432:u:p')).toThrow('DUPLICATE_INPUT');
    expect(()=>parseReplacementLists('192.0.2.1\n192.0.2.2','198.51.100.1\n198.51.100.1:80:other:pass')).toThrow('DUPLICATE_INPUT');
  });
});
