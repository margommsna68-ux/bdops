// Pure parsing for the account inventory paste boxes. One line = one account; every line is kept with its own result
// (nothing is dropped silently). Secrets are parsed here but never echoed back: callers only see "có / không có".
export const MAX_LINES=1000;
const EMAIL=/^[^\s@|:\t]+@[^\s@|:\t]+\.[^\s@|:\t]+$/;
export const isEmail=(s:string)=>EMAIL.test(s)&&s.length<=320;
export interface LoginLine {line:number;email:string;password:string|null;twoFa:string|null;recovery:string|null;notes:string|null;twoFaLink:string|null;smsLink:string|null;phone:string|null;error:string|null}
/** STANDARD = Tài khoản | Mật khẩu | 2FA | Email khôi phục | Ghi chú (Gmail, and the older Apple ID lists). APPLE5 = Email | Mật khẩu |
 *  Link lấy 2FA | Link SMS | Số điện thoại, the way Apple IDs are bought (owner brief 20/10/2026). */
export type LoginFormat='STANDARD'|'APPLE5';
export const LOGIN_FORMATS:LoginFormat[]=['STANDARD','APPLE5'];
const PHONE=/^\+?[0-9][0-9 .()-]{2,39}$/;
/** A web link kept exactly as typed (case, query, token, percent-encoding); only http(s) is accepted. */
export function webLink(s:string):string|null{if(!/^https?:\/\/\S+$/i.test(s)||s.length>2000)return null;try{new URL(s);return s;}catch{return null;}}
// One PayPal code with one or more receiving emails ("pp-13 a@x b@x c@x"). emails: valid, in order, without repeats on the line.
export interface PaypalLine {line:number;code:string;emails:string[];repeated:string[];error:string|null}
export interface LinkLine {line:number;server:string;vm:string;login:string|undefined;paypalCode:string|undefined;paypalEmail:string|undefined;error:string|null}
const LOGIN_HEADER=/^(email|gmail|apple ?id|tài khoản|tai khoan|account|login)$/i,PP_HEADER=/^(mã pp|ma pp|mã|code|pp|paypal)$/i,LINK_HEADER=/^(server|máy chủ)$/i;
const lines=(text:string)=>text.replace(/\r/g,'').split('\n').map((raw,i)=>({raw,line:i+1})).filter(l=>l.raw.trim());
// Cells split on tab, else "|", else ":" (vendor lists "email:pass:recovery"). A password containing ":" needs tab or "|".
function cells(raw:string,colon:boolean){return (raw.includes('\t')?raw.split('\t'):raw.includes('|')?raw.split('|'):colon?raw.split(':'):raw.trim().split(/\s+/)).map(c=>c.trim());}
export function parseLoginLines(text:string,format:LoginFormat='STANDARD'):LoginLine[]{
  const out:LoginLine[]=[];
  for(const {raw,line} of lines(text)){
    // Apple ID lists never split on ":" (the links hold one) and keep every cell in its place; nothing extra is moved into the note.
    const c=cells(raw,format==='STANDARD');if(out.length===0&&LOGIN_HEADER.test(c[0]||''))continue;
    const email=(c[0]||'').toLowerCase(),v=(i:number)=>c[i]?c[i]:null,none={twoFa:null,recovery:null,notes:null,twoFaLink:null,smsLink:null,phone:null};
    if(format==='APPLE5'){
      const link2=c[2]?webLink(c[2]):null,sms=c[3]?webLink(c[3]):null,phone=c[4]||null;
      const error=!isEmail(email)?'Tài khoản đăng nhập phải là email hợp lệ':c.length>5?'Quá nhiều cột; dùng Email | Mật khẩu | Link lấy 2FA | Link SMS | Số điện thoại':(c[1]||'').length>2000?'Ô quá dài'
        :c[2]&&!link2?'Link lấy 2FA phải là đường dẫn web (http:// hoặc https://)':c[3]&&!sms?'Link SMS phải là đường dẫn web (http:// hoặc https://)':phone&&!PHONE.test(phone)?'Số điện thoại chỉ gồm số, dấu + và khoảng trắng':null;
      out.push({line,email,password:v(1),...none,...(error?{}:{twoFaLink:link2,smsLink:sms,phone}),error});continue;
    }
    const error=!isEmail(email)?'Tài khoản đăng nhập phải là email hợp lệ':c.length>5?'Quá nhiều cột; dùng Tài khoản | Mật khẩu | 2FA | Email khôi phục | Ghi chú (ghi chú có dấu | thì dùng tab)':c.slice(1,4).some(s=>s.length>2000)||(c[4]||'').length>1000?'Ô quá dài':c[3]&&!isEmail(c[3].toLowerCase())?'Email khôi phục không hợp lệ':null;
    out.push({line,email,password:v(1),twoFa:v(2),recovery:c[3]?c[3].toLowerCase():null,notes:v(4),twoFaLink:null,smsLink:null,phone:null,error});
  }
  return out;
}
// PayPal stock: "Mã PP email1 email2 …", separated by spaces, tabs or "|". A code may repeat on several lines; the caller groups
// them into one PayPal. Codes are compared without case. Any invalid email makes the line an error (nothing guessed).
export function parsePaypalLines(text:string):PaypalLine[]{
  const out:PaypalLine[]=[];
  for(const {raw,line} of lines(text)){
    const c=raw.split(/[|\t ]+/).map(x=>x.trim()).filter(Boolean);if(out.length===0&&PP_HEADER.test(c[0]||''))continue;
    const code=c[0]||'',tokens=c.slice(1).map(t=>t.toLowerCase()),bad=tokens.filter(t=>!isEmail(t)),emails:string[]=[],repeated:string[]=[];
    for(const t of tokens)if(isEmail(t)){if(emails.includes(t))repeated.push(t);else emails.push(t);}
    const error=!code||code.length>80||isEmail(code.toLowerCase())?'Dòng bắt đầu bằng Mã PP rồi tới email: Mã PP email1 email2 …':!tokens.length?'Thiếu email nhận tiền cho mã '+code:bad.length?'Email không hợp lệ: '+bad.slice(0,3).join(', '):emails.length>50?'Tối đa 50 email mỗi dòng':null;
    out.push({line,code,emails,repeated,error});
  }
  return out;
}
// Server | VM | Tài khoản | Email PP (or … | Mã PP | Email PP). Empty cell = keep, "-" = remove. A PayPal code alone is refused:
// a PayPal has many emails and the email is what an EarnApp account receives on. Matched later by server + VM code.
export const CLEAR='-';
export function parseLinkLines(text:string):LinkLine[]{
  const out:LinkLine[]=[];
  for(const {raw,line} of lines(text)){
    const c=raw.includes('\t')?raw.split('\t').map(s=>s.trim()):raw.includes('|')?raw.split('|').map(s=>s.trim()):raw.trim().split(/\s+/);
    if(out.length===0&&LINK_HEADER.test(c[0]||''))continue;
    const login=c[2]?c[2].toLowerCase():undefined,fourth=c[3]||undefined,fifth=c[4]?c[4].toLowerCase():undefined;
    const paypalEmail=fifth??(fourth&&(fourth===CLEAR||isEmail(fourth.toLowerCase()))?fourth.toLowerCase():undefined),paypalCode=fifth?fourth:undefined;
    const error=c.length<3||c.length>5?'Mỗi dòng: Server | VM | Tài khoản | Email PP (hoặc … | Mã PP | Email PP)':!c[0]||!c[1]?'Thiếu server hoặc VM':fourth&&!paypalEmail?'Cần email PayPal, không chỉ mã '+fourth+' (một PP có nhiều email)':login===undefined&&paypalEmail===undefined?'Dòng không có tài khoản hay email PayPal':login&&login!==CLEAR&&!isEmail(login)?'Tài khoản phải là email (hoặc - để bỏ gán)':paypalEmail&&paypalEmail!==CLEAR&&!isEmail(paypalEmail)?'Email PayPal không hợp lệ':null;
    out.push({line,server:c[0]||'',vm:c[1]||'',login,paypalCode,paypalEmail,error});
  }
  return out;
}
// Lines that repeat the same key: every line involved is reported, never "last line wins".
export function repeats<T>(rows:T[],key:(r:T)=>string|null,line:(r:T)=>number){
  const map=new Map<string,number[]>();for(const r of rows){const k=key(r);if(k)map.set(k,[...(map.get(k)||[]),line(r)]);}
  return (r:T)=>{const k=key(r),n=k?map.get(k)!:[];return n.length>1?n.filter(x=>x!==line(r)):null;};
}
