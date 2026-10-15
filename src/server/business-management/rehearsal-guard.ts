export function assertCashRehearsalTarget(targetUrl:string,protectedUrls:(string|undefined)[]){
 const target=new URL(targetUrl),database=decodeURIComponent(target.pathname.slice(1));
 if(!['postgresql:','postgres:'].includes(target.protocol)||!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||!target.port||target.search||target.hash||!/^proxy_cash_(verify|restore)_[a-z0-9_]+$/.test(database))throw new Error('Unsafe rehearsal target');
 const local=(host:string)=>['localhost','127.0.0.1','[::1]'].includes(host)?'loopback':host;
 for(const url of protectedUrls.filter(Boolean)){const other=new URL(url!);if(local(other.hostname)===local(target.hostname)&&other.port===target.port&&decodeURIComponent(other.pathname.slice(1))===database)throw new Error('Protected database');}
 return {host:target.hostname,port:target.port,database};
}
