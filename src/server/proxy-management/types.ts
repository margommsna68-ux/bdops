export type Owner='SELF'|'GENJY'|'UNKNOWN';
export type Subgroup='PC_CHUNG'|null;
export type InventoryState='NEW'|'LIVE'|'BLOCKED'|'REPLACED'|'DIE'|'QUARANTINED'|'VOID';
export type BatchKind='NEW'|'BLOCKED'|'REPLACE'|'SHEET';
export type Outcome='READY'|'SKIP'|'ERROR';
export type IssueCode='INVALID_INPUT'|'COUNT_MISMATCH'|'DUPLICATE_INPUT'|'NOT_FOUND'|'AMBIGUOUS_OLD'|'NOT_BLOCKED'|'CURRENT_IP'|'HISTORICAL_IP'|'OWNER_CONFLICT'|'GENJY_RESERVED'|'SOURCE_UNAVAILABLE'|'STALE_PREVIEW'|'KEY_PAYLOAD_MISMATCH'|'UNKNOWN_PACKAGE'|'PACKAGE_MISMATCH'|'FORBIDDEN';
export class ProxyDomainError extends Error {
  constructor(public readonly code:IssueCode, message?:string){super(message?`${code}: ${message}`:code);this.name='ProxyDomainError';}
}
export interface ParsedProxy {ip:string;port:number|null;username:string|null;password:string|null;format:'BARE'|'FULL'}
export interface ActorScope {userId:string;projectId:string;role:'ADMIN'|'MODERATOR'|'USER'|'VIEWER';capabilities:string[];allowedModules?:string[];businessMode?:string;teamCashEnabled?:boolean}
export interface BatchInput {kind:BatchKind;text?:string;removedText?:string;addedText?:string;owner?:Owner;subgroup?:Subgroup;receivedDate?:string|null;snapshotIds?:string[];packageCode?:string|null;newPackage?:{code:string;site?:string|null}|null;idempotencyKey:string}
export interface Decision {outcome:Outcome;code?:IssueCode;message:string}
export interface PreviewRow extends Decision {row:number;oldIp?:string;newIp?:string;identityId?:string;endpointId?:string;owner?:Owner;subgroup?:Subgroup;packageCode?:string|null;sourceRefs:string[]}
export interface BatchPreview {token:string;kind:BatchKind;rows:PreviewRow[];ready:number;skipped:number;errors:number;expiresAt:string}
export interface CommitResult {batchId:string;replay:boolean;undone?:boolean;rows:PreviewRow[];applied:number;skipped:number;errors:number}
export interface CatalogAccount {id:string;code:string;username:string;password:string}
export interface IdentityFact {id:string;ip:string;owner:Owner;subgroup:Subgroup;revision:number;allocationMode:'SINGLE_IP'|'APPROVED_PORT_STREAM'}
export interface EndpointFact {id:string;projectId:string;identityId:string;proxy:ParsedProxy;inventoryState:InventoryState;retiredAt?:string|null;revision:number;vmKeys:string[]}
export interface SourceEvidence {sourceRef:string;ip:string;owner:Owner;subgroup:Subgroup;format:'BARE'|'FULL';hasFullCredentials:boolean;hasManualMetadata:boolean;proxy?:ParsedProxy}
export interface HistoryFact {ip:string;kind:'RECEIVED'|'BLOCKED'|'DIE'|'REPLACED'|'VOID';occurredAt:string|null;recordedAt:string}
export interface SourceSnapshotRef {id:string;sourceKey:string;hash:string;fetchedAt:string;scanSucceeded:boolean}
export interface SourceSnapshot extends SourceSnapshotRef {evidence:SourceEvidence[];tabs?:{id:string;name:string;hidden:boolean}[]}
export interface SheetSource {key:string;spreadsheetId:string;credentialRef:string;mode:'GOOGLE_AUTH'|'GOOGLE_PUBLIC_XLSX'|'LOCAL_SNAPSHOT';localSnapshotPath?:string}
export interface ProxyContext {identities:IdentityFact[];endpoints:EndpointFact[];evidence:SourceEvidence[];history:HistoryFact[];receipts:{oldIp:string;newIp:string;status:'APPLIED'|'VOID';oldEndpointId?:string;newEndpointId?:string}[];source:SourceSnapshotRef}
export interface ReplacementContext {old:EndpointFact|null;oldIdentity:IdentityFact|null;oldCandidates:number;next:ParsedProxy;nextEvidence:SourceEvidence[];nextIdentities:IdentityFact[];nextInInventory:boolean;nextInVmOrReservation:boolean;nextHistory:HistoryFact[];exactReceiptReplay:boolean;sourceScanSucceeded:boolean}
export interface SheetSnapshot {snapshots:SourceSnapshot[];rows:{sourceRef:string;rawValue:string;proxy:ParsedProxy|null;kind:'CURRENT_INVENTORY'|'LOOKUP_HISTORY'|'VM'|'GENJY_REFERENCE'|'OWNER_DECISION';owner:Owner;subgroup:Subgroup;vmKey:string|null;valueState:'BLANK'|'FORMULA'|'PLACEHOLDER'|'UNRESOLVED'|'FULL';snapshotId?:string}[]}
export interface ReconciliationPlan {rows:PreviewRow[];snapshots:SourceSnapshotRef[];ownership:{ip:string;owner:Owner;subgroup:Subgroup;sourceRefs:string[]}[];vmRefs:{vmKey:string;sourceRef:string;valueState:'BLANK'|'FORMULA'|'PLACEHOLDER'|'UNRESOLVED'|'FULL';endpointId:string|null}[]}
export interface EligibleProxy {identityId:string;endpointId:string;ip:string;port:number;revision:number;allocationKey:string}
// Sentinel for the server filter: rows that have no VM position at all.
export const UNASSIGNED_SERVER='__NONE__';
export type LocationRole='DESIRED'|'INSTALLED'|'UNCERTAIN'|null;
// One VM position of a proxy: a hold (role from the allocation) or the VM link recorded from the Sheet (role null). Server and VM stay separate fields; never parse display strings.
export interface RegistryLocation {serverId:string;serverCode:string;vmId:string;vmCode:string;role:LocationRole}
export interface RegistryFilter {owner?:Owner;packageCode?:string;state?:InventoryState;view:'CURRENT'|'HISTORY'|'ALL';search?:string;cursor?:string;limit:number;sort?:'PACKAGE'|'SERVER'|'STATUS'|'IP';due?:boolean;servers?:string[]}
export interface RegistryRow {identityId:string;endpointId:string|null;ip:string;port:number|null;owner:Owner;subgroup:Subgroup;packageCode:string|null;state:InventoryState;revision:number;sourceRefs:string[];locations:RegistryLocation[];statusAt?:string|null}
export interface RegistryPage {rows:RegistryRow[];nextCursor:string|null;counts:{current:number;historical:number;reserved:number;quarantined:number};total:number;servers:string[]}
export type CopySkipReason='NO_CREDENTIALS'|'NO_ENDPOINT';
export interface CopyResult {proxies:string[];copied:number;total:number;skipped:{reason:CopySkipReason;count:number}[]}
export interface ProxyTimeline {identity:IdentityFact;events:{kind:string;occurredAt:string|null;recordedAt:string;reversedAt?:string|null;actor:string|null;sourceRef:string|null}[];replacements:{oldIp:string;newIp:string;receivedDate:string|null;recordedAt:string;status:'APPLIED'|'VOID'}[];vmRefs:string[]}
