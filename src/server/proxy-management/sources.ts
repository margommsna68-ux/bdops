import {createHash,randomUUID,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt} from '@/lib/encryption';
import {parseProxy} from './parse';
import {withProxyTransaction} from './transaction';
import {ProxyDomainError,type ParsedProxy,type SheetSource,type SheetSnapshot,type SourceEvidence,type SourceSnapshot,type SourceSnapshotRef} from './types';
export interface WorkbookCell {a1:string;row:number;column:number;value:string;note?:string;formula?:string}
export interface Workbook {spreadsheetId:string;tabs:{id:string;name:string;hidden:boolean;cells:WorkbookCell[]}[]}
export function scanWorkbook(book:Workbook,sourceKey:string):SourceSnapshot{
  if(!book.spreadsheetId||!Array.isArray(book.tabs)||!book.tabs.length) throw new ProxyDomainError('SOURCE_UNAVAILABLE');
  const evidence:SourceEvidence[]=[];
  const normalized=book.tabs.map(tab=>({id:String(tab.id),name:tab.name,hidden:!!tab.hidden,cells:tab.cells.map(c=>({a1:c.a1,row:c.row,column:c.column,value:String(c.value||''),note:c.note||'',formula:c.formula||''})).sort((a,b)=>a.row-b.row||a.column-b.column)})).sort((a,b)=>a.id.localeCompare(b.id));
  for(const tab of normalized){
    const subgroup=/^pc$|pc\s*[/_-]?\s*chung/i.test(tab.name)?'PC_CHUNG' as const:null;
    for(const cell of tab.cells){
      const tokenPattern=/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+:[^:\s]+:\S+)?/g;
      const hasAnnotation=(value:string)=>!!value.replace(tokenPattern,'').replace(/[\s|,;\\]+/g,'');
      const metadata=!!cell.note||!!cell.formula||hasAnnotation(cell.value)||tab.cells.some(c=>c.row===cell.row&&c.a1!==cell.a1&&(!!c.note||!!c.formula||hasAnnotation(c.value)||([8,9,10].includes(c.column)&&!!c.value)));
      const found=new Map<string,ParsedProxy>();
      for(const text of [cell.value,cell.note,cell.formula]){
        const tokens=text.match(tokenPattern)||[];
        for(const token of tokens){try{const p=parseProxy(token);if(!found.has(p.ip)||p.format==='FULL') found.set(p.ip,p);}catch{
          // Invalid endpoint suffix still proves a valid IP belongs to Genjy.
          try{const p=parseProxy(token.split(':')[0]);if(!found.has(p.ip)) found.set(p.ip,p);}catch{}
        }}
      }
      found.forEach(p=>evidence.push({sourceRef:`${book.spreadsheetId}/${tab.id}/${cell.a1}`,ip:p.ip,owner:'GENJY',subgroup,format:p.format,hasFullCredentials:p.format==='FULL',hasManualMetadata:metadata||[cell.value,cell.note,cell.formula].some(value=>(value.match(tokenPattern)||[]).some(token=>token.startsWith(p.ip+':')&&p.format==='BARE')),proxy:p}));
    }
  }
  return {id:randomUUID(),sourceKey,hash:createHash('sha256').update(JSON.stringify({scannerVersion:2,spreadsheetId:book.spreadsheetId,tabs:normalized,evidence})).digest('hex'),fetchedAt:new Date().toISOString(),scanSucceeded:true,evidence,tabs:normalized.map(t=>({id:t.id,name:t.name,hidden:t.hidden}))};
}
const tokenCache=new Map<string,{token:string;expires:number}>();
async function accessToken(ref:string,fetcher:typeof fetch):Promise<string>{
  if(!/^[A-Z][A-Z0-9_]*$/.test(ref)) throw new ProxyDomainError('SOURCE_UNAVAILABLE');
  const direct=process.env[ref+'_ACCESS_TOKEN'];if(direct) return direct;
  const cached=tokenCache.get(ref);if(cached&&cached.expires>Date.now()+30000) return cached.token;
  let body:URLSearchParams;
  const service=process.env[ref+'_SERVICE_ACCOUNT_JSON'];
  if(service){
    const account=JSON.parse(service) as {client_email:string;private_key:string};
    const now=Math.floor(Date.now()/1000),b64=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:account.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
    const assertion=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),account.private_key).toString('base64url');
    body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion});
  } else {
    const refresh=process.env[ref+'_REFRESH_TOKEN'],client=process.env[ref+'_CLIENT_ID'];
    if(!refresh||!client) throw new ProxyDomainError('SOURCE_UNAVAILABLE');
    body=new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh,client_id:client});
    const secret=process.env[ref+'_CLIENT_SECRET'];if(secret) body.set('client_secret',secret);
  }
  const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new ProxyDomainError('SOURCE_UNAVAILABLE');
  const data=await response.json() as {access_token?:string;expires_in?:number};if(!data.access_token) throw new ProxyDomainError('SOURCE_UNAVAILABLE');
  tokenCache.set(ref,{token:data.access_token,expires:Date.now()+(data.expires_in||3600)*1000});return data.access_token;
}
function columnName(n:number){let value='';while(n>0){n--;value=String.fromCharCode(65+n%26)+value;n=Math.floor(n/26);}return value;}
function googleWorkbook(data:any):Workbook{
  if(!Array.isArray(data.sheets)||!data.sheets.length) throw new ProxyDomainError('SOURCE_UNAVAILABLE');
  return {spreadsheetId:data.spreadsheetId,tabs:data.sheets.map((sheet:any)=>({id:String(sheet.properties.sheetId),name:sheet.properties.title,hidden:!!sheet.properties.hidden,cells:(sheet.data||[]).flatMap((grid:any)=>(grid.rowData||[]).flatMap((row:any,rowIndex:number)=>(row.values||[]).map((cell:any,columnIndex:number)=>{
    const rowNumber=(grid.startRow||0)+rowIndex+1,column=(grid.startColumn||0)+columnIndex+1;
    const effective=cell.effectiveValue||cell.userEnteredValue||{};
    return {a1:columnName(column)+rowNumber,row:rowNumber,column,value:String(effective.stringValue??effective.numberValue??effective.boolValue??''),formula:cell.userEnteredValue?.formulaValue||'',note:cell.note||''};
  }))) }))};
}
export async function fetchGenjySnapshot(source:SheetSource,options:{fetch?:typeof fetch}={}):Promise<SourceSnapshot>{
  try{
    if(source.key!=='GENJY') throw new ProxyDomainError('SOURCE_UNAVAILABLE');
    if(source.mode==='LOCAL_SNAPSHOT'){
      if(!source.localSnapshotPath) throw new ProxyDomainError('SOURCE_UNAVAILABLE');
      return scanWorkbook(JSON.parse(readFileSync(source.localSnapshotPath,'utf8')) as Workbook,source.key);
    }
    const fetcher=options.fetch||fetch,token=await accessToken(source.credentialRef,fetcher);
    const query=new URLSearchParams({includeGridData:'true',fields:'spreadsheetId,sheets(properties(sheetId,title,hidden),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,note))))'});
    const response=await fetcher(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(source.spreadsheetId)}?${query}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
    if(!response.ok) throw new ProxyDomainError('SOURCE_UNAVAILABLE');
    return scanWorkbook(googleWorkbook(await response.json()),source.key);
  }catch{return {id:randomUUID(),sourceKey:'GENJY',hash:'UNAVAILABLE',fetchedAt:new Date().toISOString(),scanSucceeded:false,evidence:[]};}
}
export async function persistSourceSnapshot(projectId:string,snapshot:SourceSnapshot,db:PrismaClient=prisma):Promise<SourceSnapshotRef>{
  return withProxyTransaction(async tx=>{
    const latest=await tx.proxySourceSnapshot.findFirst({where:{projectId,sourceKey:snapshot.sourceKey},orderBy:{fetchedAt:'desc'}});
    if(latest?.scanSucceeded&&snapshot.scanSucceeded&&latest.hash===snapshot.hash){
      await tx.proxySourceSnapshot.update({where:{id:latest.id},data:{fetchedAt:new Date(snapshot.fetchedAt)}});
      return {id:latest.id,sourceKey:snapshot.sourceKey,hash:snapshot.hash,fetchedAt:snapshot.fetchedAt,scanSucceeded:true};
    }
    const record=await tx.proxySourceSnapshot.create({data:{id:snapshot.id,projectId,sourceKey:snapshot.sourceKey,hash:snapshot.hash,fetchedAt:new Date(snapshot.fetchedAt),scanSucceeded:snapshot.scanSucceeded,metadata:{tabs:snapshot.tabs||[],evidenceCount:snapshot.evidence.length},encryptedPayload:snapshot.scanSucceeded?encrypt(JSON.stringify(snapshot)):null}});
    if(snapshot.scanSucceeded){
      for(const evidence of snapshot.evidence){
        const previous=await tx.proxyIdentity.findUnique({where:{ip:evidence.ip}});
        const subgroup=previous?.subgroup==='PC_CHUNG'?'PC_CHUNG':evidence.subgroup;
        const identity=previous?
          (previous.owner==='GENJY'&&previous.subgroup===subgroup?previous:await tx.proxyIdentity.update({where:{id:previous.id},data:{owner:'GENJY',subgroup,revision:{increment:1},lastSeenAt:new Date()}})):
          await tx.proxyIdentity.create({data:{ip:evidence.ip,owner:'GENJY',subgroup}});
        await tx.proxySourceReference.create({data:{snapshotId:record.id,identityId:identity.id,sourceRef:evidence.sourceRef,format:evidence.format,owner:'GENJY',subgroup,hasFullCredentials:evidence.hasFullCredentials,hasManualMetadata:evidence.hasManualMetadata,dataCipher:encrypt(JSON.stringify(evidence))}});
      }
    }
    return {id:record.id,sourceKey:record.sourceKey,hash:record.hash,fetchedAt:record.fetchedAt.toISOString(),scanSucceeded:record.scanSucceeded};
  },db);
}
export async function refreshGenjy(projectId:string,db:PrismaClient=prisma):Promise<SourceSnapshotRef>{
  let source:SheetSource|null=null;
  try{if(process.env.GENJY_SOURCE_JSON) source=JSON.parse(process.env.GENJY_SOURCE_JSON);}catch{}
  const snapshot=source?await fetchGenjySnapshot(source):{id:randomUUID(),sourceKey:'GENJY',hash:'UNAVAILABLE',fetchedAt:new Date().toISOString(),scanSucceeded:false,evidence:[]};
  return persistSourceSnapshot(projectId,snapshot,db);
}
// Only the server's reviewed Sheet adapter calls this seam. It does not reserve identities
// or infer ownership from old notes; preview/commit resolves classified current rows.
export async function persistSheetSnapshot(projectId:string,sheet:SheetSnapshot,db:PrismaClient=prisma):Promise<SourceSnapshotRef>{
  if(!Array.isArray(sheet.rows)||!sheet.rows.length||sheet.rows.length>10000||!Array.isArray(sheet.snapshots)) throw new ProxyDomainError('INVALID_INPUT');
  if(sheet.snapshots.some(s=>!s.scanSucceeded)) throw new ProxyDomainError('SOURCE_UNAVAILABLE');
  for(const row of sheet.rows){
    if(!row.sourceRef||!['CURRENT_INVENTORY','LOOKUP_HISTORY','VM','GENJY_REFERENCE','OWNER_DECISION'].includes(row.kind)||!['SELF','GENJY','UNKNOWN'].includes(row.owner)||!['BLANK','FORMULA','PLACEHOLDER','UNRESOLVED','FULL'].includes(row.valueState)||!['PC_CHUNG',null].includes(row.subgroup)) throw new ProxyDomainError('INVALID_INPUT');
    if(row.proxy){
      const p=row.proxy;parseProxy(p.format==='BARE'?p.ip:`${p.ip}:${p.port}:${p.username}:${p.password}`);
    }
  }
  const normalized={snapshots:sheet.snapshots,rows:sheet.rows.map(({snapshotId:_snapshotId,...row})=>row)};
  const hash=createHash('sha256').update(JSON.stringify({rows:normalized.rows,sources:sheet.snapshots.map(s=>({sourceKey:s.sourceKey,hash:s.hash}))})).digest('hex');
  return withProxyTransaction(async tx=>{
    const existing=await tx.proxySourceSnapshot.findFirst({where:{projectId,sourceKey:'PERSONAL_SHEET',hash,scanSucceeded:true}});
    const record=existing||await tx.proxySourceSnapshot.create({data:{projectId,sourceKey:'PERSONAL_SHEET',hash,scanSucceeded:true,metadata:{rowCount:sheet.rows.length},encryptedPayload:encrypt(JSON.stringify(normalized))}});
    return {id:record.id,sourceKey:record.sourceKey,hash:record.hash,fetchedAt:record.fetchedAt.toISOString(),scanSucceeded:record.scanSucceeded};
  },db);
}
