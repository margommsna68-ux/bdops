"use client";
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
export type VMWorkspace=inferRouterOutputs<AppRouter>['vmManagement']['workspace'];
export type ManagedVM=VMWorkspace['vms'][number];
export function useVMRefresh(){const utils=trpc.useUtils();return ()=>Promise.all([
  utils.vmManagement.workspace.invalidate(),utils.vmManagement.orphanTasks.invalidate(),utils.vmManagement.eligible.invalidate(),utils.vmManagement.access.invalidate(),
  utils.proxyManagement.list.invalidate(),utils.proxyManagement.timeline.invalidate(),utils.proxyManagement.operations.invalidate(),utils.notification.alerts.invalidate(),
  utils.businessManagement.invalidate(),
]);}
export const errorMessage=(e:unknown)=>e instanceof Error?e.message:'Chưa nhận được kết quả. Tải lại để kiểm tra.';
