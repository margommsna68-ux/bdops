import {createHash} from 'node:crypto';
import type {AccountLoginType,GmailStatus,PayPalStatus,Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt} from '@/lib/encryption';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {runBusinessCommand,type BusinessCollector} from '../business-management/idempotency';
import {assertBusinessArea} from '../business-management/scope';
import {authorizeTeamCash} from '../business-management/team-cash-scope';
import {assertPeriodOpen} from '../business-management/period-lock';
import {dayDate} from '../business-management/money';
import {CashDecimal,cashCurrency,normalizeCostMoney,parseOriginalMoney} from '../business-management/usdt-money';
import {verifyP2PQuote} from '../business-management/binance-p2p';
import {LOGIN_FORMATS,MAX_LINES,isEmail,parseLoginLines,parsePaypalLines,repeats,type LoginFormat,type PaypalLine} from './parse';
// Kho tài khoản: receive Gmail / Apple ID logins and PayPals in bulk (one preview, one import of the valid lines), each line with
// its own result. An existing account is never overwritten (credentials included). A purchase batch records what was actually paid
// once in the cost ledger; repeat imports, fixes in the same batch and assignments never add a cost.
export type StockKind='LOGIN'|'PAYPAL';
export type PriceMode='NONE'|'UNIT'|'TOTAL';
// A new purchase (batch) or an explicit "Nhập bổ sung" into one existing batch (append). Never both: an append carries no money,
// source or date, and a new purchase never falls into an old batch because its code matches.
export interface BatchInput {code?:string|null;source?:string|null;purchasedAt:string;priceMode:PriceMode;amount?:string|null;quantity?:number|null;currency?:string|null;rate?:string|null;notes?:string|null;p2pQuoteToken?:string|null}
export interface ImportInput {kind:StockKind;loginType?:AccountLoginType|null;/** Apple ID lists default to APPLE5 (Email | Mật khẩu | Link lấy 2FA | Link SMS | Số điện thoại); STANDARD is the older pattern. Gmail is always STANDARD. */loginFormat?:LoginFormat|null;text:string;batch?:BatchInput|null;append?:{batchId:string}|null}
export const loginFormatOf=(input:Pick<ImportInput,'loginType'|'loginFormat'>):LoginFormat=>input.loginFormat??(input.loginType==='APPLE_ID'?'APPLE5':'STANDARD');
// PayPal rows also carry the emails of the line and, for a code already in stock, the emails it would add (outcome ADD: shown with
// a "Bổ sung email" action; never imported as a new purchase or a second PayPal).
export interface ImportRow {line:number;account:string;email:string;hasPassword:boolean;has2fa:boolean;hasRecovery:boolean;has2faLink?:boolean;hasSmsLink?:boolean;hasPhone?:boolean;outcome:'READY'|'EXISTS'|'ADD'|'ERROR';message:string;existingId:string|null;emails?:string[];newEmails?:string[];head?:boolean}
export const LOGIN_TYPES:AccountLoginType[]=['GMAIL','APPLE_ID'];
export const typeLabel=(t:AccountLoginType|null|undefined)=>t==='APPLE_ID'?'Apple ID':t==='GMAIL'?'Gmail':'Chưa chọn loại';
const area=(kind:StockKind)=>kind==='PAYPAL'?'PAYPALS' as const:'INFRASTRUCTURE' as const;
// Writing stock: managers of the module (logins: Server/VM module, PayPal: PayPal module). Viewers never write.
export function assertStockWrite(scope:ActorScope,kind:StockKind){assertBusinessArea(scope,area(kind),true);if(!['ADMIN','MODERATOR'].includes(scope.role))throw new ProxyDomainError('FORBIDDEN','Quản lý mới được nhập kho tài khoản');}
export const canSeeMoney=(scope:ActorScope)=>scope.role==='ADMIN'||!!scope.allowedModules?.includes('COSTS');
function parse(input:ImportInput){
  if(input.text.length>400000)throw new ProxyDomainError('INVALID_INPUT','Dán tối đa '+MAX_LINES+' dòng mỗi lần');
  if(input.kind==='LOGIN'&&!LOGIN_TYPES.includes(input.loginType as AccountLoginType))throw new ProxyDomainError('INVALID_INPUT','Chọn loại tài khoản: Gmail hoặc Apple ID');
  if(input.kind==='LOGIN'&&input.loginFormat&&!LOGIN_FORMATS.includes(input.loginFormat))throw new ProxyDomainError('INVALID_INPUT','Mẫu dán không hợp lệ');
  if(input.kind==='LOGIN'&&input.loginType==='GMAIL'&&input.loginFormat==='APPLE5')throw new ProxyDomainError('INVALID_INPUT','Gmail dùng mẫu Tài khoản | Mật khẩu | 2FA | Email khôi phục | Ghi chú');
  const rows=input.kind==='LOGIN'?parseLoginLines(input.text,loginFormatOf(input)):parsePaypalLines(input.text);
  if(!rows.length||rows.length>MAX_LINES)throw new ProxyDomainError('INVALID_INPUT','Dán từ 1 đến '+MAX_LINES+' dòng mỗi lần');return rows;
}
export const MAX_QUANTITY=100000;
// Paid total of a purchase: the total as entered, or unit price × the quantity actually bought (typed by the person, never the
// number of pasted or valid lines: accounts that could not be imported may still have been paid for). Fixed afterwards.
export function batchTotal(b:Pick<BatchInput,'priceMode'|'amount'|'currency'|'rate'|'quantity'>){
  const quantity=b.quantity==null?null:b.quantity;
  if(quantity!==null&&(!Number.isInteger(quantity)||quantity<1||quantity>MAX_QUANTITY))throw new ProxyDomainError('INVALID_INPUT','Số lượng thực mua là số nguyên từ 1 đến '+MAX_QUANTITY);
  if(b.priceMode==='NONE'){if(b.amount?.trim())throw new ProxyDomainError('INVALID_INPUT','Đã nhập số tiền nhưng chưa chọn cách tính tiền mua');return null;}
  if(!['UNIT','TOTAL'].includes(b.priceMode)||!b.amount||!b.currency)throw new ProxyDomainError('INVALID_INPUT','Nhập giá, đồng tiền (và tỷ giá nếu không phải USDT)');
  if(b.priceMode==='UNIT'&&quantity===null)throw new ProxyDomainError('INVALID_INPUT','Giá mỗi tài khoản cần Số lượng thực mua (không lấy số dòng dán)');
  canonical(b.amount,'Số tiền');if(b.rate)canonical(b.rate,'Tỷ giá');
  const amount=parseOriginalMoney(b.amount),total=b.priceMode==='UNIT'?new CashDecimal(amount).mul(quantity!).toFixed(8):amount;
  const money=normalizeCostMoney({amount:total,currency:b.currency,rate:b.rate||undefined});return {unit:b.priceMode==='UNIT'?amount:null,quantity,...money};
}
// Numbers reach these endpoints in canonical form only ("420000", "25820", "16.27"): the web form parses the Vietnamese text once
// (src/lib/money-input.ts). Text such as "25.820" or "70.000" is refused instead of being read as 25,82 / 70 (bug 19/10/2026).
function canonical(text:string,label:string){if(!/^(0|[1-9]\d*)(\.\d*[1-9])?$/.test(text.trim()))throw new ProxyDomainError('INVALID_INPUT',label+' phải gửi ở dạng số chuẩn (ví dụ 420000, 25820 hoặc 16.27); "'+text.slice(0,20)+'" có thể bị hiểu sai nên không nhận');}
// Rate source of a purchase cost: a sealed Binance P2P quote (same check as Chi phí: same user, project, currency and rate, at most 10
// minutes old; an expired quote is refused, never re-priced) or the rate typed by the person.
function fxOf(scope:{projectId:string;userId:string},token:string|null|undefined,money:{currency:string;rate:string}){
  if(!token||money.currency==='USDT')return {fxSource:'MANUAL',fxAppliedAt:new Date()};
  const q=verifyP2PQuote(token,scope,money.currency,money.rate);return {fxSource:'BINANCE_P2P_'+q.side,fxAppliedAt:new Date(q.fetchedAt)};
}
type Db=Prisma.TransactionClient|PrismaClient;
function purchaseOf(input:ImportInput){
  if(input.append&&input.batch)throw new ProxyDomainError('INVALID_INPUT','Nhập bổ sung không kèm tiền mua, nguồn hay ngày mua; lô đã có thông tin riêng. Lần mua mới thì bấm Nhập tài khoản');
  if(!input.append&&!input.batch)throw new ProxyDomainError('INVALID_INPUT','Thiếu thông tin lần mua');
  if(input.batch){dayDate(input.batch.purchasedAt);if(input.batch.source&&input.batch.source.length>200||input.batch.notes&&input.batch.notes.length>1000||input.batch.code&&input.batch.code.trim().length>60)throw new ProxyDomainError('INVALID_INPUT','Mã lô / nguồn mua / ghi chú quá dài');}
  return input.batch||null;
}
// "Nhập bổ sung": only the batch the person opened it from, same kind and login type, not withdrawn.
async function appendTarget(db:Db,scope:ActorScope,input:ImportInput){
  const batch=await db.accountPurchaseBatch.findFirst({where:{id:input.append!.batchId,projectId:scope.projectId,kind:input.kind},include:{costRecord:{select:{voidedAt:true}}}});
  if(!batch)throw new ProxyDomainError('INVALID_INPUT','Không tìm thấy lô để nhập bổ sung');
  if(batch.archivedAt)throw new ProxyDomainError('INVALID_INPUT','Lô '+batch.code+' đã thu hồi; không nhập bổ sung');
  if(batch.kind==='LOGIN'&&batch.loginType!==input.loginType)throw new ProxyDomainError('INVALID_INPUT','Lô '+batch.code+' là lô '+typeLabel(batch.loginType)+'; chọn đúng loại');
  return batch;
}
// Code of a new purchase: the one typed (must be unused, withdrawn batches included), else TK-/PP-<purchase date>-<n>, the next
// free number. Runs under the project lock in the command, so two people importing at once get different codes.
async function newCode(db:Db,scope:ActorScope,kind:StockKind,b:BatchInput){
  const typed=b.code?.trim();
  if(typed){if(await db.accountPurchaseBatch.findFirst({where:{projectId:scope.projectId,kind,code:typed},select:{id:true}}))throw new ProxyDomainError('INVALID_INPUT','Mã lô '+typed+' đã có. Lần mua mới cần mã khác (để trống để tự sinh); thêm vào lô đó thì bấm Nhập bổ sung ở tab Lô nhập');return typed;}
  const prefix=(kind==='PAYPAL'?'PP':'TK')+'-'+b.purchasedAt,taken=await db.accountPurchaseBatch.findMany({where:{projectId:scope.projectId,kind,code:{startsWith:prefix}},select:{code:true}});
  let n=0;for(const {code} of taken){const m=code.slice(prefix.length).match(/^(?:-(\d{1,6}))?$/);if(m)n=Math.max(n,m[1]?Number(m[1]):1);}
  return prefix+'-'+(n+1);
}
type LoginLines=ReturnType<typeof parseLoginLines>;type PaypalLines=ReturnType<typeof parsePaypalLines>;
async function classify(db:Db,scope:ActorScope,input:ImportInput){
  const parsed=parse(input),out:ImportRow[]=[];
  if(input.kind==='LOGIN'){
    const lines=parsed as LoginLines,again=repeats(lines,r=>r.error?null:r.email,r=>r.line);
    const found=await db.gmailAccount.findMany({where:{email:{in:lines.map(l=>l.email).filter(Boolean),mode:'insensitive'}},select:{id:true,email:true,projectId:true,archivedAt:true,batch:{select:{code:true}}}});
    const byEmail=new Map(found.map(f=>[f.email.toLowerCase(),f]));
    for(const l of lines){
      const base={line:l.line,account:l.email,email:l.email,hasPassword:!!l.password,has2fa:!!l.twoFa,hasRecovery:!!l.recovery,has2faLink:!!l.twoFaLink,hasSmsLink:!!l.smsLink,hasPhone:!!l.phone,existingId:null};
      if(l.error){out.push({...base,outcome:'ERROR',message:l.error});continue;}
      const twice=again(l);if(twice){out.push({...base,outcome:'ERROR',message:'Trùng với dòng '+twice.join(', ')+' trong danh sách; giữ một dòng'});continue;}
      const old=byEmail.get(l.email);
      if(old&&old.projectId!==scope.projectId){out.push({...base,outcome:'ERROR',message:'Tài khoản đã thuộc dự án khác'});continue;}
      if(old){out.push({...base,existingId:old.id,outcome:'EXISTS',message:'Đã có trong kho'+(old.batch?' (lô '+old.batch.code+')':'')+(old.archivedAt?' · đã xoá khỏi kho (Khôi phục ở bộ lọc Đã xoá)':'')+'; giữ nguyên, không ghi đè mật khẩu, link hay số điện thoại'});continue;}
      out.push({...base,outcome:'READY',message:l.password?'Nhập mới':'Nhập mới · chưa có mật khẩu'});
    }
  }else{
    const lines=parsed as PaypalLines,codes=[...new Set(lines.map(l=>l.code).filter(Boolean))],mails=[...new Set(lines.flatMap(l=>l.emails))];
    const [pps,known]=await Promise.all([db.payPalAccount.findMany({where:{projectId:scope.projectId,code:{in:codes,mode:'insensitive'}},select:{id:true,code:true,archivedAt:true,batchId:true,emails:{select:{email:true}}}}),
      db.payPalEmail.findMany({where:{email:{in:mails,mode:'insensitive'}},select:{email:true,projectId:true,paypal:{select:{id:true,code:true}}}})]);
    const byCode=new Map(pps.map(p=>[p.code.toLowerCase(),p])),byMail=new Map<string,{projectId:string;paypal:{id:string;code:string}}>();for(const k of known)byMail.set(k.email.toLowerCase(),k);
    // Group lines by code (no case). An email on two different codes is an error on both; a group with a broken line waits for it.
    const groups=new Map<string,PaypalLines>();for(const l of lines)if(l.code)groups.set(l.code.toLowerCase(),[...(groups.get(l.code.toLowerCase())||[]),l]);
    const codeOfMail=new Map<string,Set<string>>();for(const l of lines)if(!l.error)for(const m of l.emails)codeOfMail.set(m,new Set([...(codeOfMail.get(m)||[]),l.code.toLowerCase()]));
    for(const [key,group] of groups){
      const first=group[0],emails=[...new Set(group.filter(l=>!l.error).flatMap(l=>l.emails))],old=byCode.get(key);
      const push=(l:PaypalLine,outcome:ImportRow['outcome'],message:string,extra:Partial<ImportRow>={})=>out.push({line:l.line,account:l.code,email:l.emails.join(' '),hasPassword:false,has2fa:false,hasRecovery:false,existingId:old?.id??null,outcome,message,emails:l.emails,...extra});
      const broken=group.filter(l=>l.error);
      if(broken.length===group.length){for(const l of group)push(l,'ERROR',l.error!);continue;}
      const crossed=emails.filter(m=>(codeOfMail.get(m)?.size||0)>1),foreign=emails.filter(m=>{const k=byMail.get(m);return k&&k.projectId!==scope.projectId;}),other=emails.filter(m=>{const k=byMail.get(m);return k&&k.projectId===scope.projectId&&k.paypal.code.toLowerCase()!==key;});
      const groupError=broken.length&&broken.length<group.length?'Mã '+first.code+' còn dòng lỗi '+broken.map(l=>l.line).join(', ')+'; sửa xong nhập cả mã một lần'
        :crossed.length?'Email '+crossed.join(', ')+' nằm ở mã khác trong danh sách; mỗi email thuộc một PP'
        :other.length?other.map(m=>'Email '+m+' đã thuộc PP '+byMail.get(m)!.paypal.code).join('; ')
        :foreign.length?'Email '+foreign.join(', ')+' đã thuộc dự án khác'
        :old?.archivedAt?'Mã '+old.code+' đã có (đã ẩn); không tạo PP thứ hai':null;
      const repeatedNote=(l:PaypalLine)=>l.repeated.length?' · email lặp trên dòng chỉ nhận một lần':'';
      const joined=(l:PaypalLine,i:number)=>i===0?'':' · gộp vào mã '+first.code+' (dòng '+first.line+')';
      if(groupError){for(const l of group)push(l,'ERROR',l.error||groupError);continue;}
      if(old){
        const have=new Set(old.emails.map(e=>e.email.toLowerCase())),fresh=emails.filter(m=>!have.has(m));
        group.forEach((l,i)=>push(l,fresh.length?'ADD':'EXISTS',i===0?(fresh.length?'Mã '+old.code+' đã có; '+fresh.length+' email mới: '+fresh.join(', ')+'. Bấm Bổ sung email (không phải lần mua mới)':'Đã có PP '+old.code+' với các email này; không thay đổi'):'Cùng mã '+old.code+' với dòng '+first.line,{newEmails:i===0?fresh:[],head:i===0}));
        continue;
      }
      group.forEach((l,i)=>push(l,'READY',(i===0?'PP mới · '+emails.length+' email':'Email cho mã '+first.code)+joined(l,i)+repeatedNote(l),{newEmails:i===0?emails:[],head:i===0}));
    }
    out.sort((a,b)=>a.line-b.line);
  }
  return {rows:out,parsed};
}
// Counts shown before importing. PayPal: one PayPal per code however many emails or lines it has (ready = PayPals to create).
function countRows(kind:StockKind,rows:ImportRow[]){
  const firsts=kind==='PAYPAL'?rows.filter(r=>r.head):rows;
  return {rows,ready:firsts.filter(r=>r.outcome==='READY').length,exists:firsts.filter(r=>r.outcome==='EXISTS').length,add:firsts.filter(r=>r.outcome==='ADD').length,emails:kind==='PAYPAL'?rows.filter(r=>r.outcome==='READY').reduce((a,r)=>a+(r.newEmails?.length||0),0):0,errors:rows.filter(r=>r.outcome==='ERROR').length};
}
export async function previewStockImport(scope:ActorScope,input:ImportInput,db:PrismaClient=prisma){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);assertStockWrite(current,input.kind);
  const purchase=purchaseOf(input),{rows}=await classify(db,current,input),counts=countRows(input.kind,rows);
  if(!purchase){
    const batch=await appendTarget(db,current,input);
    return {...counts,batch:{existing:true,id:batch.id,code:batch.code,cost:batch.costRecordId&&!batch.costRecord?.voidedAt?'RECORDED' as const:'NONE' as const,total:null}};
  }
  // The code shown is the next free one now; the import takes the next free one at that moment (same unless someone imported meanwhile).
  const code=await newCode(db,current,input.kind,purchase),money=batchTotal(purchase);if(money)fxOf(current,purchase.p2pQuoteToken,money);
  return {...counts,batch:{existing:false,id:null,code,cost:money?'WILL_RECORD' as const:'NONE' as const,total:money&&canSeeMoney(current)?{amount:money.amount,currency:money.currency,usdt:money.usdt,quantity:money.quantity,unit:money.unit}:null}};
}
// Idempotency hash input: secrets are replaced by their digest, so the journal never holds them.
const digest=(s:string|null)=>s?createHash('sha256').update(s).digest('hex'):null;
export async function commitStockImport(scope:ActorScope,input:ImportInput&{key:string},db:PrismaClient=prisma){
  const hashed={kind:input.kind,loginType:input.loginType,batch:input.batch??null,append:input.append??null,format:input.kind==='LOGIN'?loginFormatOf(input):null,lines:input.kind==='LOGIN'?parseLoginLines(input.text,loginFormatOf(input)).map(l=>({...l,password:digest(l.password),twoFa:digest(l.twoFa),twoFaLink:digest(l.twoFaLink),smsLink:digest(l.smsLink)})):parsePaypalLines(input.text)};
  return runBusinessCommand(scope,{key:input.key,payload:hashed,kind:input.kind==='LOGIN'?'ACCOUNT_STOCK_IMPORT':'PAYPAL_STOCK_IMPORT',module:area(input.kind)},async(tx,images,current)=>{
    assertStockWrite(current,input.kind);
    const purchase=purchaseOf(input),{rows,parsed}=await classify(tx,current,input),ready=rows.filter(r=>r.outcome==='READY');
    let batch:{id:string;code:string;costRecordId:string|null};
    if(!purchase)batch=await appendTarget(tx,current,input);
    else{
      // A new purchase that brings nothing new would only duplicate a purchase (repeat import): refuse it, with its cost.
      if(!ready.length)throw new ProxyDomainError('INVALID_INPUT','Không có dòng mới để nhập; không tạo lô hay chi phí');
      const code=await newCode(tx,current,input.kind,purchase),money=batchTotal(purchase),date=dayDate(purchase.purchasedAt);
      let costId:string|null=null;
      if(money){
        try{await authorizeTeamCash(current,'COSTS',true,tx);}catch{throw new ProxyDomainError('FORBIDDEN','Cần quyền ghi Chi phí (thu chi USDT) để ghi tiền mua; hoặc nhập không giá rồi ghi chi phí sau');}
        await assertPeriodOpen(tx,scope.projectId,date,money.currency);
        const row=await tx.costRecord.create({data:{projectId:scope.projectId,code:'CP-'+input.key,date,amount:money.amount,total:money.amount,currency:money.currency,category:input.kind==='PAYPAL'?'PAYPAL':'GMAIL',note:costNote(code,purchase.source,money.quantity,input.kind,input.loginType),usdtRate:money.rate,usdtAmount:money.usdt,...fxOf(current,purchase.p2pQuoteToken,money),profitTreatment:'CASH_COST',businessManaged:true}});
        await images.remember('COST',row.id,true);costId=row.id;
      }
      batch=await tx.accountPurchaseBatch.create({data:{projectId:scope.projectId,kind:input.kind,loginType:input.kind==='LOGIN'?input.loginType:null,code,source:purchase.source?.trim()||null,purchasedAt:date,priceMode:money?purchase.priceMode:'NONE',unitPrice:money?.unit??null,totalPaid:money?.amount??null,currency:money?.currency??(purchase.currency?cashCurrency(purchase.currency):null),lineCount:rows.length,paidQuantity:money?.quantity??purchase.quantity??null,costRecordId:costId,notes:purchase.notes?.trim()||null,createdById:current.userId}});
      await images.remember('ACCOUNT_BATCH',batch.id,true);
    }
    const applied=await createRows(tx,images,current,input,parsed,new Set(ready.map(r=>r.line)),batch.id);
    const counted=countRows(input.kind,rows);
    const result=rows.map(r=>({line:r.line,account:r.account,outcome:r.outcome==='READY'?'APPLIED' as const:r.outcome,message:r.outcome==='READY'?'Đã nhập':r.message,newEmails:r.newEmails,existingId:r.existingId}));
    return {rows:result,applied,emails:counted.emails,exists:counted.exists,add:counted.add,errors:counted.errors,batch:{id:batch.id,code:batch.code,appended:!purchase,costRecorded:!!batch.costRecordId}};
  },db);
}
const costNote=(code:string,source:string|null|undefined,quantity:number|null,kind:StockKind,type?:AccountLoginType|null)=>'Mua lô '+code+' · '+(quantity?quantity+' ':'')+(kind==='PAYPAL'?'PayPal':typeLabel(type))+(source?' · '+source:'');
async function createRows(tx:Prisma.TransactionClient,images:BusinessCollector,scope:ActorScope,input:ImportInput,parsed:LoginLines|PaypalLines,take:Set<number>,batchId:string){
  let n=0;const done=new Set<string>();
  for(const l of parsed){
    if(!take.has(l.line))continue;
    if(input.kind==='LOGIN'){
      const a=l as LoginLines[number];
      const row=await tx.gmailAccount.create({data:{projectId:scope.projectId,email:a.email,loginType:input.loginType,batchId,status:'ACTIVE',businessManaged:true,recoveryEmail:a.recovery,notes:a.notes,phone:a.phone,...(a.password?{password:encrypt(a.password)}:{}),...(a.twoFa?{twoFaCurrent:encrypt(a.twoFa)}:{}),...(a.twoFaLink?{twoFaLink:encrypt(a.twoFaLink)}:{}),...(a.smsLink?{smsLink:encrypt(a.smsLink)}:{})}});
      await images.remember('GMAIL',row.id,true);
    }else{
      // The first line of a code creates the PayPal with every email of the code (all lines); later lines of the code add nothing.
      const p=l as PaypalLines[number],key=p.code.toLowerCase();if(done.has(key))continue;done.add(key);
      const emails=[...new Set((parsed as PaypalLines).filter(x=>x.code.toLowerCase()===key&&!x.error).flatMap(x=>x.emails))];
      const row=await tx.payPalAccount.create({data:{projectId:scope.projectId,code:p.code,primaryEmail:emails[0],status:'ACTIVE',company:'',businessManaged:true,batchId,createdById:scope.userId}});
      await images.remember('PAYPAL',row.id,true);
      for(const [i,email] of emails.entries()){const mail=await tx.payPalEmail.create({data:{projectId:scope.projectId,paypalId:row.id,email,isPrimary:i===0,businessManaged:true}});await images.remember('PAYPAL_EMAIL',mail.id,true);}
    }
    n++;
  }
  return n;
}
// "Bổ sung email": more receiving emails for one PayPal already in stock. Not a purchase (no batch, no cost). Every email is checked
// in this project (active, hidden and used ones) and other projects (reported only as "dự án khác"); same emails again = no change.
export async function addPaypalEmails(scope:ActorScope,input:{paypalId:string;emails:string[];key:string},db:PrismaClient=prisma){
  const emails=[...new Set(input.emails.map(e=>e.trim().toLowerCase()).filter(Boolean))];
  if(!emails.length||emails.length>200)throw new ProxyDomainError('INVALID_INPUT','Từ 1 đến 200 email mỗi lần');
  return runBusinessCommand(scope,{key:input.key,payload:{paypalId:input.paypalId,emails},kind:'PAYPAL_EMAIL_ADD',module:'PAYPALS',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    assertStockWrite(current,'PAYPAL');
    const pp=await tx.payPalAccount.findFirst({where:{id:input.paypalId,projectId:scope.projectId}});if(!pp||pp.archivedAt)throw new ProxyDomainError('NOT_FOUND','PayPal không còn trong kho');
    const known=await tx.payPalEmail.findMany({where:{email:{in:emails,mode:'insensitive'}},select:{email:true,projectId:true,paypalId:true,paypal:{select:{code:true}}}}),by=new Map(known.map(k=>[k.email.toLowerCase(),k]));
    const rows:{email:string;outcome:'APPLIED'|'SKIP'|'ERROR';message:string}[]=[];
    for(const email of emails){
      const k=by.get(email);
      if(!isEmail(email))rows.push({email,outcome:'ERROR',message:'Email không hợp lệ'});
      else if(k&&k.projectId!==scope.projectId)rows.push({email,outcome:'ERROR',message:'Email đã thuộc dự án khác'});
      else if(k&&k.paypalId!==pp.id)rows.push({email,outcome:'ERROR',message:'Email đã thuộc PP '+k.paypal.code});
      else if(k)rows.push({email,outcome:'SKIP',message:'Đã có trong PP này'});
      else rows.push({email,outcome:'APPLIED',message:'Đã bổ sung'});
    }
    const add=rows.filter(r=>r.outcome==='APPLIED');
    if(add.length){
      await images.remember('PAYPAL',pp.id);await tx.payPalAccount.update({where:{id:pp.id},data:{revision:{increment:1}}});
      for(const r of add){const mail=await tx.payPalEmail.create({data:{projectId:scope.projectId,paypalId:pp.id,email:r.email,isPrimary:false,businessManaged:true}});await images.remember('PAYPAL_EMAIL',mail.id,true);}
    }
    return {code:pp.code,rows,applied:add.length,skipped:rows.filter(r=>r.outcome==='SKIP').length,errors:rows.filter(r=>r.outcome==='ERROR').length};
  },db);
}
// A batch received without a price gets its actual payment later, once (total paid, or unit price × quantity bought). A batch whose cost was voided in Chi phí may be recorded again.
export async function recordBatchCost(scope:ActorScope,input:{batchId:string;expectedRevision:number;priceMode:'UNIT'|'TOTAL';amount:string;quantity?:number|null;currency:string;rate?:string|null;date?:string|null;p2pQuoteToken?:string|null;key:string},db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'ACCOUNT_BATCH_COST',module:'COSTS',cash:true},async(tx,images)=>{
    const batch=await tx.accountPurchaseBatch.findFirst({where:{id:input.batchId,projectId:scope.projectId,archivedAt:null},include:{costRecord:true}});if(!batch)throw new ProxyDomainError('NOT_FOUND');
    if(batch.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW','Lô vừa được sửa; tải lại');
    if(batch.costRecord&&!batch.costRecord.voidedAt)throw new ProxyDomainError('INVALID_INPUT','Lô đã ghi chi phí; sửa khoản chi ở trang Chi phí, không ghi thêm');
    const money=batchTotal(input)!,date=input.date?dayDate(input.date):batch.purchasedAt;
    await assertPeriodOpen(tx,scope.projectId,date,money.currency);
    const cost=await tx.costRecord.create({data:{projectId:scope.projectId,code:'CP-'+input.key,date,amount:money.amount,total:money.amount,currency:money.currency,category:batch.kind==='PAYPAL'?'PAYPAL':'GMAIL',note:costNote(batch.code,batch.source,money.quantity??batch.paidQuantity,batch.kind as StockKind,batch.loginType),usdtRate:money.rate,usdtAmount:money.usdt,...fxOf(scope,input.p2pQuoteToken,money),profitTreatment:'CASH_COST',businessManaged:true}});
    await images.remember('COST',cost.id,true);await images.remember('ACCOUNT_BATCH',batch.id);
    await tx.accountPurchaseBatch.update({where:{id:batch.id},data:{costRecordId:cost.id,priceMode:input.priceMode,unitPrice:money.unit,totalPaid:money.amount,paidQuantity:money.quantity??batch.paidQuantity,currency:money.currency,revision:{increment:1}}});
    return {id:batch.id,costId:cost.id};
  },db);
}
export const LOGIN_STATUS:GmailStatus[]=['ACTIVE','SUSPENDED','NEEDS_RECOVERY','NEEDS_2FA_UPDATE','BLOCKED','DISABLED'];
export const PP_STATUS:PayPalStatus[]=['ACTIVE','LIMITED','SUSPENDED','CLOSED','PENDING_VERIFY'];
// Status in the table cell or for many rows: same value = nothing written. Error / stopped accounts keep their links and history.
export const STOCK_NOTE_MAX=2000;
/** Note of one Gmail / Apple ID, edited in its cell (owner brief 20/10/2026): only the note changes (never password, status, batch
 *  or cost), against the revision the person saw; blank text clears it; the same text writes nothing; journaled with undo. */
