import {amountInput,canonicalAmount,parseSdkAmount} from '@/lib/sdk-money';
// The money / note fields of the SDK frame against the stored values of the code being saved. A field the person did not edit
// (undefined) shows the stored value and is never sent, so a store that loads after the code was typed can never clear money or a note
// (bug found in the browser acceptance 19/10/2026). An edited field that ends empty is an explicit clear (null).
export function sdkFormValues(stored:{amount:string|null;note:string|null},d:{amount?:string;note?:string}){
  const amountText=d.amount??amountInput(stored.amount),noteText=d.note??(stored.note||'');
  const parsed=d.amount!==undefined&&d.amount.trim()?parseSdkAmount(d.amount):null,amountValue=parsed&&'value' in parsed?parsed.value:null,amountError=parsed&&'error' in parsed?parsed.error:'';
  const amountChanged=d.amount!==undefined&&!amountError&&(d.amount.trim()?amountValue:null)!==canonicalAmount(stored.amount);
  const noteChanged=d.note!==undefined&&(d.note.trim()||null)!==(stored.note||null);
  return {amountText,noteText,amountError,amountChanged,noteChanged,amount:amountChanged?(d.amount!.trim()?d.amount!:null):undefined,note:noteChanged?(d.note!.trim()||null):undefined};
}
