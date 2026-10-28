import {describe,expect,it} from 'vitest';
import {payoutActions,pickPayoutEmail,receiptCheck,defaultPayoutAmount,frameJournalKey,readFrameCommand,bangkokDay,requestHasReceipts,type FrameView} from '@/components/vm-management/vm-grid/payout-frame-model';
// One payout frame (owner 28/10/2026): which buttons a request shows, the suggested email of "Rút", the exact PayPal amount of
// "Tiền đã về" and the lost-answer journal. Pure functions, no DB.
const all={writeMoney:true,payout:true,receipt:true,assign:true};
const view=(o:Partial<FrameView>={}):FrameView=>({phase:'WAITING',submission:'PREPARING',state:'REQUESTED',hasReceipts:false,consumed:false,rights:all,...o});
describe('payoutActions: request state → buttons',()=>{
  it('no request: nothing (the "Rút" button sits at the Tiền VM cell)',()=>{expect(payoutActions(null)).toEqual([]);});
  it('PREPARING: Đã rút, Bỏ, Sửa, EarnApp bị SUS',()=>{expect(payoutActions(view())).toEqual(['SEND','DROP','EDIT','SUS']);});
  it('SENT, waiting, no receipt yet',()=>{expect(payoutActions(view({submission:'SENT'}))).toEqual(['RECEIPT','EDIT','UNSEND','SUS','FAIL']);});
  it('FAILED / CANCELLED: only Gửi lại',()=>{
    expect(payoutActions(view({submission:'SENT',state:'FAILED',phase:'FAILED'}))).toEqual(['RETRY']);
    expect(payoutActions(view({submission:'SENT',state:'CANCELLED',phase:'CANCELLED'}))).toEqual(['RETRY']);
  });
  it('SENT with a receipt, still short: Tiền đã về, Chốt nhận thiếu (money write) and SUS',()=>{
    expect(payoutActions(view({submission:'SENT',hasReceipts:true}))).toEqual(['RECEIPT','SETTLE','SUS']);
    expect(payoutActions(view({submission:'SENT',hasReceipts:true,rights:{writeMoney:false,payout:true,receipt:true,assign:true}}))).toEqual(['RECEIPT','SUS']);
  });
  it('REVIEW (received over / other currency): only Thất bại with the money write right',()=>{
    expect(payoutActions(view({submission:'SENT',phase:'REVIEW',hasReceipts:true}))).toEqual(['FAIL']);
    expect(payoutActions(view({submission:'SENT',phase:'REVIEW',hasReceipts:true,rights:{writeMoney:false,payout:true,receipt:true,assign:true}}))).toEqual([]);
  });
  it('RECEIVED: nothing; LOST (Mất do SUS): only late money',()=>{
    expect(payoutActions(view({submission:'SENT',phase:'RECEIVED',hasReceipts:true}))).toEqual([]);
    expect(payoutActions(view({submission:'SENT',state:'LOST_SUS',phase:'LOST'}))).toEqual(['RECEIPT']);
  });
  it('a request already used for recreating the VM offers nothing',()=>{expect(payoutActions(view({submission:'SENT',phase:'RECEIVED',consumed:true}))).toEqual([]);});
  it('UNKNOWN (lost answer of the AI): confirm or fix, never money in',()=>{expect(payoutActions(view({submission:'UNKNOWN'}))).toEqual(['SEND','EDIT','UNSEND','SUS','FAIL']);});
  it('without the money write right: no EDIT / UNSEND / VOID / FAIL / RETRY; receipts stay with the receipt right',()=>{
    const narrow={writeMoney:false,payout:true,receipt:true,assign:true};
    expect(payoutActions(view({rights:narrow}))).toEqual(['SEND','DROP','SUS']);
    expect(payoutActions(view({submission:'SENT',rights:narrow}))).toEqual(['RECEIPT','SUS']);
    expect(payoutActions(view({submission:'SENT',state:'FAILED',phase:'FAILED',rights:narrow}))).toEqual([]);
    for(const v of [view({rights:narrow}),view({submission:'SENT',rights:narrow}),view({submission:'UNKNOWN',rights:narrow})])
      for(const a of ['EDIT','UNSEND','VOID','FAIL','RETRY','SETTLE'] as const)expect(payoutActions(v)).not.toContain(a);
  });
  it('SUS needs the assign right; Đã rút / Bỏ need payout or money write; Tiền đã về needs the receipt right',()=>{
    expect(payoutActions(view({rights:{...all,assign:false}}))).toEqual(['SEND','DROP','EDIT']);
    expect(payoutActions(view({rights:{writeMoney:false,payout:false,receipt:true,assign:false}}))).toEqual([]);
    expect(payoutActions(view({submission:'SENT',rights:{writeMoney:false,payout:false,receipt:true,assign:false}}))).toEqual(['RECEIPT']);
    expect(payoutActions(view({submission:'SENT',rights:{writeMoney:true,payout:true,receipt:false,assign:true}}))).toEqual(['EDIT','UNSEND','SUS','FAIL']);
  });
});
describe('requestHasReceipts',()=>{
  it('reads received or linked pending money; unknown without money rights',()=>{
    expect(requestHasReceipts({received:'0.00',pendingLinked:'0.00'})).toBe(false);
    expect(requestHasReceipts({received:'4.00',pendingLinked:'0.00'})).toBe(true);
    expect(requestHasReceipts({received:'0.00',pendingLinked:'1.00'})).toBe(true);
    expect(requestHasReceipts(null)).toBe(false);
  });
});
describe('pickPayoutEmail: "Rút" takes the suggestion at once',()=>{
  const pp=(id:string,emails:{id:string;own?:boolean;dailyAllowed?:boolean;dailyOccupied?:boolean}[],usable=true)=>({id,code:id.toUpperCase(),usable,emails:emails.map(e=>({email:e.id+'@example.invalid',own:false,...e}))});
  it('the EarnApp\'s own email wins when allowed today',()=>{
    expect(pickPayoutEmail({earnApp:{emailId:'o'},paypals:[pp('a',[{id:'a1'}]),pp('b',[{id:'o',own:true}])],suggestion:{paypalId:'a'}})).toEqual({emailId:'o'});
  });
  it('a blocked own email is never swapped for another one',()=>{
    const r=pickPayoutEmail({earnApp:{emailId:'o'},paypals:[pp('a',[{id:'a1'}]),pp('b',[{id:'o',own:true,dailyAllowed:false}])],suggestion:null});
    expect(r).toHaveProperty('error');expect('emailId' in r).toBe(false);
  });
  it('otherwise the first email of the suggested PayPal that is allowed today and not occupied',()=>{
    expect(pickPayoutEmail({earnApp:{emailId:null},paypals:[pp('a',[{id:'a1',dailyAllowed:false},{id:'a2',dailyOccupied:true},{id:'a3'}])],suggestion:{paypalId:'a'}})).toEqual({emailId:'a3'});
  });
  it('no suggestion or nothing usable: an error, nothing held',()=>{
    expect(pickPayoutEmail({earnApp:{emailId:null},paypals:[pp('a',[{id:'a1'}])],suggestion:null})).toHaveProperty('error');
    expect(pickPayoutEmail({earnApp:{emailId:null},paypals:[pp('a',[{id:'a1'}],false)],suggestion:{paypalId:'a'}})).toHaveProperty('error');
    expect(pickPayoutEmail({earnApp:null,paypals:[],suggestion:null})).toHaveProperty('error');
  });
});
describe('defaultPayoutAmount: Tiền VM of the current SDK, never rounded up',()=>{
  it('truncates to cents and refuses empty / zero / garbage',()=>{
    expect(defaultPayoutAmount('12.349999')).toBe('12.34');expect(defaultPayoutAmount('5')).toBe('5.00');expect(defaultPayoutAmount('0.5')).toBe('0.50');
    expect(defaultPayoutAmount('0')).toBe('');expect(defaultPayoutAmount(null)).toBe('');expect(defaultPayoutAmount('abc')).toBe('');
  });
});
describe('receiptCheck: "Số tiền chính xác trong PayPal"',()=>{
  const base={amount:'10.00',received:'0.00',remaining:'10.00',pendingLinked:'0.00',lost:null as string|null,phase:'WAITING'};
  it('empty is required, never prefilled',()=>{const r=receiptCheck(base,'');expect(r.valid).toBe(false);expect(r.error).toBe('');expect(r.fee).toBeNull();expect(r.showSettle).toBe(false);});
  it('less than the open part: fee = withdrawn − received, settle offered',()=>{
    const r=receiptCheck(base,'9,62');expect(r).toMatchObject({valid:true,amount:'9.62',fee:'0.38',showSettle:true});
  });
  it('the exact open part: no fee, no settle',()=>{expect(receiptCheck(base,'10')).toMatchObject({valid:true,amount:'10.00',fee:'0.00',showSettle:false});});
  it('more than the open part or malformed: refused with a reason',()=>{
    expect(receiptCheck(base,'10.01')).toMatchObject({valid:false});expect(receiptCheck(base,'10.01').error).toMatch(/vượt/);
    expect(receiptCheck(base,'1.234').valid).toBe(false);expect(receiptCheck(base,'0').valid).toBe(false);expect(receiptCheck(base,'-1').valid).toBe(false);
  });
  it('a second part counts what already arrived and a linked pending receipt',()=>{
    expect(receiptCheck({...base,received:'4.00',remaining:'6.00',pendingLinked:'1.00'},'4.50')).toMatchObject({valid:true,fee:'0.50',showSettle:true,open:'5.00'});
  });
  it('late money after SUS reads the lost amount as the open part',()=>{
    expect(receiptCheck({...base,remaining:'0.00',lost:'10.00',phase:'LOST'},'9.50')).toMatchObject({valid:true,fee:'0.50',showSettle:true,open:'10.00'});
  });
});
describe('lost-answer journal',()=>{
  it('one key per user, project and target',()=>{
    expect(frameJournalKey('p','u','req-1')).toBe(frameJournalKey('p','u','req-1'));
    expect(frameJournalKey('p','u','req-1')).not.toBe(frameJournalKey('p','u2','req-1'));
    expect(frameJournalKey('p','u','req-1')).not.toBe(frameJournalKey('p2','u','req-1'));
  });
  it('reads back only a well-formed command of this project / target',()=>{
    const ok={action:'SEND',target:'req-1',body:{projectId:'p',key:'k-12345678',requestId:'req-1'}};
    expect(readFrameCommand(JSON.stringify(ok),'p','req-1')).toEqual(ok);
    expect(readFrameCommand(JSON.stringify(ok),'p2','req-1')).toBeNull();
    expect(readFrameCommand(JSON.stringify(ok),'p','req-2')).toBeNull();
    expect(readFrameCommand(JSON.stringify({...ok,action:'NOPE'}),'p','req-1')).toBeNull();
    expect(readFrameCommand(JSON.stringify({...ok,body:{projectId:'p'}}),'p','req-1')).toBeNull();
    expect(readFrameCommand('{broken','p','req-1')).toBeNull();expect(readFrameCommand(null,'p','req-1')).toBeNull();
  });
});
describe('bangkokDay',()=>{
  it('is the Asia/Bangkok calendar day',()=>{
    expect(bangkokDay(new Date('2026-10-28T16:59:00Z'))).toBe('2026-10-28');
    expect(bangkokDay(new Date('2026-10-28T17:00:00Z'))).toBe('2026-10-29');
  });
});
