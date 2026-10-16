export type CopyOutcome={ok:true}|{ok:false;text:string|null;error?:string};
// One click copies text that still has to be fetched. Browsers tie clipboard writes to the click, so a promise-backed
// ClipboardItem is handed over first (Safari/Chrome keep the gesture alive); otherwise the text is written once it
// arrives. When the clipboard refuses, the text is returned so the caller can show it for manual copy.
export async function copyWhenReady(load:()=>Promise<string>):Promise<CopyOutcome>{
  const pending=load();pending.catch(()=>{});
  const clipboard=typeof navigator!=='undefined'?navigator.clipboard:undefined;
  if(clipboard?.write&&typeof ClipboardItem!=='undefined'){
    try{await clipboard.write([new ClipboardItem({'text/plain':pending.then(t=>new Blob([t],{type:'text/plain'}))})]);return {ok:true};}
    catch{/* either the load failed (reported below) or this browser cannot take a promise */}
  }
  let text:string;
  try{text=await pending;}catch(e){return {ok:false,text:null,error:e instanceof Error?e.message:String(e)};}
  try{if(!clipboard?.writeText) throw new Error('no clipboard');await clipboard.writeText(text);return {ok:true};}catch{return {ok:false,text};}
}
