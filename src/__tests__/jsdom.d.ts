// Test-only DOM for component lifecycle tests (stock-detail-state.test.tsx); the package ships no types.
declare module 'jsdom'{export class JSDOM{constructor(html?:string,options?:{url?:string});window:Window&typeof globalThis&{close():void;Event:typeof Event;HTMLInputElement:typeof HTMLInputElement;HTMLTextAreaElement:typeof HTMLTextAreaElement}}}
