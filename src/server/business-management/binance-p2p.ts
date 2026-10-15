import {encrypt,decrypt} from '@/lib/encryption';
import {CashDecimal,cashCurrency} from './usdt-money';
import {ProxyDomainError} from '../proxy-management/types';
export type P2PQuote={fiat:string;side:'BUY'|'SELL';rate:string;fetchedAt:string;source:'BINANCE_P2P'};
const unavailable=()=>new ProxyDomainError('SOURCE_UNAVAILABLE','Chưa lấy được giá Binance P2P. Thử lại hoặc nhập tỷ giá đã kiểm chứng.');
export async function fetchP2PQuote(fiat:string,side:'BUY'|'SELL',fetcher:typeof fetch=fetch,now=new Date()):Promise<P2PQuote>{
 fiat=cashCurrency(fiat);if(fiat==='USDT'||!['BUY','SELL'].includes(side))throw new ProxyDomainError('INVALID_INPUT');
 const url=new URL('https://www.binance.com/bapi/c2c/v1/public/c2c/agent/quote-price');url.search=new URLSearchParams({fiat,asset:'USDT',tradeType:side}).toString();
 try{
  const response=await fetcher(url,{headers:{'User-Agent':'bdops-price-reference/1.0'},signal:AbortSignal.timeout(5000),redirect:'error',cache:'no-store'});if(!response.ok)throw unavailable();
  const text=await response.text();if(text.length>100000)throw unavailable();const body=JSON.parse(text),prices=Array.from(text.matchAll(/"price"\s*:\s*"?(0|[1-9]\d*)(\.\d+)?"?\s*[,}]/g));
  if(body.code!=='000000'||body.success!==true||body.data?.fiat!==fiat||body.data?.asset!=='USDT'||prices.length!==1)throw unavailable();
  const raw=prices[0][1]+(prices[0][2]??'');if(!/^(0|[1-9]\d{0,11})(\.\d{1,12})?$/.test(raw)||!new CashDecimal(raw).gt(0))throw unavailable();
  return {fiat,side,rate:new CashDecimal(raw).toFixed(12),fetchedAt:now.toISOString(),source:'BINANCE_P2P'};
 }catch{throw unavailable();}
}
export function sealP2PQuote(quote:P2PQuote,scope:{projectId:string;userId:string}){return encrypt(JSON.stringify({...quote,projectId:scope.projectId,userId:scope.userId}));}
export function verifyP2PQuote(token:string,scope:{projectId:string;userId:string},currency:string,rate:string,now=new Date()):P2PQuote{
 try{const q=JSON.parse(decrypt(token)) as P2PQuote&{projectId:string;userId:string},age=now.getTime()-new Date(q.fetchedAt).getTime();
  if(q.projectId!==scope.projectId||q.userId!==scope.userId||q.fiat!==currency||q.source!=='BINANCE_P2P'||!['BUY','SELL'].includes(q.side)||!Number.isFinite(age)||age<0||age>600000||!new CashDecimal(q.rate).eq(rate))throw Error();return q;
 }catch{throw new ProxyDomainError('INVALID_INPUT','Giá Binance đã hết hạn hoặc được sửa; lấy lại giá để xác nhận');}
}
