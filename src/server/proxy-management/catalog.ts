import type {CatalogAccount,ParsedProxy} from './types';
export function matchPackage(proxy:ParsedProxy,catalog:CatalogAccount[]):string|null{
  const codes=new Set(catalog.filter(c=>c.username===proxy.username&&c.password===proxy.password).map(c=>c.code));
  return codes.size===1?Array.from(codes)[0]:null;
}
