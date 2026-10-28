'use client';
import {trpc} from '@/lib/trpc';
import {looksLikeTxId,txQuery,validTxId} from '@/lib/paypal-tx';

// Server / VM search by PayPal transaction id (29/10/2026). The grid filter model is unchanged: only when the search finds no VM and
// the query looks like a PayPal transaction id, the server is asked which payout request has a receipt with that id
// (vmOps.findByTransaction, request money rights) and the VM can be opened. No rights / error → nothing is shown.
const RECEIPT:Record<string,string>={CONFIRMED:'đã nhận',PENDING:'chờ xác nhận',FAILED:'thất bại',VOIDED:'đã thu hồi'};
export function TxLookupOffer({projectId,query,empty,currentServerId,onOpen}:{projectId:string;query:string;empty:boolean;currentServerId?:string|null;onOpen:(vmId:string)=>void}){
  const tx=txQuery(query),enabled=empty&&looksLikeTxId(query)&&validTxId(tx);
  const found=trpc.vmOps.findByTransaction.useQuery({projectId,transactionId:tx},{enabled,retry:false,staleTime:30000});
  if(!enabled||found.error)return null;
  if(found.isFetching&&found.data===undefined)return <div className="vm-scope-line" role="status"><span className="pm-muted">Đang tìm mã giao dịch PayPal {tx}…</span></div>;
  if(found.data===undefined)return null;
  if(found.data===null)return <div className="vm-scope-line" role="status"><span className="pm-muted">Không có yêu cầu rút nào có mã giao dịch {tx}.</span></div>;
  const {vmId,serverId,serverCode,receipt}=found.data,elsewhere=!!currentServerId&&currentServerId!==serverId;
  return <div className="vm-scope-line" role="status"><span>Mã giao dịch PayPal khớp một khoản tiền về ({RECEIPT[receipt.status]||receipt.status}){elsewhere?<> · VM ở server <strong>{serverCode}</strong></>:null}.</span><button type="button" className="pm-button pm-button-primary" onClick={()=>onOpen(vmId)}>Mở VM có giao dịch {tx}</button></div>;
}
