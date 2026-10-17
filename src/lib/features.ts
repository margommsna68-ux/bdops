// Optional MoneyToHome (Proxy / VM) modules, switched in one place. Hidden modules keep their data, history, endpoints and checks;
// only the menu, dashboard, notifications and links stop pointing at them. Install / confirm work is done at the VM in Server / VM.
// Turn one back on with NEXT_PUBLIC_MTH_MODULES=INSTALL_TASKS,WORK (comma list, read at build time) and redeploy.
export type OptionalModule='INSTALL_TASKS'|'WORK';
export const OPTIONAL_MODULES:Record<OptionalModule,{label:string;path:string}>={
  INSTALL_TASKS:{label:'Việc cài proxy',path:'/vm-tasks'},
  WORK:{label:'Giao việc',path:'/work'},
};
export function parseModules(value:string|undefined):Set<OptionalModule>{
  return new Set((value||'').split(',').map(s=>s.trim().toUpperCase()).filter((s):s is OptionalModule=>s in OPTIONAL_MODULES));
}
const enabled=parseModules(process.env.NEXT_PUBLIC_MTH_MODULES);
export const moduleOn=(m:OptionalModule,set:Set<OptionalModule>=enabled)=>set.has(m);
