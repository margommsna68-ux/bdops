import {Prisma, type PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
export async function withProxyTransaction<T>(fn:(tx:Prisma.TransactionClient)=>Promise<T>,db:PrismaClient=prisma):Promise<T>{
  for(let attempt=0;;attempt++){
    try{return await db.$transaction(fn,{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:5000,timeout:15000});}
    catch(error){if(!(error instanceof Prisma.PrismaClientKnownRequestError)||error.code!=='P2034'||attempt>=2) throw error;}
  }
}
