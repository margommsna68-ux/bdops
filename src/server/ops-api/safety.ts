// Ops API (21/10/2026): small pure helpers that keep secrets and client-claimed facts out of what the API stores or answers.

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
// Client address: X-Forwarded-For counted from the right, skipping only the trusted proxies in front of the app (Railway edge = 1
// hop by default, OPS_TRUSTED_PROXY_HOPS). Whatever the client wrote further left is never used. No header = no verified address.
export function clientIp(forwardedFor:string|null,hops=Number(process.env.OPS_TRUSTED_PROXY_HOPS||1)){
  if(!forwardedFor)return null;const parts=forwardedFor.split(',').map(x=>x.trim()).filter(Boolean),n=Math.max(1,Math.floor(hops)||1);
  const ip=parts.length>=n?parts[parts.length-n]:null;return ip&&/^[0-9a-fA-F:.]{3,45}$/.test(ip)?ip:null;
}
// Allowed source addresses of a token: exact IPv4 / IPv6 or IPv4 CIDR (a.b.c.d/nn).
export function ipAllowed(ip:string|null,allowed:string[]){
  if(!allowed.length)return true;if(!ip)return false;
  const v4=(x:string)=>{const m=x.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);return m?m.slice(1).reduce((a,o)=>a*256+Number(o),0):null;};
  return allowed.some(rule=>{const [base,bits]=rule.split('/');if(bits===undefined)return base.toLowerCase()===ip.toLowerCase();const a=v4(base),b=v4(ip),n=Number(bits);if(a==null||b==null||!(n>=0&&n<=32))return false;const block=2**(32-n);return Math.floor(a/block)===Math.floor(b/block);});
}
export const validIpRule=(rule:string)=>/^(\d{1,3}(\.\d{1,3}){3})(\/(3[0-2]|[12]?\d))?$/.test(rule)||/^[0-9a-fA-F:]{3,45}$/.test(rule);
