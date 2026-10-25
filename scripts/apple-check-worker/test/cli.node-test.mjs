import test from 'node:test';import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),entry=fileURLToPath(new URL('../worker.mjs',import.meta.url));
test('CLI version runs without token or browser and errors never echo supplied secrets',async()=>{
  const {stdout}=await exec(process.execPath,[entry,'version']);assert.equal(JSON.parse(stdout).version,'1.0.0');
  try{await exec(process.execPath,[entry,'once','--token','private-secret']);assert.fail('must reject');}
  catch(e){assert.equal(e.code,1);assert.equal(e.stdout.includes('private-secret'),false);assert.equal(e.stderr.includes('private-secret'),false);}
});
