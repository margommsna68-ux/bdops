"use client";
import {useState} from 'react';
import toast from 'react-hot-toast';
import {trpc} from '@/lib/trpc';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
// Token API vận hành (21/10/2026). ADMIN only, Proxy / VM projects. The full token is shown once right after creation and is never
// read again; the list shows name, prefix, user, operations, expiry and last use. Revoking applies to the next API request.
type Scope='READ'|'BALANCE_WRITE'|'PAYOUT'|'RECEIPT';
const SCOPES:{value:Scope;label:string}[]=[{value:'READ',label:'Đọc server / VM / yêu cầu rút'},{value:'BALANCE_WRITE',label:'Ghi số dư EarnApp'},{value:'PAYOUT',label:'Gợi ý PP, chuẩn bị rút, ghi đã gửi / chưa rõ'},{value:'RECEIPT',label:'Ghi khoản nhận PP của yêu cầu rút'}];
const label=(s:string)=>SCOPES.find(x=>x.value===s)?.label??s;
const when=(iso:string|null)=>iso?new Date(iso).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok',hour12:false}):'—';
export function OpsTokensPanel({projectId}:{projectId:string}){
  const utils=trpc.useUtils(),list=trpc.opsToken.list.useQuery({projectId}),people=trpc.opsToken.candidates.useQuery({projectId});
  const create=trpc.opsToken.create.useMutation(),revoke=trpc.opsToken.revoke.useMutation();
  const [open,setOpen]=useState(false),[userId,setUser]=useState(''),[name,setName]=useState(''),[scopes,setScopes]=useState<Scope[]>(['READ']),[days,setDays]=useState(30),[ips,setIps]=useState(''),[pin,setPin]=useState('');
  const [shown,setShown]=useState<{token:string;prefix:string}|null>(null),[error,setError]=useState('');
  const person=people.data?.find(p=>p.userId===userId),missing=person?scopes.filter(s=>!person.ops[s]):[];
  async function submit(){
    setError('');
    try{const r=await create.mutateAsync({projectId,userId,name,scopes,expiresInDays:days,allowedIps:ips.split(/[\s,]+/).filter(Boolean),pin});
      setShown({token:r.token,prefix:r.prefix});setPin('');setOpen(false);await utils.opsToken.list.invalidate({projectId});}
    catch(e){setError(e instanceof Error?e.message:'Chưa tạo được token');}
  }
  return <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2" data-testid="ops-tokens">
    <div className="flex items-center justify-between gap-3 mb-2"><h2 className="text-lg font-semibold text-gray-900">Token API vận hành</h2>
      {!open&&<Button size="sm" onClick={()=>{setOpen(true);setShown(null);}}>Tạo token</Button>}</div>
    <p className="text-xs text-gray-500 mb-3">Token chỉ dùng cho /api/ops/v1, hành động trong đúng quyền hiện tại của người được cấp. Lệnh ghi cần thêm PIN của người đó. API không kết nối VM và không tự rút tiền trên EarnApp.</p>
    {shown&&<div role="status" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm space-y-2">
      <p className="font-semibold">Token {shown.prefix}… chỉ hiện một lần. Lưu ngay vào kho bí mật cục bộ; không gửi qua chat, không dán vào lệnh hay file commit.</p>
      <div className="flex gap-2 items-center"><code className="break-all text-xs bg-white border rounded px-2 py-1 flex-1" data-testid="ops-token-once">{shown.token}</code>
        <Button size="sm" variant="outline" onClick={()=>{void navigator.clipboard?.writeText(shown.token).then(()=>toast.success('Đã copy token'));}}>Copy</Button>
        <Button size="sm" variant="outline" onClick={()=>setShown(null)}>Đã lưu, ẩn đi</Button></div></div>}
    {open&&<div className="mb-4 rounded border border-gray-200 p-3 space-y-3 text-sm">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="space-y-1"><span className="text-xs text-gray-600">Người dùng token</span>
          <select className="w-full border rounded px-2 py-1.5" value={userId} onChange={e=>setUser(e.target.value)}><option value="">Chọn người</option>{people.data?.map(p=><option key={p.userId} value={p.userId}>{p.name}{p.username?' (@'+p.username+')':''} · {p.role}</option>)}</select></label>
        <label className="space-y-1"><span className="text-xs text-gray-600">Tên token</span><Input value={name} maxLength={60} placeholder="ví dụ: Claude vận hành" onChange={e=>setName(e.target.value)}/></label>
      </div>
      <fieldset className="space-y-1"><legend className="text-xs text-gray-600">Thao tác được phép</legend>
        {SCOPES.map(s=><label key={s.value} className="flex items-center gap-2"><input type="checkbox" checked={scopes.includes(s.value)} onChange={e=>setScopes(e.target.checked?[...scopes,s.value]:scopes.filter(x=>x!==s.value))}/>{s.label}{person&&!person.ops[s.value]&&<span className="text-xs text-amber-700">· người này chưa có quyền</span>}</label>)}</fieldset>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="space-y-1"><span className="text-xs text-gray-600">Hết hạn sau</span><select className="w-full border rounded px-2 py-1.5" value={days} onChange={e=>setDays(Number(e.target.value))}>{[7,30,90].map(d=><option key={d} value={d}>{d} ngày</option>)}</select></label>
        <label className="space-y-1 sm:col-span-2"><span className="text-xs text-gray-600">Chỉ nhận từ IP (tuỳ chọn, cách nhau bằng dấu phẩy)</span><Input value={ips} placeholder="để trống = không giới hạn IP" onChange={e=>setIps(e.target.value)}/></label>
      </div>
      <label className="space-y-1 block max-w-xs"><span className="text-xs text-gray-600">PIN của bạn (ADMIN) để tạo</span><Input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e=>setPin(e.target.value)}/></label>
      {missing.length>0&&<p className="text-xs text-amber-700">Người này chưa có: {missing.map(label).join(', ')}. Cấp quyền ở Kho proxy → Quyền nhân viên trước, hoặc bỏ chọn.</p>}
      {error&&<p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2"><Button size="sm" disabled={!userId||!name.trim()||!scopes.length||!pin||missing.length>0||create.isLoading} onClick={()=>void submit()}>Tạo token</Button><Button size="sm" variant="outline" onClick={()=>setOpen(false)}>Huỷ</Button></div>
    </div>}
    {list.error&&<p role="alert" className="text-xs text-red-600">{list.error.message}</p>}
    {list.data&&!list.data.length&&<p className="text-sm text-gray-500">Chưa có token.</p>}
    {!!list.data?.length&&<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-500"><th className="py-1 pr-3">Token</th><th className="pr-3">Người dùng</th><th className="pr-3">Thao tác</th><th className="pr-3">Hạn</th><th className="pr-3">Dùng gần nhất</th><th></th></tr></thead>
      <tbody>{list.data.map(t=><tr key={t.id} className="border-t align-top"><td className="py-2 pr-3"><div className="font-medium">{t.name}</div><code className="text-xs text-gray-500">{t.prefix}…</code></td>
        <td className="pr-3">{t.user}{t.username?<div className="text-xs text-gray-500">@{t.username}</div>:null}</td>
        <td className="pr-3 text-xs">{t.scopes.map(label).join(' · ')}{t.allowedIps.length>0&&<div className="text-gray-500">IP: {t.allowedIps.join(', ')}</div>}</td>
        <td className="pr-3 text-xs">{t.state==='REVOKED'?<span className="text-red-600">Đã thu hồi {when(t.revokedAt)}</span>:t.state==='EXPIRED'?<span className="text-gray-500">Hết hạn {when(t.expiresAt)}</span>:when(t.expiresAt)}</td>
        <td className="pr-3 text-xs">{when(t.lastUsedAt)}{t.lastUsedIp&&<div className="text-gray-500">{t.lastUsedIp}</div>}</td>
        <td className="text-right">{t.state==='ACTIVE'&&<Button size="sm" variant="outline" disabled={revoke.isLoading} onClick={()=>{if(!window.confirm('Thu hồi token '+t.prefix+'…? Lệnh tiếp theo dùng token này sẽ bị từ chối.'))return;void revoke.mutateAsync({projectId,tokenId:t.id}).then(()=>{toast.success('Đã thu hồi');return utils.opsToken.list.invalidate({projectId});}).catch(e=>toast.error(e.message));}}>Thu hồi</Button>}</td></tr>)}</tbody></table></div>}
  </div>;
}
