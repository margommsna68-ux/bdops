export type BusinessArea='INFRASTRUCTURE'|'PAYPALS'|'FUNDS'|'WITHDRAWALS'|'COSTS'|'PROFIT';
export type Currency='USD'|'VND';
// The PayPal ledger keeps any currency code as entered (USD, USDT, EUR, VND…); amounts of different codes are never added.
export const LEDGER_CURRENCY=/^[A-Z]{3,5}$/;
export type FinanceKind='FUND'|'WITHDRAWAL'|'COST';
export type BusinessResource='GMAIL'|'PAYPAL'|'PAYPAL_EMAIL'|'VM_BINDING'|'VM_SDK'|'WORK'|'COST'|'FUND'|'WITHDRAWAL'|'PROFIT'|'SPLIT_PAYMENT'|'TEAM_RECEIPT'|'COLLECTOR_EXPENSE'|'PACKAGE'|'EARNAPP'|'ACCOUNT_BATCH'|'PAYOUT'|'VM_OPS'|'PAYOUT_REQUEST'|'VM_CYCLE';
export type BusinessRow=Record<string,string|number|boolean|null>;
export type BusinessImage={resource:BusinessResource;id:string;before:BusinessRow|null;after:BusinessRow};
