import React, {act} from 'react';
import {JSDOM} from 'jsdom';
import type {Root} from 'react-dom/client';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import type {ManagedVM} from '@/components/vm-management/shared';
import type {OpsRow} from '@/components/vm-management/vm-grid/OpsCells';
import type {VmAccount} from '@/components/vm-management/vm-grid/AccountCell';

const mock = vi.hoisted(() => ({pick: vi.fn(), query: vi.fn(), request: vi.fn(), update: vi.fn(), receipt: vi.fn()}));
vi.mock('@/lib/trpc', () => ({trpc: {
  useContext: () => ({vmOps: {payoutPick: {fetch: mock.pick}}}),
  vmOps: {
    payoutPick: {useQuery: mock.query},
    requestPayout: {useMutation: () => ({mutateAsync: mock.request, isLoading: false})},
    updatePayout: {useMutation: () => ({mutateAsync: mock.update})},
    payoutReceipt: {useMutation: () => ({mutateAsync: mock.receipt})},
    editPayout: {useMutation: () => ({mutateAsync: vi.fn()})},
    unsendPayout: {useMutation: () => ({mutateAsync: vi.fn()})},
    voidPayout: {useMutation: () => ({mutateAsync: vi.fn()})},
    suspendEarnApp: {useMutation: () => ({mutateAsync: vi.fn()})},
    balanceRecord: {useMutation: () => ({})},
    balanceHistory: {useQuery: () => ({data: undefined})},
  },
}}));
vi.mock('react-hot-toast', () => ({default: {success: vi.fn()}}));
import {PayoutBulkPanel} from '@/components/vm-management/vm-grid/PayoutBulkPanel';
import {PayoutCell} from '@/components/vm-management/vm-grid/OpsCells';

const daily = (used = 0, reserved = 0) => ({date: '2026-10-26', timeZone: 'Asia/Ho_Chi_Minh', limit: 2, used, reserved, remaining: Math.max(0, 2-used-reserved)});
const paypal = (used = 0, reserved = 0) => ({
  id: 'pp', code: 'PP1', status: 'ACTIVE', usable: used+reserved<2, unused: 3,
  balanceUsd: null, pendingUsd: null, heldUsd: '0.00', daily: daily(used, reserved),
  emails: ['e1', 'e2', 'e3'].map(id => ({id, email: id+'@example.invalid', own: false, dailyAllowed: used+reserved<2, dailyOccupied: false})),
});
const pick = (id = '1', pp = paypal()) => ({
  vm: {id, where: 'An-01 / VM_'+id},
  earnApp: {id: 'acc'+id, login: 'acc'+id+'@example.invalid', emailId: null as string|null, email: null as string|null},
  paypals: [pp], suggestion: null as {paypalId: string; why: string}|null,
  rights: {money: false, balance: false, prepareOnly: true},
});
const vm = (id: string): ManagedVM => ({id, code: 'VM_'+id, server: 'An-01', serverId: 'server', revision: 2, sdks: [], archivedAt: null, notes: null, slotState: 'BLANK', cycle: 1, ops: null, opsRevision: 0, applyPending: false, applyPendingAt: null, job: null, sdk: null, desired: null, installed: null, holds: []});
const ops = (id: string) => ({vmId: id, cycle: 1, earnAppId: 'acc'+id, request: null, status: null, balance: {latest: null, lastOk: null}}) as OpsRow;
const rights = {assign: false, money: false, writeMoney: false, payout: true};
let dom: JSDOM, root: Root, host: HTMLDivElement, single: ReturnType<typeof pick>;
beforeEach(async () => {
  dom = new JSDOM('<html><body></body></html>', {url: 'https://example.invalid'});
  for (const [key, value] of Object.entries({React, window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true})) vi.stubGlobal(key, value);
  const {createRoot} = await import('react-dom/client');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  single = pick();
  mock.query.mockReset().mockImplementation(() => ({data: single, error: null}));
  mock.pick.mockReset().mockImplementation(async ({vmId}: {vmId: string}) => pick(vmId));
  mock.request.mockReset().mockResolvedValue({});
});
afterEach(async () => {await act(async () => root.unmount()); dom.window.close(); vi.unstubAllGlobals();});
const bulk = (ids = ['1', '2', '3']) => act(async () => root.render(<PayoutBulkPanel projectId="p" userId="u" vms={ids.map(vm)} opsOf={ops} rights={rights} onSaved={() => {}} onBusy={() => {}}/>));
const cell = () => act(async () => root.render(<PayoutCell projectId="p" userId="u" vm={vm('1')} ops={ops('1')} account={{earnApp: {id: 'acc1', login: {email: 'acc1@example.invalid'}}} as VmAccount} rights={rights} onDone={() => {}} onBusy={() => {}}/>));
const select = (id: string) => document.querySelector<HTMLSelectElement>('[aria-label="Email PP An-01 / VM_'+id+'"]')!;
const option = (id: string, email: string) => Array.from(select(id).options).find(o => o.value===email)!;
const save = () => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.startsWith('Rút '))!;
async function change(el: HTMLInputElement|HTMLSelectElement, value: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(el.tagName==='SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input', {bubbles: true}));
  });
}
// One-click "Rút" (owner 28/10/2026): the cell frame reads the picker once and holds the chosen email in the same click.
async function withdrawCell(amount = '10') {
  mock.pick.mockImplementation(async () => single);
  await cell();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click());
  await change(document.querySelector<HTMLInputElement>('input[aria-label="Số tiền rút"]')!, amount);
  await act(async () => Array.from(document.querySelectorAll('button')).find(b => b.textContent==='Rút')!.click());
}

