import type {Prisma} from '@prisma/client';
export async function lockCashProject(tx:Prisma.TransactionClient,projectId:string){
 await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`team-cash:${projectId}`},0))::text`;
}
