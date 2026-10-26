// Narrow operator reconciliation of the known v2 pre-probe persistence branch.
// This never treats disappearance of a HOST child as proof of GUEST exit.
import crypto from 'node:crypto';
import {sanitizeNativeSource} from './native-monitor-wire.mjs';
export const PREFLIGHT_OLD_BUILD='edd656962da9070ecb7d8e82cfeed34fe1905026655ccf547fcfbaed81cea43f';
export const PREFLIGHT_OLD_MONITOR_HASH='5aa5edfd4d7fa073e4975c962987515db9bac2ae821c1275142b5a8cf1aee8d3';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export function validatePreflightProof(bytes,serverUuid,previousBuildFingerprint,p){
 try{
  const s=sanitizeNativeSource(JSON.parse(bytes.toString('utf8'))),idle=p?.priorIdle,q=s?.guestSlot;
  if(!s||s.serverUuid!==serverUuid||q?.state!=='QUARANTINED'||q.reason!=='SOURCE_PERSIST_FAILED')return false;
  if(previousBuildFingerprint!==PREFLIGHT_OLD_BUILD||p?.oldBuildFingerprint!==PREFLIGHT_OLD_BUILD||p.oldMonitorHash!==PREFLIGHT_OLD_MONITOR_HASH)return false;
  if(p.version!==1||p.kind!=='NO_GUEST_STARTED_PREFLIGHT'||p.sourceHash!==hash(bytes)||p.serverUuid!==serverUuid||p.instanceUuid!==s.instanceUuid||p.sourceSeq!==s.seq)return false;
  if(p.normalExitVerified!==true||p.hostGuestControlChildren!==0||p.attemptedVm!==null||p.attemptedVmKnown!==false||!/^[0-9a-f]{64}$/.test(idle?.rowHash||''))return false;
  if(!Number.isSafeInteger(idle.seq)||idle.seq<1||idle.seq>=s.seq)return false;
  const clean=Date.parse(idle.sourceAt),slot=Date.parse(idle.slotObservedAt),failure=Date.parse(q.observedAt),audit=Date.parse(p.at);
  if(![clean,slot,failure,audit].every(Number.isFinite)||slot>clean||clean<Date.parse(s.startedAt)||clean>=failure||failure-clean>120000||audit<Date.parse(s.observedAt))return false;
  // The pinned branch is unreachable after uncertain cleanup: guestQuarantined
  // stops runStep before admission. Core axes carry probe START, not completion,
  // so a completed read may fall between the sampled IDLE row and next admission.
  // Responsive axes alone are NOT exit proof; all hash/control-flow guards above
  // remain mandatory. Later HOST proxy results belong to a separate lane.
  for(const sample of s.samples){
   const m=sample.monitor,axes=['guest','app','network'];
   if(!axes.some(k=>m[k]&&Date.parse(m[k].observedAt)>clean))continue;
   const t=Date.parse(m.guest?.observedAt);
   if(!Number.isFinite(t)||t<=clean||t>=failure||t<Date.parse(s.startedAt)
    ||!axes.every(k=>m[k]&&m[k].observedAt===m.guest.observedAt)
    ||m.guest.additions!=='PRESENT'||m.guest.response!=='RESPONSIVE'
    ||m.app.connection!=='NOT_OBSERVED'||m.network.provenance!=='GUEST'
    ||m.network.ncsi!=='UNKNOWN'||m.network.https!=='UNKNOWN')return false;
  }
  return true;
 }catch{return false;}
}
