"use client";
import {useEffect,useState} from 'react';
import toast from 'react-hot-toast';
import {trpc} from '@/lib/trpc';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {projectLabel} from '@/lib/utils';
import {MemberRightsForm} from '@/components/proxy-management/MemberRightsDialog';
import {OpsTokensPanel} from '@/components/settings/OpsTokensPanel';
import {Dialog,DialogContent,DialogTitle} from '@/components/ui/dialog';
import {TotpSetup} from '@/components/TotpSetup';
// One page per person, for people and AI alike (owner brief 22/10/2026): who is managed, in which project, then side by side the rights
// in this project, PIN and access, and the API connection. Every action is checked again on the server for the project being viewed.
export function UserAccessSections({projectId,userId,login}:{projectId:string;userId:string;login:string}){
  const utils=trpc.useUtils(),access=trpc.user.access.useQuery({projectId,userId});
  const d=access.data,who=login+' · '+(d?projectLabel(d.project):'…');
  const refresh=()=>{void utils.user.access.invalidate();void utils.user.getDetail.invalidate();void utils.user.onlineUsers.invalidate();};
  const [pin,setPin]=useState(''),[reason,setReason]=useState(''),[askDisable,setAskDisable]=useState(false),[totpOpen,setTotpOpen]=useState(false);
  useEffect(()=>{setPin('');setReason('');setAskDisable(false);setAskReset(false);},[projectId,userId]);
  const setPinM=trpc.user.adminResetPin.useMutation({onSuccess:()=>{setPin('');toast.success(d?.hasPin?'Đã đổi PIN; phiên đã mở khoá bằng PIN cũ phải nhập lại':'Đã đặt PIN');refresh();},onError:e=>toast.error(e.message)});
  const removePin=trpc.user.resetPin.useMutation({onSuccess:()=>{toast.success('Đã xoá PIN');refresh();},onError:e=>toast.error(e.message)});
  const unlock=trpc.user.adminUnlockAccount.useMutation({onSuccess:()=>{toast.success('Đã mở khoá tạm');refresh();},onError:e=>toast.error(e.message)});
  const [askReset,setAskReset]=useState(false);
  const requireTotp=trpc.user.requireTotp.useMutation({onSuccess:(_r,v)=>{toast.success(v.required?'Đã bắt buộc 2FA: người này phải cài Google Authenticator ở lần vào sau':'Đã bỏ bắt buộc 2FA');refresh();},onError:e=>toast.error(e.message)});
  const resetTotp=trpc.user.resetTotp.useMutation({onSuccess:()=>{setAskReset(false);toast.success('Đã đặt lại 2FA: khoá cũ và mã dự phòng không còn; người này cài lại ở lần vào sau');refresh();},onError:e=>toast.error(e.message)});
  const disable=trpc.user.setDisabled.useMutation({onSuccess:r=>{setAskDisable(false);setReason('');toast.success(r.disabled?'Đã vô hiệu hoá: thu hồi '+r.revokedTokens+' token, '+r.revokedSessions+' phiên đăng nhập':'Đã bật lại; người này đăng nhập mới, token cũ không dùng lại');refresh();void utils.opsToken.list.invalidate();},onError:e=>toast.error(e.message)});
  if(access.error)return <p role="alert" className="text-sm text-red-600">{access.error.message}</p>;
  if(!d)return <p className="text-sm text-gray-400">Đang tải…</p>;
  const admin=d.viewerRole==='ADMIN',manager=admin||d.viewerRole==='MODERATOR',proxyVm=d.project.businessMode==='PROXY_VM',busy=setPinM.isLoading||removePin.isLoading||disable.isLoading||requireTotp.isLoading||resetTotp.isLoading;
  const state=d.state==='DISABLED'?{t:'Đã vô hiệu hoá',c:'text-red-600'}:d.state==='LOCKED'?{t:'Khoá tạm (sai '+(d.loginLocked?'mật khẩu':'PIN')+' 3 lần, tự mở sau 30 phút)',c:'text-amber-700'}:{t:'Đang hoạt động',c:'text-green-700'};
  return <div className="space-y-4" data-testid="user-access">
    <div className="rounded-lg border bg-white p-4"><p className="text-xs text-gray-500">Đang quản lý</p><p className="text-lg font-semibold" data-testid="user-access-who">{who}</p>
      <p className="text-xs text-gray-500">Vai trò trong dự án: <strong>{d.memberRole??'—'}</strong> · Tài khoản: <span className={state.c}>{state.t}</span> · 2FA: {d.totpEnabled?'đã bật':d.totpRequired?'bắt buộc, chưa cài':'chưa bật'} · PIN: {d.hasPin?'đã đặt':'chưa đặt'} · Token còn hiệu lực: {d.activeTokens}</p></div>
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border bg-white p-4 space-y-3" aria-label="Quyền trong dự án">
        <h2 className="text-base font-semibold">Quyền trong dự án <span className="text-sm font-normal text-gray-500">· {projectLabel(d.project)}</span></h2>
        {admin&&proxyVm&&d.memberId?<MemberRightsForm key={projectId+userId} projectId={projectId} memberId={d.memberId} onSaved={refresh}/>
          :<p className="text-sm text-gray-500">{proxyVm?'Chỉ ADMIN của dự án này cấp quyền Proxy / Server / VM.':'Dự án này không dùng quyền Proxy / VM; vai trò và module ở phần Cấu hình bên dưới.'}</p>}
        <p className="text-xs text-gray-500">Không tự nâng vai trò để đi tắt; quyền rút tiền, ghi tiền PP, xoá kho, chi phí chỉ cấp khi thật sự cần.</p>
      </section>
      <section className="rounded-lg border bg-white p-4 space-y-3" aria-label="PIN và truy cập">
        <h2 className="text-base font-semibold">PIN và truy cập</h2>
        {d.self&&<div className="flex flex-wrap items-center gap-2" data-testid="user-totp-self">
          <p className="text-xs text-gray-500">Đây là tài khoản của bạn.</p>
          {!d.totpEnabled&&<Button size="sm" onClick={()=>setTotpOpen(true)}>Bật 2FA Google Authenticator cho tôi</Button>}
          {d.totpEnabled&&<span className="text-xs text-green-700">2FA của bạn đã bật (mã dự phòng và đặt lại: Thiết lập → Bảo mật / ADMIN khác).</span>}
          <Dialog open={totpOpen} onOpenChange={v=>{if(!v)setTotpOpen(false);}}>
            <DialogContent className="sm:max-w-md"><DialogTitle className="sr-only">Bật 2FA</DialogTitle>
              {totpOpen&&<TotpSetup autoStart onDone={()=>{setTotpOpen(false);refresh();void utils.user.securityStatus.invalidate();}} onCancel={()=>setTotpOpen(false)}/>}
            </DialogContent>
          </Dialog>
        </div>}
        {admin&&<div className="space-y-2" data-testid="user-totp">
          <p className="text-sm">2FA (Google Authenticator): <strong>{d.totpEnabled?'Đã bật':d.totpRequired?'Bắt buộc (chưa cài)':'Chưa bật'}</strong>{d.totpEnabled&&d.totpRequired?' · bắt buộc':''}{d.totpLocked?<span className="text-amber-700"> · khoá tạm (sai mã 3 lần)</span>:null}</p>
          {!d.self&&<div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy||d.state==='DISABLED'} onClick={()=>requireTotp.mutate({projectId,userId,required:!d.totpRequired})}>{d.totpRequired?'Bỏ bắt buộc':'Bắt buộc 2FA'}</Button>
            {(d.totpEnabled||d.totpRequired)&&!askReset&&<Button size="sm" variant="outline" className="text-red-600 border-red-300" disabled={busy} onClick={()=>setAskReset(true)}>Đặt lại 2FA…</Button>}
          </div>}
          {askReset&&<div className="rounded border border-red-200 bg-red-50 p-2 space-y-2" role="dialog" aria-label="Đặt lại 2FA">
            <p className="text-xs text-gray-700">Đặt lại 2FA của {login}: khoá Google Authenticator và mã dự phòng hiện tại bị huỷ, mọi phiên đã mở khoá kết thúc; người này phải cài lại 2FA ở lần vào sau và không duyệt được lệnh AI cho tới khi cài xong.</p>
            <div className="flex gap-2"><Button size="sm" className="bg-red-600 hover:bg-red-700" disabled={busy} onClick={()=>resetTotp.mutate({projectId,userId})}>Đặt lại 2FA</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>setAskReset(false)}>Huỷ</Button></div></div>}
          <p className="text-xs text-gray-500">Bắt buộc = popup cài 2FA không bỏ qua được ở lần vào sau. Chỉ ADMIN đặt lại; không ai xem được khoá hay mã của người khác.</p>
        </div>}
        {manager&&!d.self&&!d.totpEnabled&&<>
          <div className="flex flex-wrap items-end gap-2"><label className="space-y-1"><span className="text-xs text-gray-600">{d.hasPin?'PIN mới':'PIN (4–6 số)'}</span>
            <Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} className="w-36" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))}/></label>
            <Button size="sm" disabled={pin.length<4||busy||d.state==='DISABLED'} onClick={()=>setPinM.mutate({projectId,userId,newPin:pin})}>{d.hasPin?'Đổi PIN':'Đặt PIN'}</Button>
            {d.hasPin&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>{if(window.confirm('Xoá PIN của '+login+'? Người này (hoặc AI) không làm được thao tác cần PIN cho tới khi có PIN mới.'))removePin.mutate({projectId,userId});}}>Xoá PIN</Button>}</div>
          <p className="text-xs text-gray-500">Không hiện PIN hiện tại. Đổi / xoá PIN làm các phiên đã mở khoá bằng PIN cũ phải nhập lại. PIN chỉ còn cho người chưa bật 2FA; ADMIN dùng mã 2FA (hoặc PIN) của mình khi tạo token.</p>
        </>}
        {manager&&!d.self&&(d.state==='LOCKED'||d.totpLocked)&&<Button size="sm" variant="outline" disabled={unlock.isLoading} onClick={()=>unlock.mutate({projectId,userId,type:'BOTH'})}>Mở khoá tạm</Button>}
        {d.canDisable&&<div className="border-t pt-3 space-y-2">
          {d.state==='DISABLED'?<>
            <p className="text-sm text-red-600">Đã vô hiệu hoá{d.disabledReason?': '+d.disabledReason:''}.</p>
            <Button size="sm" variant="outline" disabled={busy} onClick={()=>disable.mutate({projectId,userId,disabled:false})}>Bật lại</Button>
            <p className="text-xs text-gray-500">Bật lại phải đăng nhập mới; phiên, token và mở khoá PIN cũ không sống lại.</p></>
          :askDisable?<div className="space-y-2"><label className="space-y-1 block"><span className="text-xs text-gray-600">Lý do (tuỳ chọn)</span><Input value={reason} maxLength={300} onChange={e=>setReason(e.target.value)}/></label>
            <p className="text-xs text-gray-600">Chặn đăng nhập, phiên web đang mở, mọi token API và lệnh ghi; không xoá người dùng hay dữ liệu{d.otherProjects?'; áp dụng cho cả '+d.otherProjects+' dự án khác của tài khoản này (bạn cần là ADMIN ở đó)':''}. Thao tác đã bắt đầu ngoài web (AE Mini Tool) không tự dừng.</p>
            <div className="flex gap-2"><Button size="sm" className="bg-red-600 hover:bg-red-700" disabled={busy} onClick={()=>disable.mutate({projectId,userId,disabled:true,reason:reason.trim()||null})}>Vô hiệu hoá</Button><Button size="sm" variant="outline" onClick={()=>setAskDisable(false)}>Huỷ</Button></div></div>
          :<Button size="sm" variant="outline" className="text-red-600 border-red-300" onClick={()=>setAskDisable(true)}>Vô hiệu hoá…</Button>}
        </div>}
      </section>
    </div>
    {admin&&proxyVm&&<div className="rounded-lg border bg-white p-4"><OpsTokensPanel projectId={projectId} userId={userId} who={who}/></div>}
  </div>;
}