it('disables the third distinct email in a bulk draft and releases local capacity without clearing amounts', async () => {
  await bulk();
  await change(select('1'), 'e1'); await change(select('2'), 'e2');
  await change(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_3"]')!, '14');
  expect(option('3', 'e3').disabled).toBe(true);
  await change(select('2'), '');
  expect(option('3', 'e3').disabled).toBe(false);
  expect(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_3"]')!.value).toBe('14');
});

it.each([[1, 0], [0, 1]])('counts existing used=%i reserved=%i before allowing local bulk selections', async (used, reserved) => {
  mock.pick.mockImplementation(async ({vmId}: {vmId: string}) => pick(vmId, paypal(used, reserved)));
  await bulk(); await change(select('1'), 'e1');
  expect(option('2', 'e2').disabled).toBe(true);
  expect(host.textContent).toContain('Hôm nay 1/2 email');
  expect(host.textContent).toContain('giờ Việt Nam');
});

it('retains daily-blocked options and prevents a forced blocked selection from submitting', async () => {
  mock.pick.mockImplementation(async ({vmId}: {vmId: string}) => pick(vmId, paypal(1, 1)));
  await bulk(['1']);
  expect(option('1', 'e1')).toBeTruthy(); expect(option('1', 'e1').disabled).toBe(true);
  await change(select('1'), 'e1');
  await change(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_1"]')!, '10');
  expect(save().disabled).toBe(true);
  await act(async () => save().click()); expect(mock.request).not.toHaveBeenCalled();
});

it('keeps a blocked own email fixed in bulk even when another PayPal is usable', async () => {
  mock.pick.mockImplementation(async ({vmId}: {vmId: string}) => {
    const result = pick(vmId, paypal(1, 1)); result.earnApp.emailId = 'e1'; result.paypals[0].emails[0].own = true;
    result.paypals.push({...paypal(), id: 'pp2', code: 'PP2', emails: [{id: 'other', email: 'other@example.invalid', own: false, dailyAllowed: true, dailyOccupied: false}]});
    return result;
  });
  await bulk(['1']);
  expect(select('1').value).toBe('e1'); expect(select('1').disabled).toBe(true);
  expect(save().disabled).toBe(true); expect(host.textContent).toContain('Hôm nay 2/2 email');
});



it('keeps successful rows occupying local quota until the batch closes', async () => {
  await bulk();
  for (const id of ['1', '2']) {
    await change(select(id), 'e'+id);
    await change(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_'+id+'"]')!, '10');
  }
  await act(async () => save().click());
  expect(mock.request).toHaveBeenCalledTimes(2);
  expect(option('3', 'e3').disabled).toBe(true);
});

it('uses the tighter capacity when sequential picker reads see different occupancy', async () => {
  mock.pick.mockImplementation(async ({vmId}: {vmId: string}) => pick(vmId, paypal(vmId==='1'?0:1)));
  await bulk(['1', '2']); await change(select('2'), 'e2');
  expect(option('1', 'e1').disabled).toBe(true);
});

it('does not let a forced third draft selection submit or erase the entered amount', async () => {
  await bulk(); await change(select('1'), 'e1'); await change(select('2'), 'e2');
  await change(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_3"]')!, '14');
  await change(select('3'), 'e3');
  expect(select('3').value).toBe(''); expect(save().disabled).toBe(true);
  expect(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_3"]')!.value).toBe('14');
  expect(mock.request).not.toHaveBeenCalled();
});

it('keeps each PayPal capacity independent and does not reveal hidden balances', async () => {
  mock.pick.mockImplementation(async ({vmId}: {vmId: string}) => {
    const result = pick(vmId);
    result.paypals.push({...paypal(), id: 'pp2', code: 'PP2', emails: [{id: 'other', email: 'other@example.invalid', own: false, dailyAllowed: true, dailyOccupied: false}]});
    return result;
  });
  await bulk(); await change(select('1'), 'e1'); await change(select('2'), 'e2');
  expect(option('3', 'e3').disabled).toBe(true); expect(option('3', 'other').disabled).toBe(false);
  expect(Array.from(select('3').options).some(o=>o.textContent?.includes('$'))).toBe(false);
});

it('retains the bulk draft and server refusal when another operator fills the quota', async () => {
  mock.request.mockRejectedValueOnce(Object.assign(new Error('PAYPAL_DAILY_LIMIT: hết lượt hôm nay'), {data: {code: 'CONFLICT'}}));
  await bulk(['1']); await change(select('1'), 'e1');
  await change(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_1"]')!, '12');
  await act(async () => save().click());
  expect(select('1').value).toBe('e1'); expect(host.textContent).toContain('PAYPAL_DAILY_LIMIT');
  expect(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_1"]')!.value).toBe('12');
});



it('does not count an already occupied own email twice against the bulk remaining slot', async () => {
  mock.pick.mockImplementation(async ({vmId}: {vmId: string}) => {
    const result = pick(vmId, paypal(0, 1));
    if(vmId==='1') {
      result.earnApp.emailId='e1';
      result.paypals[0].emails[0]={...result.paypals[0].emails[0], own:true, dailyOccupied:true};
    }
    return result;
  });
  await bulk();
  expect(select('1').value).toBe('e1'); expect(option('2', 'e2').disabled).toBe(false);
  await change(select('2'), 'e2');
  expect(option('3', 'e3').disabled).toBe(true);
  for(const id of ['1','2']) await change(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_'+id+'"]')!, '10');
  expect(save().textContent).toBe('Rút 2 VM');
});

it('keeps three fixed own drafts but only admits the first two new emails for this day', async () => {
  mock.pick.mockImplementation(async ({vmId}: {vmId: string}) => {
    const result = pick(vmId); result.earnApp.emailId='e'+vmId;
    result.paypals[0].emails.find(e=>e.id==='e'+vmId)!.own=true;
    return result;
  });
  await bulk();
  for(const id of ['1','2','3']) await change(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_'+id+'"]')!, '10');
  expect(save().textContent).toBe('Rút 2 VM');
  expect(select('3').value).toBe('e3'); expect(select('3').disabled).toBe(true);
  await act(async () => save().click());
  expect(mock.request.mock.calls.map(([body])=>body.vmId)).toEqual(['1','2']);
  expect(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_3"]')!.value).toBe('10');
});

it('never infers an occupied slot from zero remaining in a partial legacy response', async () => {
  mock.pick.mockImplementation(async ({vmId}: {vmId: string}) => {
    const result = pick(vmId, paypal(2)); result.earnApp.emailId='e1'; result.paypals[0].usable=true;
    const {dailyOccupied: _occupied, ...email}=result.paypals[0].emails[0];
    return {...result, paypals:[{...result.paypals[0], emails:[{...email, own:true, dailyAllowed:true}]}]};
  });
  await bulk(['1']); await change(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_1"]')!, '10');
  expect(save().disabled).toBe(true); expect(select('1').value).toBe('e1');
});

it('blocks an occupied but disallowed legacy overbooking in bulk without switching the bound email', async () => {
  mock.pick.mockImplementation(async ({vmId}: {vmId: string}) => {
    const result = pick(vmId, paypal(0, 3)); result.earnApp.emailId='e1'; result.paypals[0].usable=true;
    result.paypals[0].emails[0]={...result.paypals[0].emails[0], own:true, dailyOccupied:true, dailyAllowed:false};
    result.paypals[0].emails[1]={...result.paypals[0].emails[1], dailyOccupied:true, dailyAllowed:true};
    return result;
  });
  await bulk(['1']); await change(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_1"]')!, '10');
  expect(save().disabled).toBe(true); expect(select('1').value).toBe('e1'); expect(select('1').disabled).toBe(true);
  expect(option('1','e1').disabled).toBe(true); expect(host.textContent).toContain('Hôm nay 3/2 email');
  await act(async () => save().click()); expect(mock.request).not.toHaveBeenCalled();
});


it.each(['revision','cycle','account'] as const)('releases stale unsent fixed-email slots after a live %s refresh without editing drafts', async kind => {
  mock.pick.mockImplementation(async ({vmId}: {vmId:string}) => {
    const result=pick(vmId); result.earnApp.emailId='e'+vmId;
    result.paypals[0].emails.find(e=>e.id==='e'+vmId)!.own=true;
    return result;
  });
  const liveVms=['1','2','3'].map(vm);
  let refreshed=false;
  const liveOps=(id:string)=>({...ops(id),...(refreshed&&id!=='3'&&kind==='cycle'?{cycle:2}:{}),...(refreshed&&id!=='3'&&kind==='account'?{earnAppId:'new-'+id}:{})});
  const render=()=>act(async()=>root.render(<PayoutBulkPanel projectId="p" userId="u" vms={liveVms} opsOf={liveOps} rights={rights} onSaved={()=>{}} onBusy={()=>{}}/>));
  await render();
  for(const id of ['1','2','3']) await change(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_'+id+'"]')!, '10');
  expect(save().textContent).toBe('Rút 2 VM');
  refreshed=true;
  if(kind==='revision') {liveVms[0]={...liveVms[0],revision:3};liveVms[1]={...liveVms[1],revision:3};}
  await render();
  expect(save().textContent).toBe('Rút 1 VM'); expect(save().disabled).toBe(false);
  expect(select('3').value).toBe('e3');
  expect(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_3"]')!.value).toBe('10');
  await act(async()=>save().click());
  expect(mock.request.mock.calls.map(([body])=>body.vmId)).toEqual(['3']);
});

it('releases duplicate-email ownership held only by a definitively stale unsent draft', async()=>{
  await bulk(['1','2']); await change(select('1'),'e1');
  expect(option('2','e1').disabled).toBe(true);
  await act(async()=>root.render(<PayoutBulkPanel projectId="p" userId="u" vms={[{...vm('1'),revision:3},vm('2')]} opsOf={ops} rights={rights} onSaved={()=>{}} onBusy={()=>{}}/>));
  expect(option('2','e1').disabled).toBe(false);
  await change(select('2'),'e1'); await change(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_2"]')!,'10');
  expect(save().disabled).toBe(false);
  await act(async()=>save().click()); expect(mock.request.mock.calls.map(([body])=>body.vmId)).toEqual(['2']);
});

it.each(['done','unknown'] as const)('retains %s command occupancy and duplicate ownership after a live revision refresh', async outcome=>{
  if(outcome==='unknown') mock.request.mockRejectedValue(new Error('502'));
  await bulk();
  for(const id of ['1','2']) {
    await change(select(id),'e'+id);
    await change(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_'+id+'"]')!,'10');
  }
  await act(async()=>save().click()); expect(mock.request).toHaveBeenCalledTimes(2);
  await act(async()=>root.render(<PayoutBulkPanel projectId="p" userId="u" vms={[{...vm('1'),revision:3},{...vm('2'),revision:3},vm('3')]} opsOf={ops} rights={rights} onSaved={()=>{}} onBusy={()=>{}}/>));
  expect(option('3','e1').disabled).toBe(true); expect(option('3','e3').disabled).toBe(true);
});

it('retains an in-flight command slot and email ownership when its VM becomes stale', async()=>{
  let resolveRequest: ((value:object)=>void)|undefined;
  mock.request.mockImplementation(()=>new Promise<object>(resolve=>{resolveRequest=resolve;}));
  mock.pick.mockImplementation(async({vmId}:{vmId:string})=>pick(vmId,paypal(1)));
  await bulk(['1','2']); await change(select('1'),'e1');
  await change(document.querySelector<HTMLInputElement>('[aria-label="Số tiền An-01 / VM_1"]')!,'10');
  await act(async()=>save().click()); expect(mock.request).toHaveBeenCalledTimes(1);
  await act(async()=>root.render(<PayoutBulkPanel projectId="p" userId="u" vms={[{...vm('1'),revision:3},vm('2')]} opsOf={ops} rights={rights} onSaved={()=>{}} onBusy={()=>{}}/>));
  expect(option('2','e1').disabled).toBe(true); expect(option('2','e2').disabled).toBe(true);
  await act(async()=>resolveRequest!({}));
});

it('one-click Rút holds nothing when the suggested PayPal is full today', async () => {
  single = pick('1', paypal(1, 1)); single.suggestion = null;
  await withdrawCell();
  expect(mock.request).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('Không còn PayPal có email trống dùng được hôm nay');
});

it('one-click Rút never switches a blocked bound email to a suggested PayPal', async () => {
  single = pick('1', paypal(2)); single.earnApp.emailId = 'e1'; single.paypals[0].emails[0].own = true; single.paypals[0].emails[0].dailyAllowed = false;
  single.paypals.push({...paypal(), id: 'pp2', code: 'PP2'}); single.suggestion = {paypalId: 'pp2', why: 'synthetic stale suggestion'};
  await withdrawCell();
  expect(mock.request).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('Email đã gắn với EarnApp này hết lượt hôm nay');
});

it('one-click Rút takes an allowed email of the suggestion rather than the first blocked one, as PREPARING', async () => {
  single.paypals[0].emails[0].dailyAllowed = false; single.suggestion = {paypalId: 'pp', why: 'synthetic'};
  await withdrawCell('10.5');
  expect(mock.request).toHaveBeenCalledTimes(1);
  expect(mock.request.mock.calls[0][0]).toMatchObject({projectId: 'p', vmId: '1', expectedCycle: 1, earnAppId: 'acc1', paypalEmailId: 'e2', amount: '10.5', currency: 'USD', submission: 'PREPARING'});
});

it('one-click Rút permits a server-allowed own email already counted in a full daily quota', async () => {
  single = pick('1', paypal(1, 1)); single.earnApp.emailId = 'e1';
  single.paypals[0].usable = true; single.paypals[0].emails[0] = {...single.paypals[0].emails[0], own: true, dailyAllowed: true, dailyOccupied: true};
  await withdrawCell();
  expect(mock.request.mock.calls[0][0]).toMatchObject({paypalEmailId: 'e1', submission: 'PREPARING'});
});

it('one-click Rút refuses an occupied but disallowed legacy overbooking of the bound email', async () => {
  single=pick('1',paypal(0,3)); single.earnApp.emailId='e1'; single.paypals[0].usable=true;
  single.paypals[0].emails[0]={...single.paypals[0].emails[0],own:true,dailyOccupied:true,dailyAllowed:false};
  single.paypals[0].emails[1]={...single.paypals[0].emails[1],dailyOccupied:true,dailyAllowed:true};
  await withdrawCell();
  expect(mock.request).not.toHaveBeenCalled();
});
