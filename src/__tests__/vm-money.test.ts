import {describe,expect,it} from 'vitest';
import {relativeTime,vmMoneySortKey,vmMoneyState,vmMoneySummary} from '@/lib/vm-money';
// Tiền VM (owner brief 22/10/2026): the current SDK code's money at the row — states, sorts and the total, all pure.
const now=new Date('2026-10-22T10:00:00Z'),h=(n:number)=>new Date(now.getTime()-n*3600e3).toISOString();
const src=(o:Partial<{amount:string|null;observedAt:string|null;failedAt:string|null;moneyHidden:boolean;stored:{amount:string|null;observedAt:string|null;cycle:number|null;vmId:string|null}|null}>)=>({code:'SDKAAAA0001',amount:'0.21',observedAt:h(1),failedAt:null,moneyHidden:false,...o});
describe('vmMoneyState',()=>{
  it('no current code or no figure = Chưa kiểm tra (never $0); a hidden figure = Ẩn',()=>{
    expect(vmMoneyState(null,now)).toEqual({kind:'UNCHECKED',code:null,stored:null});
    expect(vmMoneyState(src({amount:null,observedAt:null}),now)).toEqual({kind:'UNCHECKED',code:'SDKAAAA0001',stored:null});
    // A figure read in an earlier round / on another VM is history: the row is unchecked, the frame may say what the code holds.
    expect(vmMoneyState(src({amount:null,observedAt:null,stored:{amount:'12.34',observedAt:h(5),cycle:1,vmId:'vm-old'}}),now)).toEqual({kind:'UNCHECKED',code:'SDKAAAA0001',stored:{amount:'12.34',observedAt:h(5),cycle:1,vmId:'vm-old'}});
    expect(vmMoneyState(src({moneyHidden:true}),now).kind).toBe('HIDDEN');
  });
  it('$0 is a figure; 24 h makes it Số cũ; money without an observation time is Chưa rõ giờ (never the write time)',()=>{
    expect(vmMoneyState(src({amount:'0'}),now)).toMatchObject({kind:'OK',amount:'0',at:h(1)});
    expect(vmMoneyState(src({observedAt:h(25)}),now).kind).toBe('STALE');
    expect(vmMoneyState(src({observedAt:h(23)}),now).kind).toBe('OK');
    expect(vmMoneyState(src({observedAt:null}),now)).toMatchObject({kind:'NO_TIME',amount:'0.21',at:null});
  });
  it('a failed reading after the last good one keeps the good figure and its own time under Kiểm tra lỗi; an older failure is ignored',()=>{
    expect(vmMoneyState(src({failedAt:h(0.5)}),now)).toMatchObject({kind:'FAILED',amount:'0.21',at:h(1),failedAt:h(0.5),stale:false});
    expect(vmMoneyState(src({failedAt:h(2)}),now).kind).toBe('OK');
    expect(vmMoneyState(src({amount:null,observedAt:null,failedAt:h(0.5)}),now)).toMatchObject({kind:'FAILED',amount:null,at:null});
    expect(vmMoneyState(src({observedAt:h(30),failedAt:h(0.5)}),now)).toMatchObject({kind:'FAILED',stale:true});
  });
});
describe('sorts and the total',()=>{
  it('unknown figures sort after every known one; unknown times after every known time',()=>{
    const ok=vmMoneyState(src({amount:'5'}),now),zero=vmMoneyState(src({amount:'0'}),now),none=vmMoneyState(null,now),noTime=vmMoneyState(src({observedAt:null}),now);
    expect(vmMoneySortKey('BALANCE',ok)).toBeLessThan(vmMoneySortKey('BALANCE',zero));
    expect(vmMoneySortKey('BALANCE',zero)).toBeLessThan(vmMoneySortKey('BALANCE',none));
    expect(vmMoneySortKey('CHECKED_OLD',vmMoneyState(src({observedAt:h(5)}),now))).toBeLessThan(vmMoneySortKey('CHECKED_OLD',ok));
    expect(vmMoneySortKey('CHECKED_OLD',noTime)).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('the total adds checked figures exactly (6 decimals) and counts the rest apart',()=>{
    const s=vmMoneySummary([vmMoneyState(src({amount:'0.21'}),now),vmMoneyState(src({amount:'22.56'}),now),vmMoneyState(src({amount:'0.000001',observedAt:h(30)}),now),vmMoneyState(src({failedAt:h(0.1)}),now),vmMoneyState(null,now),vmMoneyState(src({observedAt:null}),now),vmMoneyState(src({moneyHidden:true}),now)]);
    expect(s).toEqual({total:'23.190001',checked:5,unchecked:1,stale:1,failed:1,noTime:1,hidden:1});
  });
  it('relative time reads naturally',()=>{
    expect(relativeTime(h(0),now)).toBe('vừa xong');expect(relativeTime(new Date(now.getTime()-10*60e3).toISOString(),now)).toBe('10 phút trước');
    expect(relativeTime(h(3),now)).toBe('3 giờ trước');expect(relativeTime(h(72),now)).toBe('3 ngày trước');
  });
});
