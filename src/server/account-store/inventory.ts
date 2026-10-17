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
import {MAX_LINES,parseLoginLines,parsePaypalLines,repeats} from './parse';
// Kho tài khoản: receive Gmail / Apple ID logins and PayPals in bulk (one preview, one import of the valid lines), each line with
// its own result. An existing account is never overwritten (credentials included). A purchase batch records what was actually paid
// once in the cost ledger; repeat imports, fixes in the same batch and assignments never add a cost.
export type StockKind='LOGIN'|'PAYPAL';
export type PriceMode='NONE'|'UNIT'|'TOTAL';
// A new purchase (batch) or an explicit "Nhập bổ sung" into one existing batch (append). Never both: an append carries no money,
// source or date, and a new purchase never falls into an old batch because its code matches.
export interface BatchInput {code?:string|null;source?:string|null;purchasedAt:string;priceMode:PriceMode;amount?:string|null;quantity?:number|null;currency?:string|null;rate?:string|null;notes?:string|null}
export interface ImportInput {kind:StockKind;loginType?:AccountLoginType|null;text:string;batch?:BatchInput|null;append?:{batchId:string}|null}
export interface ImportRow {line:number;account:string;email:string;hasPassword:boolean;has2fa:boolean;hasRecovery:boolean;outcome:'READY'|'EXISTS'|'ERROR';message:string;existingId:string|null}
export const LOGIN_TYPES:AccountLoginType[]=['GMAIL','APPLE_ID'];
export const typeLabel=(t:AccountLoginType|null|undefined)=>t==='APPLE_ID'?'Apple ID':t==='GMAIL'?'Gmail':'Chưa chọn loại';
const area=(kind:StockKind)=>kind==='PAYPAL'?'PAYPALS' as const:'INFRASTRUCTURE' as const;
// Writing stock: managers of the module (logins: Server/VM module, PayPal: PayPal module). Viewers never write.
export function assertStockWrite(scope:ActorScope,kind:StockKind){assertBusinessArea(scope,area(kind),true);if(!['ADMIN','MODERATOR'].includes(scope.role))throw new ProxyDomainError('FORBIDDEN','Quản lý mới được nhập kho tài khoản');}
export const canSeeMoney=(scope:ActorScope)=>scope.role==='ADMIN'||!!scope.allowedModules?.includes('COSTS');
function parse(input:ImportInput){
  if(input.text.length>400000)throw new ProxyDomainError('INVALID_INPUT','Dán tối đa '+MAX_LINES+' dòng mỗi lần');
  if(input.kind==='LOGIN'&&!LOGIN_TYPES.includes(input.loginType as AccountLoginType))throw new ProxyDomainError('INVALID_INPUT','Chọn loại tài khoản: Gmail hoặc Apple ID');
  const rows=input.kind==='LOGIN'?parseLoginLines(input.text):parsePaypalLines(input.text);
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
  const amount=parseOriginalMoney(b.amount),total=b.priceMode==='UNIT'?new CashDecimal(amount).mul(quantity!).toFixed(8):amount;
  const money=normalizeCostMoney({amount:total,currency:b.currency,rate:b.rate||undefined});return {unit:b.priceMode==='UNIT'?amount:null,quantity,...money};
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
      const base={line:l.line,account:l.email,email:l.email,hasPassword:!!l.password,has2fa:!!l.twoFa,hasRecovery:!!l.recovery,existingId:null};
      if(l.error){out.push({...base,outcome:'ERROR',message:l.error});continue;}
      const twice=again(l);if(twice){out.push({...base,outcome:'ERROR',message:'Trùng với dòng '+twice.join(', ')+' trong danh sách; giữ một dòng'});continue;}
      const old=byEmail.get(l.email);
      if(old&&old.projectId!==scope.projectId){out.push({...base,outcome:'ERROR',message:'Tài khoản đã thuộc dự án khác'});continue;}
      if(old){out.push({...base,existingId:old.id,outcome:'EXISTS',message:'Đã có trong kho'+(old.batch?' (lô '+old.batch.code+')':'')+(old.archivedAt?' · đã ẩn':'')+'; giữ nguyên, không ghi đè mật khẩu'});continue;}
      out.push({...base,outcome:'READY',message:l.password?'Nhập mới':'Nhập mới · chưa có mật khẩu'});
    }
  }else{
    const lines=parsed as PaypalLines,codeAgain=repeats(lines,r=>r.error?null:r.code.toLowerCase(),r=>r.line),mailAgain=repeats(lines,r=>r.error?null:r.email,r=>r.line);
    const [codes,mails]=await Promise.all([db.payPalAccount.findMany({where:{projectId:scope.projectId,code:{in:lines.map(l=>l.code),mode:'insensitive'}},select:{id:true,code:true,primaryEmail:true,archivedAt:true}}),db.payPalEmail.findMany({where:{projectId:scope.projectId,email:{in:lines.map(l=>l.email),mode:'insensitive'}},select:{email:true,paypal:{select:{id:true,code:true}}}})]);
    const byCode=new Map(codes.map(c=>[c.code.toLowerCase(),c])),byMail=new Map(mails.map(m=>[m.email.toLowerCase(),m.paypal]));
    for(const l of lines){
      const base={line:l.line,account:l.code,email:l.email,hasPassword:false,has2fa:false,hasRecovery:false,existingId:null};
      if(l.error){out.push({...base,outcome:'ERROR',message:l.error});continue;}
      const a=codeAgain(l),b=mailAgain(l);
      if(a){out.push({...base,outcome:'ERROR',message:'Trùng mã với dòng '+a.join(', ')+' trong danh sách; giữ một dòng'});continue;}
      if(b){out.push({...base,outcome:'ERROR',message:'Trùng email với dòng '+b.join(', ')+' trong danh sách; giữ một dòng'});continue;}
      const old=byCode.get(l.code.toLowerCase()),mail=byMail.get(l.email);
      if(old&&old.primaryEmail.toLowerCase()===l.email){out.push({...base,existingId:old.id,outcome:'EXISTS',message:'Đã có PayPal này'+(old.archivedAt?' (đã ẩn)':'')+'; giữ nguyên'});continue;}
      if(old){out.push({...base,outcome:'ERROR',message:'Mã '+old.code+' đã có với email khác; không tự ghi đè'});continue;}
      if(mail){out.push({...base,outcome:'ERROR',message:'Email đã thuộc PayPal '+mail.code});continue;}
      out.push({...base,outcome:'READY',message:'Nhập mới'});
    }
  }
  return {rows:out,parsed};
}
export async function previewStockImport(scope:ActorScope,input:ImportInput,db:PrismaClient=prisma){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);assertStockWrite(current,input.kind);
  const purchase=purchaseOf(input),{rows}=await classify(db,current,input),counts={rows,ready:rows.filter(r=>r.outcome==='READY').length,exists:rows.filter(r=>r.outcome==='EXISTS').length,errors:rows.filter(r=>r.outcome==='ERROR').length};
  if(!purchase){
    const batch=await appendTarget(db,current,input);
    return {...counts,batch:{existing:true,id:batch.id,code:batch.code,cost:batch.costRecordId&&!batch.costRecord?.voidedAt?'RECORDED' as const:'NONE' as const,total:null}};
  }
  // The code shown is the next free one now; the import takes the next free one at that moment (same unless someone imported meanwhile).
  const code=await newCode(db,current,input.kind,purchase),money=batchTotal(purchase);
  return {...counts,batch:{existing:false,id:null,code,cost:money?'WILL_RECORD' as const:'NONE' as const,total:money&&canSeeMoney(current)?{amount:money.amount,currency:money.currency,usdt:money.usdt,quantity:money.quantity,unit:money.unit}:null}};
}
// Idempotency hash input: secrets are replaced by their digest, so the journal never holds them.
const digest=(s:string|null)=>s?createHash('sha256').update(s).digest('hex'):null;
export async function commitStockImport(scope:ActorScope,input:ImportInput&{key:string},db:PrismaClient=prisma){
  const hashed={kind:input.kind,loginType:input.loginType,batch:input.batch??null,append:input.append??null,lines:input.kind==='LOGIN'?parseLoginLines(input.text).map(l=>({...l,password:digest(l.password),twoFa:digest(l.twoFa)})):parsePaypalLines(input.text)};
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
        const row=await tx.costRecord.create({data:{projectId:scope.projectId,code:'CP-'+input.key,date,amount:money.amount,total:money.amount,currency:money.currency,category:input.kind==='PAYPAL'?'PAYPAL':'GMAIL',note:costNote(code,purchase.source,money.quantity,input.kind,input.loginType),usdtRate:money.rate,usdtAmount:money.usdt,fxAppliedAt:new Date(),fxSource:'MANUAL',profitTreatment:'CASH_COST',businessManaged:true}});
        await images.remember('COST',row.id,true);costId=row.id;
      }
      batch=await tx.accountPurchaseBatch.create({data:{projectId:scope.projectId,kind:input.kind,loginType:input.kind==='LOGIN'?input.loginType:null,code,source:purchase.source?.trim()||null,purchasedAt:date,priceMode:money?purchase.priceMode:'NONE',unitPrice:money?.unit??null,totalPaid:money?.amount??null,currency:money?.currency??(purchase.currency?cashCurrency(purchase.currency):null),lineCount:rows.length,paidQuantity:money?.quantity??purchase.quantity??null,costRecordId:costId,notes:purchase.notes?.trim()||null,createdById:current.userId}});
      await images.remember('ACCOUNT_BATCH',batch.id,true);
    }
    const applied=await createRows(tx,images,current,input,parsed,new Set(ready.map(r=>r.line)),batch.id);
    const result=rows.map(r=>({line:r.line,account:r.account,outcome:r.outcome==='READY'?'APPLIED' as const:r.outcome,message:r.outcome==='READY'?'Đã nhập':r.message}));
    return {rows:result,applied,exists:rows.filter(r=>r.outcome==='EXISTS').length,errors:rows.filter(r=>r.outcome==='ERROR').length,batch:{id:batch.id,code:batch.code,appended:!purchase,costRecorded:!!batch.costRecordId}};
  },db);
}
const costNote=(code:string,source:string|null|undefined,quantity:number|null,kind:StockKind,type?:AccountLoginType|null)=>'Mua lô '+code+' · '+(quantity?quantity+' ':'')+(kind==='PAYPAL'?'PayPal':typeLabel(type))+(source?' · '+source:'');
async function createRows(tx:Prisma.TransactionClient,images:BusinessCollector,scope:ActorScope,input:ImportInput,parsed:LoginLines|PaypalLines,take:Set<number>,batchId:string){
  let n=0;
  for(const l of parsed){
    if(!take.has(l.line))continue;
    if(input.kind==='LOGIN'){
      const a=l as LoginLines[number];
      const row=await tx.gmailAccount.create({data:{projectId:scope.projectId,email:a.email,loginType:input.loginType,batchId,status:'ACTIVE',businessManaged:true,recoveryEmail:a.recovery,notes:a.notes,...(a.password?{password:encrypt(a.password)}:{}),...(a.twoFa?{twoFaCurrent:encrypt(a.twoFa)}:{})}});
      await images.remember('GMAIL',row.id,true);
    }else{
      const p=l as PaypalLines[number];
      const row=await tx.payPalAccount.create({data:{projectId:scope.projectId,code:p.code,primaryEmail:p.email,status:'ACTIVE',company:'',businessManaged:true,batchId,createdById:scope.userId}});
      await images.remember('PAYPAL',row.id,true);
      const mail=await tx.payPalEmail.create({data:{projectId:scope.projectId,paypalId:row.id,email:p.email,isPrimary:true,businessManaged:true}});await images.remember('PAYPAL_EMAIL',mail.id,true);
    }
    n++;
  }
  return n;
}
// A batch received without a price gets its actual payment later, once (total paid, or unit price × quantity bought). A batch whose cost was voided in Chi phí may be recorded again.
export async function recordBatchCost(scope:ActorScope,input:{batchId:string;expectedRevision:number;priceMode:'UNIT'|'TOTAL';amount:string;quantity?:number|null;currency:string;rate?:string|null;date?:string|null;key:string},db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'ACCOUNT_BATCH_COST',module:'COSTS',cash:true},async(tx,images)=>{
    const batch=await tx.accountPurchaseBatch.findFirst({where:{id:input.batchId,projectId:scope.projectId,archivedAt:null},include:{costRecord:true}});if(!batch)throw new ProxyDomainError('NOT_FOUND');
    if(batch.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW','Lô vừa được sửa; tải lại');
    if(batch.costRecord&&!batch.costRecord.voidedAt)throw new ProxyDomainError('INVALID_INPUT','Lô đã ghi chi phí; sửa khoản chi ở trang Chi phí, không ghi thêm');
    const money=batchTotal(input)!,date=input.date?dayDate(input.date):batch.purchasedAt;
    await assertPeriodOpen(tx,scope.projectId,date,money.currency);
    const cost=await tx.costRecord.create({data:{projectId:scope.projectId,code:'CP-'+input.key,date,amount:money.amount,total:money.amount,currency:money.currency,category:batch.kind==='PAYPAL'?'PAYPAL':'GMAIL',note:costNote(batch.code,batch.source,money.quantity??batch.paidQuantity,batch.kind as StockKind,batch.loginType),usdtRate:money.rate,usdtAmount:money.usdt,fxAppliedAt:new Date(),fxSource:'MANUAL',profitTreatment:'CASH_COST',businessManaged:true}});
    await images.remember('COST',cost.id,true);await images.remember('ACCOUNT_BATCH',batch.id);
    await tx.accountPurchaseBatch.update({where:{id:batch.id},data:{costRecordId:cost.id,priceMode:input.priceMode,unitPrice:money.unit,totalPaid:money.amount,paidQuantity:money.quantity??batch.paidQuantity,currency:money.currency,revision:{increment:1}}});
    return {id:batch.id,costId:cost.id};
  },db);
}
export const LOGIN_STATUS:GmailStatus[]=['ACTIVE','SUSPENDED','NEEDS_RECOVERY','NEEDS_2FA_UPDATE','BLOCKED','DISABLED'];
export const PP_STATUS:PayPalStatus[]=['ACTIVE','LIMITED','SUSPENDED','CLOSED','PENDING_VERIFY'];
// Status in the table cell or for many rows: same value = nothing written. Error / stopped accounts keep their links and history.
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
