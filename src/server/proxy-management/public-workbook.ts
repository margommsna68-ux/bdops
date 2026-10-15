import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import type {Workbook} from './sources';

const MAX_BYTES=20*1024*1024;
/** Read only a configured, link-shared Google workbook. No arbitrary URL or cookies. */
export async function fetchPublicWorkbook(spreadsheetId:string,fetcher:typeof fetch):Promise<Workbook>{
  if(!/^[A-Za-z0-9_-]{10,150}$/.test(spreadsheetId))throw new Error('Invalid spreadsheet ID');
  const response=await fetcher(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`,{signal:AbortSignal.timeout(20000),cache:'no-store'});
  if(!response.ok||Number(response.headers.get('content-length')||0)>MAX_BYTES||!response.body)throw new Error('Workbook unavailable');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;
  try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>MAX_BYTES)throw new Error('Workbook too large');parts.push(next.value);}}
  finally{await reader.cancel().catch(()=>{});}
  const input=Buffer.concat(parts);if(input.length<4||input[0]!==0x50||input[1]!==0x4b)throw new Error('Expected XLSX');
  return new Promise<Workbook>((resolve,reject)=>{
    const worker=new Worker(join(process.cwd(),'scripts/parse-genjy-workbook.cjs'),{workerData:{bytes:input,spreadsheetId},resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:32}});
    const timer=setTimeout(()=>{void worker.terminate();reject(new Error('Workbook parse timed out'));},8000);
    const finish=()=>{clearTimeout(timer);void worker.terminate();};
    worker.once('message',(result:{ok:boolean;workbook:Workbook})=>{finish();if(result.ok)resolve(result.workbook);else reject(new Error('Invalid workbook'));});
    worker.once('error',()=>{finish();reject(new Error('Workbook parser failed'));});
    worker.once('exit',()=>{clearTimeout(timer);reject(new Error('Workbook parser stopped'));});
  });
}
