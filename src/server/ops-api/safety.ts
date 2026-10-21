// Ops API (21/10/2026): small pure helpers that keep secrets and client-claimed facts out of what the API stores or answers.
import {isIP} from 'node:net';

// Free text written by people / AI (evidence, error notes, history lines) may carry what must never leave the web: links with codes,
// passwords, 2FA strings, full proxies, tokens. They are masked before they are stored from the API and again before any answer.
const RULES:[RegExp,string][]=[
  [/\bmth_[A-Za-z0-9_-]{8,}/g,'[token]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,'Bearer [token]'],
  [/\bhttps?:\/\/\S+/gi,'[link]'],
  [/\b\d{1,3}(?:\.\d{1,3}){3}:\d{2,5}:[^\s:]+:[^\s]+/g,'[proxy]'],
  [/\b(mật\s*khẩu|mat\s*khau|password|passwd|pass|pwd|mk|2fa|otp|secret|token|pin)\s*[:=]\s*\S+/gi,'$1: [ẩn]'],
  [/\b[A-Z2-7]{16,}\b/g,'[mã]'],
  [/\b[A-Fa-f0-9]{32,}\b/g,'[mã]'],
];
export function redactSecrets(text:string|null|undefined):string|null{
  if(text==null)return null;let out=String(text);for(const [re,to] of RULES)out=out.replace(re,to);return out;
}
// Login emails are masked in answers (the receiving PayPal email is not: a masked address cannot receive money).
export function maskEmail(email:string|null|undefined){if(!email)return null;const [user,domain]=email.split('@');if(!domain)return '***';return (user.length<=2?user[0]||'':user.slice(0,2))+'***@'+domain;}
// Proxy host masked (no credentials ever leave the API): 84.32.137.52 → 84.32.***.52; a name keeps its first label only.
export function maskHost(host:string|null|undefined){if(!host)return null;const m=host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);if(m)return m[1]+'.'+m[2]+'.***.'+m[4];const [first,...rest]=host.split('.');return first.slice(0,3)+'***'+(rest.length?'.'+rest[rest.length-1]:'');}
/** One address in canonical form (IPv4 dotted, IPv6 compressed lower case, IPv4-mapped IPv6 → IPv4), or null when it is not exactly one
 *  IP: ports, brackets, zones (%eth0), lists, leading zeros and out-of-range octets are refused. */
export function normalIp(value:string|null|undefined):string|null{
  if(typeof value!=='string')return null;const v=value.trim();if(!v||v.length>45)return null;
  const kind=isIP(v);
  if(kind===4)return v;
  if(kind!==6||v.includes('%'))return null;
  let h:string;try{h=new URL('http://['+v+']/').hostname.slice(1,-1);}catch{return null;}
  const mapped=h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if(mapped){const a=parseInt(mapped[1],16),b=parseInt(mapped[2],16);return [a>>8,a&255,b>>8,b&255].join('.');}
  return h;
}
// Client address: X-Forwarded-For counted from the right, skipping only the trusted proxies in front of the app (OPS_TRUSTED_PROXY_HOPS).
// Whatever the client wrote further left is never used. No header = no verified address. Only for a proxy known to append its peer
// (OPS_CLIENT_IP_SOURCE=xff, or off Railway); on Railway the edge adds its own hop, see requestIp.
export function clientIp(forwardedFor:string|null,hops=Number(process.env.OPS_TRUSTED_PROXY_HOPS||1)){
  if(!forwardedFor)return null;const parts=forwardedFor.split(',').map(x=>x.trim()).filter(Boolean),n=Math.max(1,Math.floor(hops)||1);
  return parts.length>=n?normalIp(parts[parts.length-n]):null;
}
export type IpSource='railway'|'xff'|'none';
/** Where the client address comes from: OPS_CLIENT_IP_SOURCE when set; else Railway's edge when the platform says the app runs on
 *  Railway (RAILWAY_ENVIRONMENT_ID is set by Railway in the process, never by a request); else X-Forwarded-For (local / tests). */
export function ipSource(env:Record<string,string|undefined>=process.env):IpSource{
  const v=env.OPS_CLIENT_IP_SOURCE;if(v==='railway'||v==='xff'||v==='none')return v;
  return env.RAILWAY_ENVIRONMENT_ID?'railway':'xff';
}
/** The one client address used for token IP limits, rate limits by address, audit and lastUsedIp. Railway (checked on the host
 *  21/10/2026): the edge sets X-Real-IP to the peer it saw and replaces a value sent by the client; X-Forwarded-For carries the
 *  client's own text and then Railway hops, so it is not used there. Missing or malformed = null (an IP-limited token is refused). */
export function requestIp(headers:Headers,env:Record<string,string|undefined>=process.env):{ip:string|null;source:IpSource}{
  const source=ipSource(env);
  if(source==='railway')return {ip:normalIp(headers.get('x-real-ip')),source};
  if(source==='xff')return {ip:clientIp(headers.get('x-forwarded-for'),Number(env.OPS_TRUSTED_PROXY_HOPS||1)),source};
  return {ip:null,source};
}
const v4n=(x:string)=>x.split('.').reduce((a,o)=>a*256+Number(o),0);
/** A token rule: an exact IPv4 / IPv6 address or an IPv4 range a.b.c.d/nn (0–32). Anything else is not a rule. */
function parseRule(rule:string):{kind:'exact';ip:string}|{kind:'v4net';base:number;bits:number}|null{
  const [base,bits,...rest]=String(rule).trim().split('/');if(rest.length)return null;
  if(bits===undefined){const ip=normalIp(base);return ip?{kind:'exact',ip}:null;}
  if(!/^(3[0-2]|[12]?\d)$/.test(bits)||isIP(base)!==4)return null;
  return {kind:'v4net',base:v4n(base),bits:Number(bits)};
}
// Allowed source addresses of a token: exact IPv4 / IPv6 (compared in canonical form) or IPv4 CIDR. No verified address = refused.
export function ipAllowed(ip:string|null,allowed:string[]){
  if(!allowed.length)return true;const a=normalIp(ip);if(!a)return false;
  return allowed.some(r=>{const p=parseRule(r);if(!p)return false;if(p.kind==='exact')return p.ip===a;
    if(isIP(a)!==4)return false;const block=2**(32-p.bits);return Math.floor(p.base/block)===Math.floor(v4n(a)/block);});
}
export const validIpRule=(rule:string)=>parseRule(rule)!==null;
