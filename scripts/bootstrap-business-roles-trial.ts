import {config} from 'dotenv';
import {PrismaClient} from '@prisma/client';
config({quiet:true});
async function main(){
 const target=new URL(process.env.DATABASE_URL||'');if(target.hostname!=='127.0.0.1'||target.port!=='55432'||target.pathname!=='/proxy_app_trial'||process.env.APP_ENV!=='trial')throw new Error('Dedicated synthetic trial required');
 const db=new PrismaClient();try{
  const project=await db.project.findUniqueOrThrow({where:{code:'PROXY_TRIAL'}}),owner=await db.user.findUniqueOrThrow({where:{username:'proxy-trial'}});if((project.settings as {businessMode?:string})?.businessMode!=='PROXY_VM'||!owner.password||!owner.pin)throw new Error('Trial identity mismatch');
  for(const [username,role] of [['business-operator-trial','USER'],['business-viewer-trial','VIEWER']] as const){
   const email=username+'@example.invalid',existing=await db.user.findUnique({where:{username}});if(existing&&existing.email!==email)throw new Error('Name is not a synthetic identity');
   const user=existing||await db.user.create({data:{username,email,name:role==='VIEWER'?'Chỉ xem — mẫu QA':'Vận hành — mẫu QA',password:owner.password,pin:owner.pin}});
   const member=await db.projectMember.findUnique({where:{userId_projectId:{userId:user.id,projectId:project.id}}});if(member&&(member.role!==role||JSON.stringify(member.allowedModules)!==JSON.stringify(['INFRASTRUCTURE'])||member.capabilities.length))throw new Error('Existing trial access differs; no overwrite');
   if(!member)await db.projectMember.create({data:{projectId:project.id,userId:user.id,role,allowedModules:['INFRASTRUCTURE'],capabilities:[]}});
  }
  console.log('Synthetic operator/viewer prepared with infrastructure only; no real account changed.');
 }finally{await db.$disconnect();}
}
main().catch(()=>{console.error('Synthetic role bootstrap refused or failed. No secrets printed.');process.exitCode=1;});
