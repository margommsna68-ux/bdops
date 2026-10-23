import {expect,it} from 'vitest';
import {EventEmitter} from 'node:events';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const client=await import(pathToFileURL(resolve('scripts/ops-client.mjs')).href);

it('consumes pasted characters up to the first newline, ignoring remaining pasted data',()=>{
  expect(client.hiddenInputChunk('','123456\r\nignored')).toEqual({value:'123456',action:'submit'});
  expect(client.hiddenInputChunk('12','3456\nignored')).toEqual({value:'123456',action:'submit'});
  expect(client.hiddenInputChunk('12','34')).toEqual({value:'1234',action:'continue'});
});
it('handles both backspace forms, empty input and Ctrl+C within a pasted chunk',()=>{
  expect(client.hiddenInputChunk('','\b\x7f12\b3\x7f45\r')).toEqual({value:'145',action:'submit'});
  expect(client.hiddenInputChunk('12','3\x03ignored\r')).toEqual({value:'',action:'cancel'});
});

function terminal(wasRaw=false){
  const input=Object.assign(new EventEmitter(),{
    isTTY:true,isRaw:wasRaw,paused:true,
    setRawMode(value:boolean){this.isRaw=value;},
    setEncoding(_encoding:string){},
    resume(){this.paused=false;},pause(){this.paused=true;},
  });
  let text='';const output={write(value:string){text+=value;}};
  return {input,output,text:()=>text};
}
it('hidden() resolves a pasted code without echo and restores raw mode/listeners',async()=>{
  const t=terminal();const result=client.hidden('Code: ',t.input,t.output);
  t.input.emit('data','123456\r\nignored');
  expect(t.input.isRaw).toBe(false);expect(t.input.paused).toBe(true);
  expect(t.input.listenerCount('data')).toBe(0);expect(t.text()).toBe('Code: \n');
  expect(await result).toBe('123456');
});
it('hidden() restores the previous raw mode before rejecting Ctrl+C with exit 130',async()=>{
  const t=terminal(true);const result=client.hidden('Code: ',t.input,t.output);
  const assertion=expect(result).rejects.toMatchObject({exitCode:130});
  t.input.emit('data','123\x03ignored');
  expect(t.input.isRaw).toBe(true);expect(t.input.paused).toBe(true);
  expect(t.input.listenerCount('data')).toBe(0);expect(t.text()).toBe('Code: \n');
  await assertion;
});
