import {config} from 'dotenv';
import {PrismaClient} from '@prisma/client';
import {createManagedServer} from '../src/server/vm-management/metadata';
config({quiet:true});
async function main(){
  const target=new URL(process.env.DATABASE_URL||'');
  if(target.hostname!=='127.0.0.1'||target.port!=='55432'||target.pathname!=='/proxy_app_trial'||process.env.APP_ENV!=='trial')throw new Error('Dedicated synthetic trial required');
  const db=new PrismaClient();try{
    const project=await db.project.findUniqueOrThrow({where:{code:'PROXY_TRIAL'}}),user=await db.user.findUniqueOrThrow({where:{username:'proxy-trial'}});
    if((project.settings as {businessMode?:string})?.businessMode!=='PROXY_VM')throw new Error('Trial project mismatch');
    if(!await db.server.findFirst({where:{projectId:project.id,code:'demo-server'}})){
      const server=await createManagedServer({projectId:project.id,userId:user.id,role:'ADMIN',capabilities:[]},{code:'demo-server',vmCodes:['VM_001','VM_002','VM_003','FORMULA_004','NOTE_005','REVIEW_006']},db);
      for(const [code,state] of [['FORMULA_004','FORMULA'],['NOTE_005','PLACEHOLDER'],['REVIEW_006','UNRESOLVED']] as const)await db.virtualMachine.updateMany({where:{serverId:server.id,code},data:{proxySlotState:state,slotSourceRef:'SYNTHETIC_QA'}});
    }
    console.log('Synthetic server ready: 3 blank VM slots and 3 preserved review slots. No real machines imported.');
  }finally{await db.$disconnect();}
}
main().catch(()=>{console.error('VM trial bootstrap failed. No secrets printed.');process.exitCode=1;});
