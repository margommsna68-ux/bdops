import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db,setup} from './ops-fixture';
import {handleOpsRequest} from '@/server/ops-api/api';
import {ipAllowed,ipSource,normalIp,requestIp,validIpRule} from '@/server/ops-api/safety';
import {createOpsToken} from '@/server/ops-api/tokens';
// Client address on Railway (review 21/10/2026): one rule (X-Real-IP set by the edge) for token IP limits, rate limits by address,
// audit and lastUsedIp. Synthetic data, test database only; documentation addresses (RFC 5737 / 3849).
const saved=process.env.OPS_CLIENT_IP_SOURCE;
beforeAll(()=>{process.env.OPS_CLIENT_IP_SOURCE='railway';});
afterAll(async()=>{if(saved===undefined)delete process.env.OPS_CLIENT_IP_SOURCE;else process.env.OPS_CLIENT_IP_SOURCE=saved;await db.$disconnect();});
const call=async(path:string,headers:Record<string,string>)=>{const res=await handleOpsRequest(new Request('http://local.invalid/api/ops/v1/'+path,{headers}),path.split('?')[0],db);return {status:res.status,json:JSON.parse(await res.text())};};

describe('address rules',()=>{
  it('canonical single addresses only; malformed ones are refused',()=>{
    expect(normalIp(' 203.0.113.9 ')).toBe('203.0.113.9');expect(normalIp('2001:0DB8:0:0::1')).toBe('2001:db8::1');expect(normalIp('::ffff:203.0.113.9')).toBe('203.0.113.9');
    for(const bad of ['999.1.1.1','203.0.113','203.0.113.9:443','[2001:db8::1]','fe80::1%eth0','203.0.113.9, 198.51.100.1','01.2.3.4','abc','','2001:db8::g'])expect(normalIp(bad),bad).toBeNull();
  });
  it('source: explicit setting, else Railway when the platform sets RAILWAY_ENVIRONMENT_ID, else X-Forwarded-For; never from the Host',()=>{
    expect(ipSource({OPS_CLIENT_IP_SOURCE:'none',RAILWAY_ENVIRONMENT_ID:'x'})).toBe('none');expect(ipSource({RAILWAY_ENVIRONMENT_ID:'x'})).toBe('railway');expect(ipSource({})).toBe('xff');
    const h=new Headers({'x-real-ip':'203.0.113.9','x-forwarded-for':'198.51.100.1','host':'moneytohome.up.railway.app'});
    expect(requestIp(h,{RAILWAY_ENVIRONMENT_ID:'x'})).toEqual({ip:'203.0.113.9',source:'railway'});
    expect(requestIp(h,{})).toEqual({ip:'198.51.100.1',source:'xff'});expect(requestIp(h,{OPS_CLIENT_IP_SOURCE:'none'})).toEqual({ip:null,source:'none'});
    expect(requestIp(new Headers({'x-forwarded-for':'203.0.113.9'}),{RAILWAY_ENVIRONMENT_ID:'x'}).ip).toBeNull(); // no X-Real-IP on Railway = no address
    expect(requestIp(new Headers({'x-real-ip':'203.0.113.9, 198.51.100.1'}),{RAILWAY_ENVIRONMENT_ID:'x'}).ip).toBeNull();
  });
  it('token rules: exact IPv4 / IPv6 (any textual form) and IPv4 CIDR; malformed rules are invalid and never match',()=>{
    for(const ok of ['203.0.113.9','203.0.113.0/24','0.0.0.0/0','2001:db8::1','2001:0db8::0001'])expect(validIpRule(ok),ok).toBe(true);
    for(const bad of ['999.1.1.1','203.0.113.0/33','203.0.113.0/','2001:db8::/32','203.0.113.9/24/1','x','fe80::1%eth0'])expect(validIpRule(bad),bad).toBe(false);
    expect(ipAllowed('2001:db8::1',['2001:0DB8:0000::1'])).toBe(true);expect(ipAllowed('2001:db8::2',['2001:db8::1'])).toBe(false);
    expect(ipAllowed('203.0.113.200',['203.0.113.0/25'])).toBe(false);expect(ipAllowed('203.0.113.100',['203.0.113.0/25'])).toBe(true);
    expect(ipAllowed('::ffff:203.0.113.9',['203.0.113.9'])).toBe(true);expect(ipAllowed('2001:db8::1',['0.0.0.0/0'])).toBe(false);
    expect(ipAllowed('999.0.0.1',['999.0.0.1'])).toBe(false);expect(ipAllowed(null,['203.0.113.9'])).toBe(false);expect(ipAllowed('203.0.113.9',['bad-rule'])).toBe(false);
  });
});

