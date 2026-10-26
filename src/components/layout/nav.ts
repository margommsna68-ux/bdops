import {links} from '@/lib/links';
import {capitalName} from '@/lib/utils';
import {moduleOn,type OptionalModule} from '@/lib/features';
import type {AppModule} from '@/server/trpc';
// role: who the target page actually serves. ADMIN = admin only (projects, audit log); MOD = admin, or a moderator granted user
// management (the staff page and its backend refuse other moderators).
// anyModule: the item shows when the member has one of these modules (the page itself serves each part by its own right).
// also: other paths that belong to the item (old URLs kept for compatibility light it up too).
export type NavItem =
  | { href: string; labelKey: string; label?: string; icon: string; module?: AppModule | null; anyModule?: AppModule[]; also?: string[]; role?: "ADMIN" | "MOD"; infraOnly?: boolean; optional?: OptionalModule }
  | { type: "separator"; labelKey: string };
export type NavLinkItem=Extract<NavItem,{href:string}>;
// Money pages: /funds is money arriving in PayPal; /withdrawals is "Nhận USDT về team" when team cash is on (original withdrawals
// under ?view=original), otherwise the original withdrawals/transfers page.
export const moneyItems=(cashMode:boolean):NavItem[]=>cashMode?[
  {href:links.teamReceipts(),labelKey:'Nhận USDT về team',label:'Nhận USDT về team',icon:'T',module:'WITHDRAWALS'},
  {href:links.paypalIn(),labelKey:'Tiền vào PayPal',label:'Tiền vào PayPal',icon:'$',module:'FUNDS'},
  {href:links.originalWithdrawals(true),labelKey:'Rút / chuyển gốc',label:'Rút / chuyển gốc',icon:'R',module:'WITHDRAWALS'},
]:[
  {href:links.paypalIn(),labelKey:'Tiền vào PayPal',label:'Tiền vào PayPal',icon:'$',module:'FUNDS'},
  {href:links.originalWithdrawals(false),labelKey:'Rút / chuyển gốc',label:'Rút / chuyển gốc',icon:'R',module:'WITHDRAWALS'},
];
// MoneyToHome (Proxy / VM) menu, owner order: Tổng quan → Kho tài khoản → Kho proxy → Server / VM. Kho tài khoản is one item for Gmail / Apple ID and PayPal (Lịch sử nhập kho and Cần đối chiếu inside it); /paypals stays
// as its PayPal tab. Giao việc shows only when switched on in src/lib/features.ts. Việc cài proxy is gone (19/10/2026: assigning a
// proxy is the record, there is no install step); /vm-tasks only redirects to Server / VM.
export const personalItems=(cashMode:boolean):NavItem[]=>[
  {href:'/dashboard',labelKey:'Tổng quan',icon:'D'},
  {href:'/gmails',labelKey:'Kho tài khoản',icon:'G',anyModule:['INFRASTRUCTURE','PAYPALS'],also:['/paypals']},
  {href:links.proxies(),labelKey:'Kho proxy',icon:'P',module:'INFRASTRUCTURE'},
  {href:links.vms(),labelKey:'Server / VM',icon:'S',module:'INFRASTRUCTURE'},
  {href:'/work',labelKey:'Giao việc',icon:'W',module:'INFRASTRUCTURE',optional:'WORK'},
  {type:'separator',labelKey:'Tài chính'},
  {href:'/earnapp-withdrawals',labelKey:'Rút EarnApp → PayPal',label:'Rút EarnApp → PayPal',icon:'R',module:'FUNDS'},
  ...moneyItems(cashMode),
  {href:'/costs',labelKey:'Chi phí',icon:'C',module:'COSTS'},
  {href:'/profit',labelKey:'Lợi nhuận',icon:'%',module:'PROFIT'},
  {href:'/history',labelKey:'Lịch sử thao tác',icon:'H'},
  {type:'separator',labelKey:'Quản trị'},
  // Phê duyệt lệnh AI (23/10/2026): the ADMIN of the project approves the AI's critical commands with a 2FA code.
  {href:'/approvals',labelKey:'Phê duyệt',icon:'A',role:'ADMIN',module:'INFRASTRUCTURE'},
  {href:'/admin/users',labelKey:'Nhân viên',icon:'U',role:'MOD'},
  {href:'/admin/projects',labelKey:'Dự án',icon:'P',role:'ADMIN'},
  {href:'/settings',labelKey:'Thiết lập',icon:'*'},
];
export interface NavAccess {role:string|null;modules:string[];paypalOnlyProject?:boolean;canManageUsers?:boolean}
// Same rule for every menu: no project → dashboard, settings and admin-only links; otherwise role and module checks.
export function canSee(item:NavLinkItem,a:NavAccess,modules?:Set<OptionalModule>):boolean{
  if(item.optional&&!moduleOn(item.optional,modules))return false;
  if(!a.role)return item.href==='/dashboard'||item.href==='/settings'||item.role==='ADMIN';
  if(item.infraOnly&&a.paypalOnlyProject)return false;
  if(item.role==='ADMIN')return a.role==='ADMIN';
  if(item.role==='MOD')return a.role==='ADMIN'||a.role==='MODERATOR'&&!!a.canManageUsers;
  if(a.role==='ADMIN')return true;
  if(item.anyModule)return item.anyModule.some(m=>a.modules.includes(m));
  return !item.module||a.modules.includes(item.module);
}
// A member with only the PayPal right opens Kho tài khoản on its PayPal tab (the login tab is not theirs).
export function personalizeHref(item:NavLinkItem,a:NavAccess):NavLinkItem{
  if(item.href==='/gmails'&&a.role!=='ADMIN'&&!a.modules.includes('INFRASTRUCTURE')&&a.modules.includes('PAYPALS'))return {...item,href:'/paypals',also:['/gmails']};
  return item;
}
// Drop separators that head no visible item.
export function visibleMenu(items:NavItem[],a:NavAccess,modules?:Set<OptionalModule>):NavItem[]{
  const kept=items.flatMap((i):NavItem[]=>'type' in i?[i]:canSee(i,a,modules)?[personalizeHref(i,a)]:[]);
  return kept.filter((i,n)=>!('type' in i)||(!!kept[n+1]&&!('type' in kept[n+1])));
}
// Sidebar footer: the user as the Nhân viên page shows them (name, @username); the project is already in the switcher above.
export function sidebarIdentity(u:{name?:string|null;username?:string|null;email?:string|null}){
  const name=capitalName(u.name||u.username||u.email)||'User';
  return {name,handle:u.username?'@'+u.username:'',initial:name.charAt(0).toUpperCase()};
}
