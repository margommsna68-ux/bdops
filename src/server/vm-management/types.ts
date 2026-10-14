import {createHash} from 'node:crypto';
import type {ParsedProxy} from '../proxy-management/types';
export interface AllocationInput {mode:'AUTO'|'MANUAL';serverId?:string;vmIds?:string[];endpointId?:string;idempotencyKey:string}
export interface AllocationRow {vmId:string;server:string;vm:string;outcome:'READY'|'SKIP'|'ERROR';ip?:string;endpointId?:string;message:string}
export interface AllocationPreview {token:string;rows:AllocationRow[];ready:number;errors:number;skipped:number}
export interface ConfigurationSnapshot {proxy:ParsedProxy;packageCode:string|null;identityId:string;endpointRevision:number;server:string;vm:string}
export const vmHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
