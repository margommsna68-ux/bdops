import {normalizeCostMoney} from '@/server/business-management/usdt-money';
export type CostForm={amount:string;currency:string;rate:string};
export function costPreview(input:CostForm):string|null{try{return normalizeCostMoney(input).usdt;}catch{return null;}}
export function changeCostCurrency(form:CostForm,currency:string):CostForm{return {...form,currency,rate:currency==='USDT'?'1':''};}
export function selectFinanceView(input:{businessMode:string|null;teamCashEnabled:boolean}){return input.teamCashEnabled?'TEAM_CASH':input.businessMode==='PROXY_VM'?'MANAGED_LEGACY_BASIS':'LEGACY';}
export function formatExact(text:string){if(!/^-?\d+(\.\d+)?$/.test(text))return text;const [whole,fraction='']=text.split('.'),decimals=fraction.replace(/0+$/,'');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(decimals?','+decimals:'');}
