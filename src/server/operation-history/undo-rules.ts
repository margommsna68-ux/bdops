import type {OperationSnapshot} from './snapshot';
// Facts that an ordinary undo must never take back (independent review 19/10/2026). Checked on the stored images, so journals
// written before these rules (marked reversible at the time) are refused the same way.
// - A recorded VM recreation closed a round, closed its EarnApp and used the receipt: undoing it would move the VM back a round,
//   reopen the EarnApp and let the same money open a round again.
// - A receiving email given to its first EarnApp stays used forever (PayPalEmail.usedEarnAppId); undo would return it to unused.
export const RECREATE_VIEW_ONLY='Ghi nhận tạo lại VM chỉ để xem: lượt cũ, EarnApp cũ đã đóng và khoản nhận đã dùng được giữ nguyên, không hoàn tác. Ghi tình trạng mới cho lượt hiện hành nếu cần';
export const SDK_LINK_FINAL='Ghi nhận SDK đã nối EarnApp giữ vĩnh viễn: mã không trở lại chưa nối, không hoàn tác';
export const SDK_LEGACY_VIEW_ONLY='Lần ghi SDK trước khi có Kho SDK chỉ để xem; sửa SDK tại ô SDK của VM (mã cũ vẫn giữ trong Kho SDK)';
export function undoRefusal(kind:string,snapshot:OperationSnapshot):string|null{
  if(kind==='VM_RECREATE')return RECREATE_VIEW_ONLY;
  // SDK store (19/10/2026): a link is final; journals that changed VM.sdkId directly (before the store) cannot be replayed safely.
  if(kind==='SDK_LINK')return SDK_LINK_FINAL;
  if(snapshot.resources.some(r=>r.resource==='VM_SDK')&&!snapshot.resources.some(r=>r.resource==='SDK'))return SDK_LEGACY_VIEW_ONLY;
  for(const image of snapshot.resources){
    const before=image.before as Record<string,unknown>|null,after=image.after as Record<string,unknown>;
    if(image.resource==='VM_CYCLE'&&!before)return RECREATE_VIEW_ONLY;
    if(image.resource==='EARNAPP'&&after?.closedAt&&!before?.closedAt)return RECREATE_VIEW_ONLY;
    if((image.resource==='PAYOUT_REQUEST'||image.resource==='PAYOUT_MEMBER')&&after?.consumedAt&&!before?.consumedAt)return RECREATE_VIEW_ONLY;
    if(image.resource==='SDK'&&after?.linkState==='LINKED'&&before?.linkState!=='LINKED')return SDK_LINK_FINAL;
    if(image.resource==='PAYPAL_EMAIL'&&after?.usedEarnAppId&&!before?.usedEarnAppId)return 'Email PayPal '+String(after.email??'')+' đã được cấp cho EarnApp; dấu đã dùng giữ vĩnh viễn nên lần cấp này không hoàn tác được. Dùng Bỏ gán tài khoản ở Server / VM nếu cần gỡ khỏi VM';
  }
  return null;
}
