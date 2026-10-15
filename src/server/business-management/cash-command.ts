import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import type {ActorScope} from '../proxy-management/types';
import {runBusinessCommand,type BusinessCollector} from './idempotency';
import type {CashArea} from './team-cash-scope';
export function runCashCommand<T extends Record<string,unknown>>(scope:ActorScope,input:{key:string;payload:unknown;kind:string;module:CashArea;reversible?:boolean},fn:(tx:Prisma.TransactionClient,images:BusinessCollector,current:ActorScope)=>Promise<T>,db:PrismaClient=prisma){
 return runBusinessCommand(scope,{...input,cash:true},fn,db);
}
