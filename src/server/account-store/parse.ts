// Pure parsing for the account inventory paste boxes. One line = one account; every line is kept with its own result
// (nothing is dropped silently). Secrets are parsed here but never echoed back: callers only see "có / không có".
export const MAX_LINES=1000;
const EMAIL=/^[^\s@|:\t]+@[^\s@|:\t]+\.[^\s@|:\t]+$/;
export const isEmail=(s:string)=>EMAIL.test(s)&&s.length<=320;
export interface LoginLine {line:number;email:string;password:string|null;twoFa:string|null;recovery:string|null;notes:string|null;error:string|null}
export interface PaypalLine {line:number;code:string;email:string;error:string|null}
export interface LinkLine {line:number;server:string;vm:string;login:string|undefined;paypal:string|undefined;error:string|null}
const LOGIN_HEADER=/^(email|gmail|apple ?id|tài khoản|tai khoan|account|login)$/i,PP_HEADER=/^(mã pp|ma pp|mã|code|pp|paypal)$/i,LINK_HEADER=/^(server|máy chủ)$/i;
const lines=(text:string)=>text.replace(/\r/g,'').split('\n').map((raw,i)=>({raw,line:i+1})).filter(l=>l.raw.trim());
// Cells split on tab, else "|", else ":" (vendor lists "email:pass:recovery"). A password containing ":" needs tab or "|".
function cells(raw:string,colon:boolean){return (raw.includes('\t')?raw.split('\t'):raw.includes('|')?raw.split('|'):colon?raw.split(':'):raw.trim().split(/\s+/)).map(c=>c.trim());}
export function parseLoginLines(text:string):LoginLine[]{
  const out:LoginLine[]=[];
  for(const {raw,line} of lines(text)){
    const c=cells(raw,true);if(out.length===0&&LOGIN_HEADER.test(c[0]||''))continue;
    const email=(c[0]||'').toLowerCase(),v=(i:number)=>c[i]?c[i]:null;
    const error=!isEmail(email)?'Tài khoản đăng nhập phải là email hợp lệ':c.length>5?'Quá nhiều cột; dùng Tài khoản | Mật khẩu | 2FA | Email khôi phục | Ghi chú (ghi chú có dấu | thì dùng tab)':c.slice(1,4).some(s=>s.length>2000)||(c[4]||'').length>1000?'Ô quá dài':c[3]&&!isEmail(c[3].toLowerCase())?'Email khôi phục không hợp lệ':null;
    out.push({line,email,password:v(1),twoFa:v(2),recovery:c[3]?c[3].toLowerCase():null,notes:v(4),error});
  }
  return out;
}
export function parsePaypalLines(text:string):PaypalLine[]{
  const out:PaypalLine[]=[];
  for(const {raw,line} of lines(text)){
    const c=cells(raw,false);if(out.length===0&&PP_HEADER.test(c[0]||''))continue;
    const code=c[0]||'',email=(c[1]||'').toLowerCase();
    const error=c.length!==2?'Mỗi dòng: Mã PP | Email nhận tiền':!code||code.length>80||/\s/.test(code)?'Mã PP không hợp lệ (không khoảng trắng, tối đa 80 ký tự)':!isEmail(email)?'Email nhận tiền không hợp lệ':null;
    out.push({line,code,email,error});
  }
  return out;
}
// Server | VM | Tài khoản | Mã PP. Empty cell = keep, "-" = remove. Matched later by server + VM code, never by line order.
export const CLEAR='-';
export function parseLinkLines(text:string):LinkLine[]{
  const out:LinkLine[]=[];
  for(const {raw,line} of lines(text)){
    const c=raw.includes('\t')?raw.split('\t').map(s=>s.trim()):raw.includes('|')?raw.split('|').map(s=>s.trim()):raw.trim().split(/\s+/);
    if(out.length===0&&LINK_HEADER.test(c[0]||''))continue;
    const login=c[2]?c[2].toLowerCase():undefined,paypal=c[3]||undefined;
    const error=c.length<3||c.length>4?'Mỗi dòng: Server | VM | Tài khoản | Mã PP':!c[0]||!c[1]?'Thiếu server hoặc VM':login===undefined&&paypal===undefined?'Dòng không có tài khoản hay mã PP':login&&login!==CLEAR&&!isEmail(login)?'Tài khoản phải là email (hoặc - để bỏ gán)':null;
    out.push({line,server:c[0]||'',vm:c[1]||'',login,paypal,error});
  }
  return out;
}
// Lines that repeat the same key: every line involved is reported, never "last line wins".
export function repeats<T>(rows:T[],key:(r:T)=>string|null,line:(r:T)=>number){
  const map=new Map<string,number[]>();for(const r of rows){const k=key(r);if(k)map.set(k,[...(map.get(k)||[]),line(r)]);}
  return (r:T)=>{const k=key(r),n=k?map.get(k)!:[];return n.length>1?n.filter(x=>x!==line(r)):null;};
}
