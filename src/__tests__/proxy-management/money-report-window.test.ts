import {it,expect} from 'vitest';
import {businessPulse,type PulseInput} from '@/lib/business-pulse';
// 28/10/2026 daily 10:00 Telegram report: the trend window is the last 24 h, not "today since 00:00 Vietnam".
const now=new Date('2026-10-28T03:00:00Z');
const vm=(x:Partial<PulseInput>={}):PulseInput=>({id:'v1',serverId:'s1',server:'MOON-02',code:'VM_001',cycle:1,status:'OK',hasAccount:true,hasPaypal:true,payout:false,money:{amount:'5',observedAt:'2026-10-28T02:30:00Z',failedAt:null},points:[],health:null,...x});
it('a 24 h window sees yesterday evening readings that the Vietnam-day window ignores',()=>{
 const points=[{at:'2026-10-27T05:00:00Z',amount:'4'},{at:'2026-10-27T12:00:00Z',amount:'5'},{at:'2026-10-28T02:30:00Z',amount:'5'}];
 const today=businessPulse([vm({points})],true,now);
 const day24=businessPulse([vm({points})],true,now,new Date(now.getTime()-24*3600e3));
 expect(today.rows[0].trend).toBe('UNKNOWN');           // only one reading since 00:00 VN (17:00 UTC)
 expect(day24.rows[0].trend).toBe('INCREASING');expect(day24.rows[0].delta).toBe('1');
 const flat=businessPulse([vm({points:points.map(p=>({...p,amount:'5'}))})],true,now,new Date(now.getTime()-24*3600e3));
 expect(flat.rows[0].trend).toBe('FLAT');
});
