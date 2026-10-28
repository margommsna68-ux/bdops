import {z} from 'zod';
const id=z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const uuid=z.string().uuid().transform(v=>v.toLowerCase());
export const FleetAction=z.enum(['START_VM','SHUTDOWN_VM','POWER_OFF_VM','CHECK_HEALTH','CHECK_PROXY','REPLACE_PROXY','RECREATE_VM','READ_SDK']);
/** Read-type actions need ASSIGN; everything that changes the machine needs MANAGE. */
export const READ_ACTIONS:ReadonlyArray<z.infer<typeof FleetAction>>=['CHECK_HEALTH','CHECK_PROXY','READ_SDK'];
// AE answer summary. Never a proxy credential or a full SDK code: the tail (4 chars) is the only SDK fragment allowed.
export const FleetEvidenceDetail=z.object({code:z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),message:z.string().max(500),newMachineUuid:uuid.optional(),sdkTail:z.string().regex(/^[0-9a-f]{4}$/).optional()}).strict();
export const FleetIdentity=z.object({projectId:id,operationId:uuid}).strict();
export const FleetCreate=FleetIdentity.extend({serverId:id,vmId:id,machineUuid:uuid,expectedCycle:z.number().int().min(1),expectedVmRevision:z.number().int().min(0),configurationId:id.nullable(),action:FleetAction,ttlSeconds:z.number().int().min(30).max(900).default(300)}).strict();
export const FleetClaim=z.object({projectId:id,serverId:id,workerId:uuid}).strict();
export const FleetFence=FleetIdentity.extend({workerId:uuid,leaseEpoch:z.number().int().min(1)}).strict();
export const FleetNativeAuthorization=FleetFence.extend({authorizationId:uuid,serverUuid:uuid,machineUuid:uuid,action:FleetAction,expectedCycle:z.number().int().min(1),expectedVmRevision:z.number().int().min(0),configurationId:id.nullable(),requestHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const FleetStep=FleetFence.extend({stepId:uuid,phase:z.enum(['DISPATCH','PROGRESS']),code:z.enum(['RECEIVED','AE_ACCEPTED','VERIFYING','CANCEL_REQUESTED','RECONCILING']).optional()}).strict();
export const FleetEvidence=z.object({operationId:uuid,machineUuid:uuid,verified:z.boolean(),observedAt:z.string().datetime({offset:true}),vmState:z.enum(['RUNNING','POWERED_OFF','PAUSED','ABORTED','UNKNOWN']),aeOperationId:uuid,detail:FleetEvidenceDetail.optional()}).strict();
export const FleetComplete=FleetFence.extend({completionId:uuid,outcome:z.enum(['SUCCEEDED','FAILED','UNKNOWN']),evidence:FleetEvidence}).strict();
export const FleetList=z.object({projectId:id,serverId:id.optional()}).strict();
export const FleetControl=z.object({projectId:id,serverId:id,vmId:id}).strict();
export const FleetServerEnrollment=z.object({projectId:id,serverId:id,serverUuid:uuid}).strict();
export const FleetEnrollment=z.object({projectId:id,serverId:id,serverUuid:uuid,vmId:id,machineUuid:uuid,expectedCycle:z.number().int().min(1),configurationId:id.nullable()}).strict();
export type CreateInput=z.infer<typeof FleetCreate>;
