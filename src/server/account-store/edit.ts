import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {decrypt,encrypt} from '@/lib/encryption';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand} from '../business-management/idempotency';
import {assertStockWrite,STOCK_NOTE_MAX} from './inventory';
import {isEmail,webLink} from './parse';
// Sửa một Gmail / Apple ID từ khung chi tiết (owner brief 20/10/2026). Only the fields the person changed are sent:
// - a field left out (undefined) is kept, whatever the form showed (a masked password, a link not loaded yet, an empty box);
// - null clears it, and only when the person pressed "Xoá trường này";
// - a string sets it. Secrets (password, 2FA, token, both links) are encrypted; the journal and the request hash hold digests only.
// Backend checks: write right on the stock (ADMIN / MODERATOR), the row is live (a deleted row is restored first), the revision the
// person saw (two people editing the same row: the second is refused, nothing overwritten), a new email unique across projects.
// The id, EarnApp / VM links, used marks, batch and cost never change. Undo through the journal image (GMAIL).
export type LoginField='email'|'password'|'twoFa'|'token'|'recoveryEmail'|'twoFaLink'|'smsLink'|'phone'|'notes';
export type LoginChanges=Partial<Record<LoginField,string|null>>;
export const LOGIN_FIELD_LABEL:Record<LoginField,string>={email:'Email đăng nhập',password:'Mật khẩu',twoFa:'Mã 2FA (TOTP)',token:'Token',recoveryEmail:'Email khôi phục',twoFaLink:'Link lấy mã 2FA',smsLink:'Link SMS',phone:'Số điện thoại',notes:'Ghi chú'};
const SECRET:LoginField[]=['password','twoFa','token','twoFaLink','smsLink'];
const COLUMN:Record<LoginField,'email'|'password'|'twoFaCurrent'|'token'|'recoveryEmail'|'twoFaLink'|'smsLink'|'phone'|'notes'>={email:'email',password:'password',twoFa:'twoFaCurrent',token:'token',recoveryEmail:'recoveryEmail',twoFaLink:'twoFaLink',smsLink:'smsLink',phone:'phone',notes:'notes'};
const PHONE=/^\+?[0-9][0-9 .()-]{2,39}$/;
const digest=(s:string|null|undefined)=>s==null?s:'sha256:'+createHash('sha256').update(s).digest('hex');
const bad=(f:LoginField,why:string)=>new ProxyDomainError('INVALID_INPUT',LOGIN_FIELD_LABEL[f]+': '+why);
/** Checks one value as typed; returns what is stored (trimmed where it is not a secret, links verbatim). */
function clean(f:LoginField,v:string|null):string|null{
  if(v===null){if(f==='email')throw bad(f,'không được để trống');return null;}
  if(f==='password'||f==='twoFa'||f==='token'){if(!v)throw bad(f,'để trống không phải là xoá; bấm "Xoá trường này" để xoá');if(v.length>2000)throw bad(f,'quá dài');return v;}
  const t=v.trim();if(!t)throw bad(f,'để trống không phải là xoá; bấm "Xoá trường này" để xoá');
  if(f==='email'||f==='recoveryEmail'){const e=t.toLowerCase();if(!isEmail(e))throw bad(f,'email không hợp lệ');return e;}
  if(f==='twoFaLink'||f==='smsLink'){const l=webLink(t);if(!l)throw bad(f,'phải là đường dẫn web (http:// hoặc https://)');return l;}
  if(f==='phone'){if(!PHONE.test(t))throw bad(f,'chỉ gồm số, dấu + và khoảng trắng');return t;}
  if(t.length>STOCK_NOTE_MAX)throw bad(f,'tối đa '+STOCK_NOTE_MAX+' ký tự');return t;
}
export async function updateLogin(scope:ActorScope,input:{id:string;expectedRevision:number;changes:LoginChanges;key:string},db:PrismaClient=prisma){
  const fields=(Object.keys(COLUMN) as LoginField[]).filter(f=>input.changes[f]!==undefined); // fixed order; unknown keys ignored
  if(!fields.length)throw new ProxyDomainError('INVALID_INPUT','Chưa có trường nào thay đổi');
  const next=Object.fromEntries(fields.map(f=>[f,clean(f,input.changes[f]!)])) as Record<LoginField,string|null>;
  const payload={id:input.id,expectedRevision:input.expectedRevision,changes:Object.fromEntries(fields.map(f=>[f,SECRET.includes(f)?digest(next[f]):next[f]]))};
  return runBusinessCommand(scope,{key:input.key,payload,kind:'ACCOUNT_STOCK_EDIT',module:'INFRASTRUCTURE',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    assertStockWrite(current,'LOGIN');
    const old=await tx.gmailAccount.findFirst({where:{id:input.id,projectId:scope.projectId}});
    if(!old)throw new ProxyDomainError('NOT_FOUND','Tài khoản không còn trong dự án');
    if(old.archivedAt)throw new ProxyDomainError('INVALID_INPUT','Tài khoản đã xoá khỏi kho; khôi phục trước khi sửa');
    if(old.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW','Tài khoản vừa được người khác sửa; tải lại rồi sửa tiếp (nội dung đang nhập được giữ)');
    const stored=(f:LoginField)=>{const raw=old[COLUMN[f]] as string|null;if(raw==null||!SECRET.includes(f))return raw;try{return decrypt(raw);}catch{return '\u0000unreadable';}};
    const data:Record<string,string|null>={},changed:LoginField[]=[];
    for(const f of fields){if(stored(f)===next[f])continue;changed.push(f);data[COLUMN[f]]=next[f]===null?null:SECRET.includes(f)?encrypt(next[f]!):next[f];}
    if(!changed.length)return {changed:false,fields:[] as string[],revision:old.revision,message:'Không thay đổi'};
    if(changed.includes('email')){
      const twin=await tx.gmailAccount.findFirst({where:{email:{equals:next.email!,mode:'insensitive'},id:{not:old.id}},select:{projectId:true,archivedAt:true}});
      if(twin)throw bad('email',twin.projectId!==scope.projectId?'đã thuộc dự án khác':twin.archivedAt?'đã có ở dòng đã xoá (khôi phục dòng đó thay vì sửa trùng)':'đã có trong kho');
    }
    await images.remember('GMAIL',old.id);
    const row=await tx.gmailAccount.update({where:{id:old.id},data:{...data,revision:{increment:1}}});
    return {changed:true,fields:changed.map(f=>LOGIN_FIELD_LABEL[f]),revision:row.revision,message:'Đã lưu '+changed.map(f=>LOGIN_FIELD_LABEL[f]).join(', ')};
  },db);
}
