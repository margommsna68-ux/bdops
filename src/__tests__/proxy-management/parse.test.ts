import {describe, expect, it} from 'vitest';
import {parseProxy, parseProxyRows, pairReplacementRows, resolvePair} from '@/server/proxy-management/parse';
const ips=(rows:{proxy:{ip:string}|null}[])=>rows.map(r=>r.proxy?.ip||null);
describe('proxy input', () => {
  it('normalizes IPv4 and validates port', () => {
    expect(parseProxy('192.000.2.10').ip).toBe('192.0.2.10');
    for (const value of ['999.0.2.1', '192.0.2.256', '192.0.2.1:0:u:p', '192.0.2.1:65536:u:p', '192.0.2.1:80:u:', 'IP: 192.0.2.1']) expect(() => parseProxy(value)).toThrow('INVALID_INPUT');
  });
  it('inherits each pair independently, while full Added overrides', () => {
    const pairs=pairReplacementRows('192.0.2.1:5432:first:one\n192.0.2.2:9000:second:two', '198.51.100.1\n198.51.100.2:8080:provided:pass');
    expect(resolvePair(pairs[0].old!.proxy!,pairs[0].next!.proxy!)).toEqual({ip:'198.51.100.1',port:5432,username:'first',password:'one',format:'FULL'});
    expect(resolvePair(pairs[1].old!.proxy!,pairs[1].next!.proxy!).username).toBe('provided');
    expect(() => resolvePair(parseProxy('192.0.2.1'),parseProxy('198.51.100.1'))).toThrow('INVALID_INPUT');
  });
  it('keeps valid full password markup and trailing backslash', () => {
    for (const password of ['secret\\', 'secret*', 'secret`', 'one:two', 'secret|']) expect(parseProxy('192.0.2.1:5432:u:'+password).password).toBe(password);
  });
  it('accepts provider message pasted into first box, decorated headings and bare presentation slashes', () => {
    const pairs=pairReplacementRows('**Updated. Check please**\\\n**REMOVED IPS**\\\n192.0.2.1\\\n**ADDED IPS**\\\n198.51.100.1\\','');
    expect(pairs[0].old!.proxy!.ip).toBe('192.0.2.1'); expect(pairs[0].next!.proxy!.ip).toBe('198.51.100.1');
    expect(pairReplacementRows('| --- |\n| `192.0.2.1` |','Added IPs\n| 198.51.100.1:80:u:p |')[0].next!.proxy!.port).toBe(80);
  });
  it('flags malformed lines per row instead of dropping them, and keeps structural errors fatal', () => {
    const rows=parseProxyRows('192.0.2.1:80:u:p\nnot a proxy\n192.0.2.3:80:u:p');
    expect(ips(rows)).toEqual(['192.0.2.1',null,'192.0.2.3']);expect(rows[1]).toMatchObject({row:2,raw:'not a proxy',issue:{code:'INVALID_INPUT'}});
    expect(pairReplacementRows('192.0.2.1\nUpdated. Check please','198.51.100.1\n198.51.100.2')[1].old).toMatchObject({issue:{code:'INVALID_INPUT'}});
    for (const removed of ['Added IPs\n192.0.2.1','Removed IPs\n192.0.2.1\nRemoved IPs\n192.0.2.2']) expect(()=>pairReplacementRows(removed,'198.51.100.1')).toThrow();
    expect(()=>pairReplacementRows('Removed IPs\n192.0.2.1\nAdded IPs\n198.51.100.1','198.51.100.2')).toThrow();
    expect(()=>parseProxyRows('')).toThrow('INVALID_INPUT');
  });
  it('pairs line N with line N: a blank or malformed line never shifts the following pairs', () => {
    const pairs=pairReplacementRows('192.0.2.1\n192.0.2.2\n192.0.2.3\n','198.51.100.1\n\n198.51.100.3\n\n');
    expect(pairs.map(p=>[p.row,p.old?.proxy?.ip||null,p.next?.proxy?.ip||null])).toEqual([[1,'192.0.2.1','198.51.100.1'],[2,'192.0.2.2',null],[3,'192.0.2.3','198.51.100.3']]);
    expect(pairs[1].next).toBeNull();
    const bad=pairReplacementRows('192.0.2.1\nbroken\n192.0.2.3','198.51.100.1\n198.51.100.2\n198.51.100.3');
    expect(bad[1].old).toMatchObject({issue:{code:'INVALID_INPUT'}});expect(bad[2].old!.proxy!.ip).toBe('192.0.2.3');expect(bad[2].next!.proxy!.ip).toBe('198.51.100.3');
    const short=pairReplacementRows('192.0.2.1\n192.0.2.2','198.51.100.1');
    expect(short).toHaveLength(2);expect(short[1].next).toBeNull();
    expect(pairReplacementRows('192.0.2.1\n\n192.0.2.2','198.51.100.1\n\n198.51.100.2').map(p=>p.row)).toEqual([1,3]);
  });
  it('keeps duplicate physical IPs in the rows so the preview can name them', () => {
    const rows=parseProxyRows('192.0.2.1\n192.0.2.1:5432:u:p');
    expect(ips(rows)).toEqual(['192.0.2.1','192.0.2.1']);expect(rows.map(r=>r.issue)).toEqual([undefined,undefined]);
    expect(ips(pairReplacementRows('192.0.2.1\n192.0.2.2','198.51.100.1\n198.51.100.1:80:other:pass').map(p=>p.next!))).toEqual(['198.51.100.1','198.51.100.1']);
  });
});
