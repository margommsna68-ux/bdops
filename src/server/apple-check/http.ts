import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,userMessage} from '../proxy-management/types';
import {ZodError} from 'zod';
import {hit} from '../ops-api/limits';
import {workerAction} from './service';
const json=(status:number,data:unknown,error:unknown=null)=>new Response(JSON.stringify({ok:error===null,data,error}),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function appleWorkerHttp(request:Request,action:string,db:PrismaClient=prisma){
 try{
  if(!['heartbeat','claim','route','submit','heartbeat-job','result','cleanup-recovered'].includes(action))return json(404,null,{code:'NOT_FOUND',message:'Không có lệnh này'});
  const match=/^Bearer (mth_apple_[A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization')??'');
  if(!match)return json(401,null,{code:'UNAUTHORIZED',message:'Cần token worker'});
  const digest=createHash('sha256').update(match[1]).digest('hex');
  const known=await db.appleCheckWorker.findFirst({where:{OR:[{tokenHash:digest},{previousTokenHash:digest}]},select:{id:true}});
  if(!known){const failed=await hit(db,'authFail','apple:unknown');return json(failed.over?429:403,null,{code:failed.over?'RATE_LIMITED':'FORBIDDEN',message:'Token worker không hợp lệ'});}
  const limit=await hit(db,'read','apple:'+digest);
  if(limit.over)return json(429,null,{code:'RATE_LIMITED',message:'Quá nhiều yêu cầu'});
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json(422,null,{code:'VALIDATION',message:'Chỉ nhận JSON'});
  if(Number(request.headers.get('content-length')??0)>4096)return json(413,null,{code:'VALIDATION',message:'Nội dung quá lớn'});
  // Stream bounded: a missing/forged Content-Length cannot load an unbounded body.
  const reader=request.body?.getReader();let bytes=0,text='';const decoder=new TextDecoder();
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>4096){await reader.cancel();return json(413,null,{code:'VALIDATION',message:'Nội dung quá lớn'});}text+=decoder.decode(value,{stream:true});}
  text+=decoder.decode();
  return json(200,await workerAction(match[1],action,JSON.parse(text||'{}'),db));
 }catch(e){
  if(e instanceof SyntaxError||e instanceof ZodError)return json(422,null,{code:'VALIDATION',message:'Nội dung không hợp lệ'});
  if(e instanceof ProxyDomainError){const status=e.code==='FORBIDDEN'?403:e.code==='NOT_FOUND'?404:e.code==='INVALID_INPUT'?422:409;return json(status,null,{code:e.code==='STALE_PREVIEW'?'REVISION_CONFLICT':e.code,message:userMessage(e)});}
  // Never return database/driver/decryption messages or worker bodies.
  return json(500,null,{code:'INTERNAL',message:'Không xử lý được yêu cầu; giữ nguyên việc và thử gửi lại kết quả'});
 }
}
