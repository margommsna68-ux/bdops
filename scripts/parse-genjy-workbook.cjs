// Isolated, read-only XLSX parser. The caller also caps download bytes and time.
const {parentPort,workerData}=require('node:worker_threads');
const path=require('node:path').posix;
const XLSX=require('xlsx');
const {SaxesParser}=require('saxes');
const MAX_EXPANDED=20*1024*1024,MAX_ENTRIES=4096,MAX_CELLS=50000;

function assertZipBudget(input){
 let end=-1;for(let i=input.length-22;i>=Math.max(0,input.length-65557);i--)if(input.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0||end+22+input.readUInt16LE(end+20)!==input.length||input.readUInt16LE(end+4)!==0||input.readUInt16LE(end+6)!==0)throw Error('Invalid ZIP directory');
 const entries=input.readUInt16LE(end+10),size=input.readUInt32LE(end+12),start=input.readUInt32LE(end+16);
 if(entries>MAX_ENTRIES||entries===65535||entries!==input.readUInt16LE(end+8)||start+size!==end)throw Error('Unsupported ZIP directory');
 let at=start,expanded=0;const names=new Set();
 for(let i=0;i<entries;i++){
  if(at+46>end||input.readUInt32LE(at)!==0x02014b50)throw Error('Invalid ZIP entry');
  const length=input.readUInt16LE(at+28),extra=input.readUInt16LE(at+30),comment=input.readUInt16LE(at+32),bytes=input.readUInt32LE(at+24),next=at+46+length+extra+comment;
  if(next>end||bytes===0xffffffff)throw Error('Unsupported ZIP entry');
  const name=input.subarray(at+46,at+46+length).toString('utf8');
  if(names.has(name)||name.includes('..')||name.startsWith('/'))throw Error('Invalid ZIP path');names.add(name);
  expanded+=bytes;if(expanded>MAX_EXPANDED)throw Error('Expanded workbook too large');at=next;
 }
 if(at!==end)throw Error('Incomplete ZIP directory');
 return {entries,expanded};
}
function parseXml(input){
 const parser=new SaxesParser(),nodes=[];let root='';
 parser.on('error',error=>{throw error;});parser.on('doctype',()=>{throw Error('DOCTYPE not allowed');});
 parser.on('opentag',tag=>{const name=tag.name.split(':').pop();if(!root)root=name;if(['sheet','Relationship'].includes(name))nodes.push({name,attributes:tag.attributes});});
 parser.write(input).close();if(!root)throw Error('XML root missing');return {root,nodes};
}
function parseWorkbook(input,spreadsheetId){
 assertZipBudget(input);
 const zip=XLSX.CFB.read(input,{type:'buffer'}),parts=new Map();let expanded=0;
 for(let i=0;i<zip.FullPaths.length;i++){
  const entry=zip.FileIndex[i];if(entry.type!==2||!entry.content)continue;
  const name=zip.FullPaths[i].replace(/^[^/]+\//,'');if(name==='\x01Sh33tJ5')continue;
  const bytes=Buffer.from(entry.content);expanded+=bytes.length;if(expanded>MAX_EXPANDED||parts.has(name))throw Error('Expanded workbook too large');parts.set(name,bytes);
 }
 const xml=new Map();let cells=0;
 for(const [name,bytes]of parts)if(/\.(xml|rels)$/.test(name)){
  const parsed=parseXml(bytes.toString('utf8'));xml.set(name,parsed);
  const expected=/\/worksheets\/[^/]+\.xml$/.test(name)?'worksheet':/\/comments[^/]*\.xml$/.test(name)?'comments':name==='xl/workbook.xml'?'workbook':name.endsWith('.rels')?'Relationships':null;
  if(expected&&parsed.root!==expected)throw Error('Unexpected XML root');
  // Bound cell count before SheetJS constructs cell objects.
  if(expected==='worksheet'){const count=(bytes.toString('utf8').match(/<(?:\w+:)?c(?:\s|>)/g)||[]).length;cells+=count;if(cells>MAX_CELLS)throw Error('Too many workbook cells');}
 }
 const workbook=xml.get('xl/workbook.xml'),relationships=xml.get('xl/_rels/workbook.xml.rels');if(!workbook||!relationships)throw Error('Workbook references missing');
 for(const [name,parsed]of xml)if(name.endsWith('.rels')){
  const base=path.dirname(name).replace(/(?:^|\/)\_rels$/,'');
  for(const node of parsed.nodes)if(node.name==='Relationship'&&node.attributes.TargetMode!=='External'){
   const target=node.attributes.Target;if(typeof target!=='string')throw Error('Invalid relationship');
   const part=target.startsWith('/')?target.slice(1):path.normalize(path.join(base,target));if(!parts.has(part))throw Error('Referenced workbook part missing');
  }
 }
 const sheetNodes=workbook.nodes.filter(node=>node.name==='sheet');if(!sheetNodes.length||sheetNodes.length>500)throw Error('Invalid sheet count');
 for(const sheet of sheetNodes){
  const rel=relationships.nodes.find(node=>node.attributes.Id===sheet.attributes['r:id']);const target=rel?.attributes.Target;
  if(!target||!xml.get(target.startsWith('/')?target.slice(1):path.normalize(path.join('xl',target)))||!String(rel.attributes.Type).endsWith('/worksheet'))throw Error('Worksheet missing');
 }
 const book=XLSX.read(input,{type:'buffer',cellFormula:true,cellText:true});
 if(book.SheetNames.length!==sheetNodes.length)throw Error('Incomplete workbook');
 const tabs=book.SheetNames.map((name,index)=>{
  const sheet=book.Sheets[name];if(!sheet)throw Error('Worksheet missing');
  const values=Object.keys(sheet).filter(a1=>!a1.startsWith('!')).map(a1=>{const cell=sheet[a1],p=XLSX.utils.decode_cell(a1);return {a1,row:p.r+1,column:p.c+1,value:String(cell.v??''),formula:cell.f||'',note:(cell.c||[]).map(c=>c.t||'').join('\n')};});
  return {id:String(index),name,hidden:!!book.Workbook?.Sheets?.[index]?.Hidden,cells:values};
 });
 return {spreadsheetId,tabs};
}
module.exports={assertZipBudget,parseWorkbook};
if(parentPort){try{parentPort.postMessage({ok:true,workbook:parseWorkbook(Buffer.from(workerData.bytes),workerData.spreadsheetId)});}catch{parentPort.postMessage({ok:false});}}
