export declare const listSupportSql:()=>string;
export declare const showSupportSql:(reportId:string)=>string;
export declare const noteSupportSql:(input:{reportId:string;actor:string;text:string;now:number;noteId:string;confirmedSent?:boolean})=>string;
export declare const resolveSupportSql:(reportId:string)=>string;
