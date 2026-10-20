import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
vi.mock('@/lib/trpc',()=>{const m=()=>({useMutation:()=>({mutateAsync:async()=>({}),isLoading:false})});return {trpc:{businessManagement:{copyAccount:m()},accountStore:{updateLogin:m()}}};});
import {AccountDetail} from '@/components/account-store/AccountDetail';
// Khung chi tiết (owner brief 20/10/2026): labels, masking, and no empty secret kinds for a five-column Apple ID. Synthetic rows only.
const base={id:'g1',email:'apple@example.invalid',type:'APPLE_ID',status:'ACTIVE',state:'NEW',deletedAt:null,revision:3,notes:'ghi chú',recoveryEmail:null,createdAt:'',batch:null,batchId:null,price:null,priceState:'NONE',credentialsAvailable:true,phone:'0123456789',links:{twoFa:true,sms:true},has:{password:true,twoFa:false,token:false},earnApp:null,place:null,legacyVmCount:0};
const html=(o:object={},p:object={})=>renderToStaticMarkup(<AccountDetail projectId="p" login={{...base,...o} as never} canEdit canCopy onSaved={()=>{}} onClose={()=>{}} {...p}/>);
it('Apple ID five columns: Email đăng nhập, Mật khẩu (masked), Link lấy mã 2FA, Link SMS, Số điện thoại, Ghi chú; no 2FA / Token / recovery',()=>{
  const h=html(),labels=[...h.matchAll(/class="acc-detail-label">([^<]+)</g)].map(m=>m[1]);
  expect(labels).toEqual(['Email đăng nhập','Mật khẩu','Link lấy mã 2FA','Link SMS','Số điện thoại','Ghi chú']);
  expect(h).toContain('data-masked="1"');expect(h).toContain('••••••••');expect(h).toContain('Lấy mã 2FA');expect(h).toContain('>SMS<');
  expect(h).toContain('aria-label="Copy Email đăng nhập apple@example.invalid"');expect(h).toContain('aria-label="Xem Mật khẩu apple@example.invalid"');
  expect(h).not.toMatch(/Mã 2FA \(TOTP\)|Token|Email khôi phục/);expect(h).not.toContain('example.invalid/');
});
it('an account recorded with the older pattern shows what it stored; without the copy right nothing secret can be opened',()=>{
  const h=html({type:'GMAIL',recoveryEmail:'rec@example.invalid',phone:null,links:{twoFa:false,sms:false},has:{password:true,twoFa:true,token:false}});
  expect([...h.matchAll(/class="acc-detail-label">([^<]+)</g)].map(m=>m[1])).toEqual(['Email đăng nhập','Mật khẩu','Mã 2FA (TOTP)','Email khôi phục','Ghi chú']);
  const v=html({},{canCopy:false,canEdit:false});expect(v).not.toMatch(/aria-label="(Xem|Copy) Mật khẩu/);expect(v).not.toContain('Lấy mã 2FA');expect(v).not.toContain('>Sửa<');
});
