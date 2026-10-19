import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
// "Đồng ấm" colours are generated from the source (scripts/build-bronze-theme.cjs, first step of `npm run build`). The committed file
// must be exactly what the source gives, and generating twice must give the same text, so a new colour class or a hard-coded colour
// added to the app CSS is never released without its bronze rule.
const {generate,out}=createRequire(import.meta.url)('../../../scripts/build-bronze-theme.cjs') as {generate:()=>{css:string};out:string};
describe('theme Đồng ấm colours stay in sync with the source',()=>{
  it('the committed generated CSS is up to date and generation is stable',()=>{
    const a=generate().css,b=generate().css;
    expect(b).toBe(a);
    expect(readFileSync(out,'utf8').replace(/\r\n/g,'\n')).toBe(a);
  });
  it('every generated rule stays inside the bronze theme',()=>{
    const rules=generate().css.split('\n').filter(l=>l&&!l.startsWith('/*'));
    expect(rules.length).toBeGreaterThan(300);
    for(const r of rules){const sel=r.startsWith('@media')?r.slice(r.indexOf('{')+1):r;expect(sel.slice(0,sel.indexOf('{')).split(',').every(s=>s.trim().startsWith('[data-theme="bronze"]'))).toBe(true);}
  });
});