describe('through the API in Railway mode',()=>{
  it('IP-limited token: right X-Real-IP passes; wrong, missing, malformed or only forged X-Forwarded-For refused; IPv6 and CIDR; audit, lastUsedIp and auth-failure buckets use the same address',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,['READ'],{allowedIps:['203.0.113.9','198.51.100.0/24','2001:db8::7']});
      const me=(h:Record<string,string>)=>call('me',{authorization:'Bearer '+t,...h});
      expect((await me({'x-real-ip':'203.0.113.9','x-forwarded-for':'192.0.2.1'})).json.ok).toBe(true);
      expect((await me({'x-real-ip':'198.51.100.200'})).json.ok).toBe(true);
      expect((await me({'x-real-ip':'2001:0db8:0:0:0:0:0:7'})).json.ok).toBe(true);
      for(const h of <Record<string,string>[]>[{'x-real-ip':'192.0.2.1'},{},{'x-forwarded-for':'203.0.113.9'},{'x-real-ip':'203.0.113.9:80'},{'x-real-ip':'203.0.113.9, 192.0.2.1'},{'x-real-ip':'2001:db8::8'},{'x-real-ip':'garbage'}]){
        const r=await me(h);expect(r.status,JSON.stringify(h)).toBe(403);expect(r.json.error.code).toBe('FORBIDDEN');}
      const row=await db.opsToken.findFirstOrThrow({where:{userId:f.ai}});
      const audits=await db.opsAudit.findMany({where:{tokenId:row.id},orderBy:{at:'asc'}});
      expect(audits.filter(a=>a.httpStatus===403).map(a=>a.ip)).toEqual(['192.0.2.1',null,null,null,null,'2001:db8::8',null]);
      expect(audits.some(a=>a.ip==='203.0.113.9'||a.ip==='198.51.100.200'||a.ip==='2001:db8::7')).toBe(false); // successful reads are not audited
      expect(row.lastUsedIp).toBeTruthy();expect(['203.0.113.9','198.51.100.200','2001:db8::7']).toContain(row.lastUsedIp);
      // Auth failures count against X-Real-IP, never against a forged X-Forwarded-For.
      const real='192.0.2.'+(10+Math.floor(Math.random()*200)),forged='198.18.'+Math.floor(Math.random()*250)+'.1';
      const bad=await call('me',{authorization:'Bearer mth_'+randomUUID().replace(/-/g,'')+'xxxxxxxxxx','x-real-ip':real,'x-forwarded-for':forged});
      expect(bad.status).toBe(401);
      expect(await db.opsRateBucket.findUnique({where:{key:'authFail:'+real}})).not.toBeNull();
      expect(await db.opsRateBucket.findUnique({where:{key:'authFail:'+forged}})).toBeNull();
      // A token without IP limit still works without an address; the limit is never dropped for a token that has one.
      const open=await f.token(f.ai,['READ']);expect((await call('me',{authorization:'Bearer '+open})).json.ok).toBe(true);
    }finally{await f.cleanup();}
  });
  it('a token rule list is validated at creation (malformed / out-of-range refused)',async()=>{
    const f=await setup();try{
      await expect(f.token(f.ai,['READ'],{allowedIps:['999.1.1.1']})).rejects.toMatchObject({code:'INVALID_INPUT'});
      await expect(f.token(f.ai,['READ'],{allowedIps:['203.0.113.0/40']})).rejects.toMatchObject({code:'INVALID_INPUT'});
      expect(typeof createOpsToken).toBe('function');
    }finally{await f.cleanup();}
  });
  it('/health reports the verified address, its source and (diag=net) only the network fields, each a valid IP or INVALID',async()=>{
    const r=await call('health?diag=net',{'x-real-ip':'203.0.113.9','x-forwarded-for':'1.2.3.4, bad, 203.0.113.9','x-railway-request-id':'abcDEF123','authorization':'Bearer mth_secretsecretsecret','cookie':'s=1','x-ops-pin':'123456'});
    expect(r.json.data).toEqual({service:'moneytohome-ops',version:'v1',verifiedIp:'203.0.113.9',ipSource:'railway',network:{xRealIp:'203.0.113.9',forwardedFor:['1.2.3.4','INVALID','203.0.113.9'],railwayRequestId:'abcDEF123',railwayEdge:null}});
    expect(JSON.stringify(r.json)).not.toMatch(/secret|123456|s=1/);
    expect((await call('health',{'x-real-ip':'203.0.113.9'})).json.data).toEqual({service:'moneytohome-ops',version:'v1',verifiedIp:'203.0.113.9',ipSource:'railway'});
  });
});
