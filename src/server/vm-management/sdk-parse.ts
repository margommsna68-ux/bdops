export type SdkPasteIssue='BLANK'|'INVALID_SDK'|'TOO_MANY_COLUMNS'|null;
export interface SdkPasteRow {line:number;server:string|null;vm:string;sdk:string|null;issue:SdkPasteIssue}
const SDK_PATTERN=/^[A-Za-z0-9._:-]{8,128}$/;
export function normalizeSdk(value:string|null|undefined){const text=(value||'').trim();return SDK_PATTERN.test(text)?text:null;}
function splitLine(line:string){
  for(const separator of ['\t','|',';',',']){if(line.includes(separator))return line.split(separator).map(s=>s.trim());}
  const tokens=line.trim().split(/\s+/);return tokens.length>=2&&tokens.length<=3?tokens:[line.trim()];
}
const HEADER=/^(server|vm|sdk|máy|mã vm|sdk id|earnapp)$/i;
export function parseSdkPaste(text:string):SdkPasteRow[]{
  const rows:SdkPasteRow[]=[];const lines=text.replace(/\r/g,'').split('\n');
  lines.forEach((raw,index)=>{
    if(!raw.trim())return;const cells=splitLine(raw),line=index+1;
    if(index===0&&cells.length>=2&&cells.every(c=>HEADER.test(c)))return;
    if(cells.length>3){rows.push({line,server:null,vm:cells[0]||'',sdk:null,issue:'TOO_MANY_COLUMNS'});return;}
    const [server,vm,sdkCell]=cells.length===3?[cells[0],cells[1],cells[2]]:[null,cells[0],cells[1]??''];
    if(!sdkCell.trim()){rows.push({line,server,vm,sdk:null,issue:'BLANK'});return;}
    const sdk=normalizeSdk(sdkCell);rows.push({line,server,vm,sdk,issue:sdk?null:'INVALID_SDK'});
  });
  return rows;
}
