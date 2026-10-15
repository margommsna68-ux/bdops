import {businessFixture,businessDB} from './business-fixture';
export {businessDB};
export async function teamCashFixture(mode:'PROXY_VM'|'PAYPAL_ONLY'='PROXY_VM'){
 const f=await businessFixture();
 await businessDB.project.update({where:{id:f.scope.projectId},data:{type:mode==='PAYPAL_ONLY'?'PAYPAL_ONLY':'FULL',settings:mode==='PAYPAL_ONLY'?{teamCashEnabled:true}:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
 return f;
}
