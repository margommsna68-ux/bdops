// A pasted endpoint is searched by IP and port only. Never retain its credentials in URL/query state.
export function normalizeProxySearch(value:string):string {
 const text=value.trim();
 const endpoint=/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})(?::.*)?$/.exec(text);
 return endpoint?`${endpoint[1]}:${endpoint[2]}`:value;
}
export function proxySearchEndpoint(value:string):{ip:string;port:number}|null {
 const m=/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(normalizeProxySearch(value).trim());
 return m?{ip:m[1],port:Number(m[2])}:null;
}