export async function setStockNote(scope:ActorScope,input:{id:string;expectedRevision:number;notes:string;key:string},db:PrismaClient=prisma){
  const next=input.notes.replace(/\r/g,'').trim()||null;if(next&&next.length>STOCK_NOTE_MAX)throw new ProxyDomainError('INVALID_INPUT','Ghi chú tối đa '+STOCK_NOTE_MAX+' ký tự');
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'ACCOUNT_STOCK_NOTE',module:area('LOGIN'),skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    assertStockWrite(current,'LOGIN');
    const old=await tx.gmailAccount.findFirst({where:{id:input.id,projectId:scope.projectId,archivedAt:null}});
    if(!old)throw new ProxyDomainError('NOT_FOUND','Tài khoản không còn trong kho');
    if((old.notes??null)===next)return {changed:false,notes:old.notes,revision:old.revision,message:'Không thay đổi'};
    if(old.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW','Tài khoản vừa được sửa ở nơi khác; tải lại (nội dung đang nhập được giữ)');
    await images.remember('GMAIL',old.id);
    const row=await tx.gmailAccount.update({where:{id:old.id},data:{notes:next,revision:{increment:1}}});
    return {changed:true,notes:row.notes,revision:row.revision,message:'Đã lưu'};
  },db);
}
export async function setStockStatus(scope:ActorScope,input:{kind:StockKind;items:{id:string;expectedRevision:number}[];status:string;key:string},db:PrismaClient=prisma){
  const list:string[]=input.kind==='LOGIN'?LOGIN_STATUS:PP_STATUS;
  if(!list.includes(input.status)||!input.items.length||input.items.length>1000)throw new ProxyDomainError('INVALID_INPUT');
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'ACCOUNT_STOCK_STATUS',module:area(input.kind),skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    assertStockWrite(current,input.kind);const rows:{id:string;outcome:'APPLIED'|'SKIP'|'ERROR';message:string}[]=[];
    for(const item of input.items){
      const old=input.kind==='LOGIN'?await tx.gmailAccount.findFirst({where:{id:item.id,projectId:scope.projectId,archivedAt:null}}):await tx.payPalAccount.findFirst({where:{id:item.id,projectId:scope.projectId,archivedAt:null}});
      if(!old){rows.push({id:item.id,outcome:'ERROR',message:'Không còn trong kho'});continue;}
      if(old.status===input.status){rows.push({id:item.id,outcome:'SKIP',message:'Không thay đổi'});continue;}
      if(old.revision!==item.expectedRevision){rows.push({id:item.id,outcome:'ERROR',message:'Vừa được sửa; tải lại'});continue;}
      if(input.kind==='LOGIN'){await images.remember('GMAIL',old.id);await tx.gmailAccount.update({where:{id:old.id},data:{status:input.status as GmailStatus,revision:{increment:1}}});}
      else{await images.remember('PAYPAL',old.id);await tx.payPalAccount.update({where:{id:old.id},data:{status:input.status as PayPalStatus,revision:{increment:1}}});}
      rows.push({id:item.id,outcome:'APPLIED',message:'Đã lưu'});
    }
    return {rows,applied:rows.filter(r=>r.outcome==='APPLIED').length};
  },db);
}
