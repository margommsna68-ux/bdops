import {expect} from 'vitest';
import {readFileSync} from 'node:fs';
// OpenAPI conformance for the ops API tests: every answer checked against docs/ops-api/openapi.json (closed objects: an undocumented
// field fails). Shared by the review tests and the real-machine work tests (21/10/2026).
export const SPEC=JSON.parse(readFileSync('docs/ops-api/openapi.json','utf8'));
type Sch={$ref?:string;type?:string;nullable?:boolean;enum?:unknown[];properties?:Record<string,Sch>;required?:string[];additionalProperties?:boolean|Sch;items?:Sch;allOf?:Sch[]};
function conform(schema:Sch,v:unknown,path:string,out:string[]){
  if(schema.$ref){conform(SPEC.components.schemas[schema.$ref.split('/').pop()!],v,path,out);return;}
  if(v===null){if(!schema.nullable&&!(schema.enum||[]).includes(null))out.push(path+': null not allowed');return;}
  if(schema.allOf){for(const s of schema.allOf)conform(s,v,path,out);}
  if(schema.enum&&!schema.enum.includes(v))out.push(path+': '+JSON.stringify(v)+' not in enum');
  const t=schema.type;
  if(t==='string'&&typeof v!=='string')out.push(path+': not a string');
  if(t==='integer'&&!Number.isInteger(v))out.push(path+': not an integer');
  if(t==='boolean'&&typeof v!=='boolean')out.push(path+': not a boolean');
  if(t==='array'){if(!Array.isArray(v)){out.push(path+': not an array');return;}v.forEach((x,i)=>schema.items&&conform(schema.items,x,path+'['+i+']',out));}
  if(t==='object'){
    if(typeof v!=='object'||Array.isArray(v)){out.push(path+': not an object');return;}const o=v as Record<string,unknown>;
    for(const k of schema.required||[])if(!(k in o))out.push(path+'.'+k+': missing');
    for(const [k,x] of Object.entries(o)){const p=schema.properties?.[k];if(p)conform(p,x,path+'.'+k,out);else if(schema.additionalProperties===false)out.push(path+'.'+k+': not documented');else if(typeof schema.additionalProperties==='object')conform(schema.additionalProperties,x,path+'.'+k,out);}
  }
}
const TEMPLATES=Object.keys(SPEC.paths).map(t=>({t,re:new RegExp('^'+t.replace(/^\//,'').replace(/\{id\}/g,'[^/]+')+'$')})).sort((x,y)=>(x.t.match(/\{/g)||[]).length-(y.t.match(/\{/g)||[]).length);
export const checked=new Set<string>();
export function expectConforms(method:string,path:string,r:{status:number;json:unknown}){
  const p=path.split('?')[0],tpl=TEMPLATES.find(x=>x.re.test(p)&&SPEC.paths[x.t][method.toLowerCase()])!.t,resp=SPEC.paths[tpl][method.toLowerCase()].responses[String(r.status)];
  expect(resp,method+' '+tpl+' documents '+r.status).toBeTruthy();
  const errs:string[]=[];conform(resp.content['application/json'].schema,r.json,'$',errs);expect(errs.join(' ; '),method+' '+tpl+' '+r.status).toBe('');checked.add(method+' '+tpl+' '+r.status);
}
