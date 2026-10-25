import {ProxyDomainError,type ActorScope,type BatchInput,type ProxyPurchasePreview} from './types';
import {dayDate} from '../business-management/money';
import {CashDecimal,normalizeCostMoney,parseOriginalMoney,paypalCostFxNote} from '../business-management/usdt-money';
import {verifyP2PQuote} from '../business-management/binance-p2p';
export const MAX_PROXY_PURCHASE_QUANTITY=100000;
const canonicalMoney=(value:string)=>{if(typeof value!=='string'||!/^(0|[1-9]\d*)(\.\d*[1-9])?$/.test(value))throw new ProxyDomainError('INVALID_INPUT','Số tiền phải ở dạng chuẩn (ví dụ 25000 hoặc 1.25), không dùng dấu phân cách hàng nghìn');};
/** Default quantity is the accepted-new plan. An explicitly entered invoice quantity is preserved even on partial import. */
export function prepareProxyPurchase(input:BatchInput,importableQuantity:number):ProxyPurchasePreview|undefined{
 const p=input.purchase;if(!p)return;
 if(input.kind!=='NEW')throw new ProxyDomainError('INVALID_INPUT','Chỉ nhập proxy mới mới ghi tiền mua');
 if(!['UNIT','TOTAL'].includes(p.priceMode)||!['VND','PPUSD','USDT'].includes(p.currency))throw new ProxyDomainError('INVALID_INPUT');
 dayDate(p.purchasedAt);canonicalMoney(p.amount);
 if(p.source&&p.source.length>200||p.notes&&p.notes.length>1000)throw new ProxyDomainError('INVALID_INPUT','Nguồn mua / ghi chú quá dài');
 const automaticQuantity=importableQuantity;
 const actual=p.quantity!=null,quantity=actual?p.quantity!:automaticQuantity;
 if(!Number.isInteger(quantity)||quantity<1||quantity>MAX_PROXY_PURCHASE_QUANTITY)throw new ProxyDomainError('INVALID_INPUT','Số lượng thực mua là số nguyên từ 1 đến '+MAX_PROXY_PURCHASE_QUANTITY);
 if(!importableQuantity)throw new ProxyDomainError('INVALID_INPUT','Không có proxy mới để nhập; không ghi thêm chi phí');
 const amount=parseOriginalMoney(p.amount),total=p.priceMode==='UNIT'?new CashDecimal(amount).mul(quantity).toFixed(8):amount;
 const money=normalizeCostMoney({amount:total,currency:p.currency,rate:p.rate||undefined,paypalVndRate:p.paypalVndRate,vndUsdtRate:p.vndUsdtRate});
 return {purchasedAt:p.purchasedAt,priceMode:p.priceMode,automaticQuantity,quantity,quantitySource:actual?'ACTUAL':'AUTO',importableQuantity,unitPrice:p.priceMode==='UNIT'?amount:null,total:money.amount,currency:p.currency,rate:money.rate,usdt:money.usdt};
}
/** Re-verify any sealed quote at commit. The token is never returned in a preview or journal. */
export function proxyPurchaseFx(scope:Pick<ActorScope,'userId'|'projectId'>,input:BatchInput,purchase:ProxyPurchasePreview){
 const p=input.purchase!;
 const q=p.p2pQuoteToken?verifyP2PQuote(p.p2pQuoteToken,scope,p.currency==='PPUSD'?'VND':p.currency,p.currency==='PPUSD'?p.vndUsdtRate||'':purchase.rate):null;
 return {fxAppliedAt:q?new Date(q.fetchedAt):new Date(),fxSource:p.currency==='PPUSD'?(q?'PAYPAL_VND_BINANCE_P2P_'+q.side:'PAYPAL_VND_MANUAL'):q?'BINANCE_P2P_'+q.side:'MANUAL',fxNote:p.currency==='PPUSD'?paypalCostFxNote(p):null};
}
