import type {PrismaClient,ProjectMember} from '@prisma/client';
import {TRPCError} from '@trpc/server';
export const publicUserFields={id:true,email:true,username:true,name:true,createdAt:true} as const;
export async function assertUserTarget(db:PrismaClient,member:ProjectMember,userId:string,write:boolean){
 const denied=()=>{throw new TRPCError({code:'FORBIDDEN',message:'Không có quyền quản lý tài khoản này'});},target=await db.projectMember.findUnique({where:{userId_projectId:{userId,projectId:member.projectId}}});if(!target)denied();
 if(member.role!=='ADMIN'){
  if(write&&(!member.canManageUsers||target!.role==='ADMIN'||target!.role==='MODERATOR'||target!.managerId!==member.id))denied();
  if(!write&&userId!==member.userId&&target!.managerId!==member.id)denied();
 }
 // A global login may grant access to several projects. Reset only if the caller
 // controls every affected project, otherwise use the account's owner.
 if(write){const other=await db.projectMember.findMany({where:{userId,projectId:{not:member.projectId}},select:{projectId:true}});if(other.length&&(member.role!=='ADMIN'||await db.projectMember.count({where:{userId:member.userId,projectId:{in:other.map(m=>m.projectId)},role:'ADMIN'}})!==other.length))denied();}
}
