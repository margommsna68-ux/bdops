"use client";
import {useEffect,useState} from 'react';
import toast from 'react-hot-toast';
import {trpc} from '@/lib/trpc';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
// Kết nối API of ONE user in ONE project (owner brief 22/10/2026; was the project-wide panel in Thiết lập, 21/10/2026). ADMIN only,
// Proxy / VM projects. The list comes filtered from the server (user + project). The full token is shown once right after creation;
// the form keeps one request key until it succeeds, so a double click or a lost answer never makes a second token.
type Scope='READ'|'BALANCE_WRITE'|'PAYOUT'|'RECEIPT'|'VM_OPS'|'PROXY_CREDENTIALS'|'ACCOUNT_OPS';
// The operations the API really has (src/server/ops-api/tokens.ts OPS_SCOPES); only those this user can do now are offered.
export const TOKEN_SCOPES:{value:Scope;label:string}[]=[
  {value:'READ',label:'Đọc dữ liệu (dự án, server, VM, yêu cầu rút)'},
  {value:'BALANCE_WRITE',label:'Ghi số dư EarnApp / tiền tích luỹ SDK'},
  {value:'VM_OPS',label:'Vận hành VM: nhận việc, tình trạng, Blocked, ghi SDK, ghi chú'},
  {value:'PROXY_CREDENTIALS',label:'Lấy proxy của đúng VM đang xử lý'},
  {value:'ACCOUNT_OPS',label:'Kho tài khoản: xem, giữ / trả, ghi đã dùng; lấy đăng nhập theo quyền và việc đang giữ'},
  {value:'PAYOUT',label:'Gợi ý PP, chuẩn bị rút, ghi đã gửi / chưa rõ'},
  {value:'RECEIPT',label:'Ghi khoản nhận PP của yêu cầu rút'},
];
const label=(s:string)=>TOKEN_SCOPES.find(x=>x.value===s)?.label??s;
const when=(iso:string|null)=>iso?new Date(iso).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok',hour12:false}):'—';
const newKey=()=>typeof crypto!=='undefined'&&'randomUUID' in crypto?crypto.randomUUID():String(Date.now())+Math.random().toString(36).slice(2);
export function OpsTokensPanel({projectId,userId,who}:{projectId:string;userId:string;who:string}){
  const utils=trpc.useUtils(),list=trpc.opsToken.list.useQuery({projectId,userId}),person=trpc.opsToken.candidates.useQuery({projectId,userId});
  const create=trpc.opsToken.create.useMutation(),revoke=trpc.opsToken.revoke.useMutation();
  const [open,setOpen]=useState(false),[name,setName]=useState(''),[scopes,setScopes]=useState<Scope[]>([]),[days,setDays]=useState(30),[ips,setIps]=useState(''),[pin,setPin]=useState(''),[key,setKey]=useState(newKey);
  const [shown,setShown]=useState<{token:string;prefix:string}|null>(null),[error,setError]=useState('');
  // Another user / project: nothing of the previous one is kept (form, shown token, key).
  useEffect(()=>{setOpen(false);setName('');setScopes([]);setPin('');setIps('');setShown(null);setError('');setKey(newKey());},[projectId,userId]);
  const ops=person.data?.[0]?.ops as Record<Scope,boolean>|undefined;
  const can=TOKEN_SCOPES.filter(s=>ops?.[s.value]),cannot=TOKEN_SCOPES.filter(s=>ops&&!ops[s.value]);
  async function submit(){
    if(create.isLoading)return;setError('');
    try{const r=await create.mutateAsync({projectId,userId,name:name.trim(),scopes,expiresInDays:days||null,allowedIps:ips.split(/[\s,]+/).filter(Boolean),pin,createKey:key});
      if(r.token)setShown({token:r.token,prefix:r.prefix});
      else toast('Token '+r.prefix+'… đã được tạo ở lần bấm trước. Token đầy đủ chỉ hiện một lần: nếu chưa lưu, thu hồi rồi tạo token mới.',{duration:9000});
      setPin('');setOpen(false);setName('');setScopes([]);setIps('');setKey(newKey());await utils.opsToken.list.invalidate({projectId,userId});void utils.user.access.invalidate();}
    catch(e){setError(e instanceof Error?e.message:'Chưa tạo được token; bấm lại sẽ dùng cùng yêu cầu, không tạo thêm token');}
  }
  return <section className="space-y-3" data-testid="ops-tokens" aria-label="Kết nối API">
    <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">Kết nối API <span className="text-sm font-normal text-gray-500">· {who}</span></h2>
      {/* Hidden while a new token is on screen: a stray (double) click must never hide the one-time token before "Đã lưu". */}
      {!open&&!shown&&<Button size="sm" disabled={!can.length} onClick={()=>{setOpen(true);setScopes(can.filter(s=>s.value==='READ').map(s=>s.value));}}>Tạo token</Button>}</div>
    <p className="text-xs text-gray-500">Token chỉ dùng cho /api/ops/v1, trong đúng quyền hiện tại của {who.split(' · ')[0]}. Lấy thông tin kho không cần duyệt; vẫn kiểm quyền và server được giao. Lệnh tiền chờ ADMIN duyệt ở trang Phê duyệt; token không tự thêm quyền.</p>
    {shown&&<div role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm space-y-2 text-gray-900">
      <p className="font-semibold">Token {shown.prefix}… chỉ hiện một lần. Lưu ngay vào kho bí mật của máy chạy; không gửi qua chat, không dán vào lệnh hay file commit.</p>
      <div className="flex flex-wrap gap-2 items-center"><code className="break-all text-xs bg-white border rounded px-2 py-1 flex-1 min-w-0" data-testid="ops-token-once">{shown.token}</code>
        <Button size="sm" variant="outline" onClick={()=>{void navigator.clipboard?.writeText(shown.token).then(()=>toast.success('Đã copy token'));}}>Copy</Button>
        <Button size="sm" variant="outline" onClick={()=>setShown(null)}>Đã lưu</Button></div></div>}
    {open&&<div className="rounded border border-gray-200 p-3 space-y-3 text-sm">
      <label className="space-y-1 block"><span className="text-xs text-gray-600">Tên token (máy / AI dùng)</span><Input value={name} maxLength={60} placeholder="ví dụ: SERVER-01 · AI vận hành" onChange={e=>setName(e.target.value)}/></label>
      <fieldset className="space-y-1"><legend className="text-xs text-gray-600">Quyền của token</legend>
        {can.map(s=><label key={s.value} className="flex items-center gap-2"><input type="checkbox" checked={scopes.includes(s.value)} onChange={e=>setScopes(e.target.checked?[...scopes,s.value]:scopes.filter(x=>x!==s.value))}/>{s.label}</label>)}
        {cannot.length>0&&<p className="text-xs text-gray-500 pt-1">Chưa được cấp cho người này: {cannot.map(s=>s.label).join('; ')}. Cấp ở mục Quyền phía trên nếu cần.</p>}
      </fieldset>
      <label className="space-y-1 block max-w-[12rem]"><span className="text-xs text-gray-600">Hạn dùng</span><select className="w-full border rounded px-2 py-1.5 bg-transparent" value={days} onChange={e=>setDays(Number(e.target.value))}>{[7,30,90].map(d=><option key={d} value={d}>{d} ngày</option>)}<option value={0}>Không hết hạn</option></select>{days===0&&<span className="text-xs text-amber-700 block">Dùng đến khi thu hồi. Thu hồi ngay khi máy không còn dùng token.</span>}</label>
      <details><summary className="text-xs text-gray-600 cursor-pointer">Tuỳ chọn</summary>
        <label className="space-y-1 block mt-2"><span className="text-xs text-gray-600">Chỉ nhận từ IP (cách nhau bằng dấu phẩy; IPv4, IPv6 hoặc IPv4/nn)</span><Input value={ips} placeholder="để trống = không giới hạn IP" onChange={e=>setIps(e.target.value)}/></label></details>
      <label className="space-y-1 block max-w-xs"><span className="text-xs text-gray-600">Mã 2FA (hoặc PIN nếu chưa bật 2FA)</span><Input type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={12} aria-label="Mã 2FA (hoặc PIN nếu chưa bật 2FA)" value={pin} onChange={e=>setPin(e.target.value.replace(/[^0-9a-zA-Z-]/g,'').slice(0,12))}/><span className="text-xs text-gray-500 block">6 số Google Authenticator, mã dự phòng xxxxx-xxxxx, hoặc PIN 4–6 số.</span></label>
      {error&&<p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2"><Button size="sm" disabled={!name.trim()||!scopes.length||pin.length<4||create.isLoading} onClick={()=>void submit()}>{create.isLoading?'Đang tạo…':'Tạo token'}</Button><Button size="sm" variant="outline" disabled={create.isLoading} onClick={()=>setOpen(false)}>Huỷ</Button></div>
    </div>}
    {!can.length&&ops&&<p className="text-xs text-amber-700">Người này chưa có quyền nào dùng được qua API trong dự án này.</p>}
    {list.error&&<p role="alert" className="text-xs text-red-600">{list.error.message}</p>}
    {list.data&&!list.data.length&&<p className="text-sm text-gray-500">Chưa có token.</p>}
    {!!list.data?.length&&<div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]"><thead><tr className="text-left text-xs text-gray-500"><th className="py-1 pr-3">Tên token</th><th className="pr-3">Quyền</th><th className="pr-3">Hết hạn</th><th className="pr-3">Dùng gần nhất</th><th className="pr-3">Tình trạng</th><th/></tr></thead>
      <tbody>{list.data.map(t=><tr key={t.id} className="border-t align-top"><td className="py-2 pr-3"><div className="font-medium">{t.name}</div><code className="text-xs text-gray-500">{t.prefix}…</code></td>
        <td className="pr-3 text-xs">{t.scopes.map(label).join(' · ')}{t.allowedIps.length>0&&<div className="text-gray-500">IP: {t.allowedIps.join(', ')}</div>}</td>
        <td className="pr-3 text-xs">{t.neverExpires?'Không hết hạn':when(t.expiresAt)}</td>
        <td className="pr-3 text-xs">{when(t.lastUsedAt)}{t.lastUsedIp&&<div className="text-gray-500">{t.lastUsedIp}</div>}</td>
        <td className="pr-3 text-xs">{t.state==='REVOKED'?<span className="text-red-600">Đã thu hồi {when(t.revokedAt)}</span>:t.state==='EXPIRED'?<span className="text-gray-500">Hết hạn</span>:<span className="text-green-700">Còn hiệu lực</span>}</td>
        <td className="text-right">{t.state==='ACTIVE'&&<Button size="sm" variant="outline" disabled={revoke.isLoading} onClick={()=>{if(!window.confirm('Thu hồi token '+t.prefix+'…? Lệnh tiếp theo dùng token này sẽ bị từ chối.'))return;void revoke.mutateAsync({projectId,tokenId:t.id}).then(()=>{toast.success('Đã thu hồi');void utils.opsToken.list.invalidate({projectId,userId});void utils.user.access.invalidate();}).catch(e=>toast.error(e instanceof Error?e.message:'Không thu hồi được'));}}>Thu hồi</Button>}</td></tr>)}</tbody></table></div>}
  </section>;
}
