import {it,expect} from 'vitest';
import {fetchP2PQuote,sealP2PQuote,verifyP2PQuote} from '@/server/business-management/binance-p2p';
it('uses the requested P2P side, validates the response and freezes a scoped quote',async()=>{
 let requested='';const fetcher=async(input: string|URL|Request)=>{requested=String(input);return new Response('{"code":"000000","success":true,"data":{"asset":"USDT","fiat":"VND","price":25936}}');};
 const now=new Date('2026-10-15T00:00:00Z'),q=await fetchP2PQuote('VND','BUY',fetcher as typeof fetch,now);
 expect(new URL(requested).searchParams.get('tradeType')).toBe('BUY');expect(q.rate).toBe('25936.000000000000');
 const token=sealP2PQuote(q,{projectId:'p',userId:'u'});expect(verifyP2PQuote(token,{projectId:'p',userId:'u'},'VND','25936',now).side).toBe('BUY');
 expect(()=>verifyP2PQuote(token,{projectId:'other',userId:'u'},'VND','25936',now)).toThrow();
 expect(()=>verifyP2PQuote(token,{projectId:'p',userId:'u'},'VND','1',now)).toThrow();
 expect(()=>verifyP2PQuote(token,{projectId:'p',userId:'u'},'VND','25936',new Date('2026-10-15T01:00:00Z'))).toThrow();
 await expect(fetchP2PQuote('VND','BUY',(async()=>new Response('<html>blocked</html>',{status:403})) as typeof fetch)).rejects.toThrow();
 await expect(fetchP2PQuote('VND','SELL',(async()=>new Response('{"success":true,"code":"000000","data":{"asset":"USDT","fiat":"USD","price":"1"}}')) as typeof fetch)).rejects.toThrow();
});
