"use client";
import {useEffect} from 'react';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import {links} from '@/lib/links';
import {OPTIONAL_MODULES,type OptionalModule} from '@/lib/features';
// Old link to a module hidden in src/lib/features.ts (Proxy / VM projects). Install links go to the VM in Server / VM (replace, so
// Back does not bounce here again); Giao việc has no replacement page, so it says so and offers the way back. Data is untouched.
export function installTarget(vm:string|null,hash:string){
  if(vm)return links.vms({vm,tab:'install'});
  return hash==='#orphan'?links.vms({view:'TASK_ORPHAN'}):links.vms({view:'PENDING'});
}
export function HiddenModule({module}:{module:OptionalModule}){
  const router=useRouter(),params=useSearchParams(),vm=params.get('vm');
  // The hash (#orphan) only exists in the browser, so the target is decided in the effect.
  const install=module==='INSTALL_TASKS',target=install?installTarget(vm,''):null;
  useEffect(()=>{if(install)router.replace(installTarget(vm,window.location.hash));},[install,vm,router]);
  if(target)return <p className="pm-muted text-sm" role="status">Việc cài proxy làm ngay tại VM trong Server / VM. Đang mở… <Link className="pm-link" href={target}>Mở ngay</Link></p>;
  return <div className="proxy-workspace"><div className="pm-surface p-5 space-y-3 max-w-xl" role="status">
    <h1 className="text-lg font-semibold">{OPTIONAL_MODULES[module].label} đang tạm ẩn</h1>
    <p className="text-sm pm-muted">Mục này tạm ẩn khỏi MoneyToHome. Dữ liệu và lịch sử cũ vẫn được giữ nguyên. Việc vận hành làm tại Server / VM và Kho tài khoản.</p>
    <div className="flex gap-2 flex-wrap"><Link className="pm-button pm-button-primary" href={links.dashboard()}>Về Tổng quan</Link><Link className="pm-button" href={vm?links.vms({vm}):links.vms()}>{vm?'Mở VM':'Mở Server / VM'}</Link></div>
  </div></div>;
}
