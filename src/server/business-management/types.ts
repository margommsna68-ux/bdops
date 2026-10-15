export type BusinessArea='INFRASTRUCTURE'|'PAYPALS'|'FUNDS'|'WITHDRAWALS'|'COSTS'|'PROFIT';
export type Currency='USD'|'VND';
export type FinanceKind='FUND'|'WITHDRAWAL'|'COST';
export type BusinessResource='GMAIL'|'PAYPAL'|'PAYPAL_EMAIL'|'VM_BINDING'|'WORK'|'COST'|'FUND'|'WITHDRAWAL'|'PROFIT'|'SPLIT_PAYMENT'|'TEAM_RECEIPT'|'COLLECTOR_EXPENSE';
export type BusinessRow=Record<string,string|number|boolean|null>;
export type BusinessImage={resource:BusinessResource;id:string;before:BusinessRow|null;after:BusinessRow};
