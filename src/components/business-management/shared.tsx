"use client";
import {useRef,type ReactNode} from 'react';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {commandKeyStore} from './workflow';
export type BusinessOutputs=inferRouterOutputs<AppRouter>['businessManagement'];
export function useBusinessKey(){const key=useRef(commandKeyStore(()=>crypto.randomUUID()));return key.current;}
export function useBusinessRefresh(){const utils=trpc.useUtils();return ()=>Promise.all([utils.businessManagement.invalidate(),utils.vmManagement.invalidate(),utils.proxyManagement.operations.invalidate(),utils.notification.alerts.invalidate()]);}
export function BusinessDialog({title,description,busy,onClose,children}:{title:string;description:string;busy?:boolean;onClose:()=>void;children:ReactNode}){return <Dialog open onOpenChange={v=>{if(!v&&!busy)onClose();}}><DialogContent className="pm-dialog max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>{children}</DialogContent></Dialog>;}
export function SaveBar({busy,onClose,label='Lưu',disabled=false}:{busy:boolean;onClose:()=>void;label?:string;disabled?:boolean}){return <div className="flex gap-2 justify-end pt-2"><button type="button" className="pm-button" disabled={busy} onClick={onClose}>Đóng</button><button type="submit" className="pm-button pm-button-primary" disabled={busy||disabled}>{busy?'Đang lưu…':label}</button></div>;}
export function ErrorNotice({error}:{error?:{message:string}|null}){return error?<p role="alert" className="pm-error text-sm">{error.message}</p>:null;}
