import {Prisma} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';
export const CashDecimal=Prisma.Decimal.clone({precision:80,rounding:Prisma.Decimal.ROUND_HALF_UP});
const invalid=():never=>{throw new ProxyDomainError('INVALID_INPUT','Số tiền hoặc tỷ giá chưa hợp lệ');};
function positive(text:string,integers:number,fraction:number){
 if(!new RegExp(`^(0|[1-9]\\d{0,${integers-1}})(\\.\\d{1,${fraction}})?$`).test(text))invalid();
 const value=new CashDecimal(text);if(!value.gt(0))invalid();return value;
}
export function cashCurrency(text:string){const c=text.trim().toUpperCase();if(!/^[A-Z]{3,8}$/.test(c))invalid();return c;}
export function parseOriginalMoney(text:string){return positive(text,16,8).toFixed(8);}
export function parseUsdt(text:string){return positive(text,18,6).toFixed(6);}
export function normalizeCostMoney(input:{amount:string;currency:string;rate?:string}){
 const currency=cashCurrency(input.currency),amount=parseOriginalMoney(input.amount);
 if(currency!=='USDT'&&!input.rate)invalid();
 const rate=positive(input.rate??'1',12,12);
 if(currency==='USDT'&&!rate.eq(1))invalid();
 const usdt=new CashDecimal(amount).div(rate).toFixed(6);
 parseUsdt(usdt);
 return {amount,currency,rate:rate.toFixed(12),usdt};
}
export function allocateUsdt(net:string,partners:{name:string;percentage:string}[]){
 if(!/^-?(0|[1-9]\d{0,19})(\.\d{1,6})?$/.test(net)||!partners.length||partners.length>100||new Set(partners.map(p=>p.name.trim())).size!==partners.length)invalid();
 const bps=partners.map(p=>{if(!p.name.trim()||!/^(0|[1-9]\d{0,2})(\.\d{1,2})?$/.test(p.percentage))invalid();const pct=new CashDecimal(p.percentage);if(pct.gt(100))invalid();return BigInt(pct.mul(100).toFixed(0));});
 if(bps.reduce((a,b)=>a+b,BigInt(0))!==BigInt(10000))invalid();
 const negative=new CashDecimal(net).lt(0),total=BigInt(new CashDecimal(net).abs().mul(1000000).toFixed(0));
 const shares=bps.map((bp,index)=>({index,value:total*bp/BigInt(10000),remainder:total*bp%BigInt(10000)}));
 const remainder=total-shares.reduce((a,b)=>a+b.value,BigInt(0));
 const ordered=[...shares].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1);
 for(let i=0;i<Number(remainder);i++)ordered[i].value++;
 return partners.map((p,index)=>({name:p.name.trim(),percentage:new CashDecimal(p.percentage).toFixed(2),amount:new CashDecimal(shares[index].value.toString()).div(1000000).mul(negative?-1:1).toFixed(6)}));
}
