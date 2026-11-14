/** Presentation selectors; never change ownership, deck validation or server eligibility. */
export type CollectionScope='owned'|'available';
export const visibleCollectionCopy=(scope:CollectionScope,owned:number,available:number)=>scope==='owned'?owned>0:available>0;
export const rankedAccessRequired=(mobile:boolean,rankedIntent:boolean,inBattle:boolean,status:string)=>mobile&&rankedIntent&&!inBattle&&status!=='READY';
export function storeCategories<T extends {id:string}>(categories:readonly T[],mobile:boolean,selected:string|null):T[]{
 if(!mobile)return categories.filter(c=>c.id!=='FEATURED');
 const active=categories.find(c=>c.id===selected)??categories[0];return active?[active]:[];
}

export const mobileScenarioName=(name:string)=>({ 'First Blood':'Primera sangre','Crystal Guard':'Guardia de cristal','Escape':'La huida' })[name as 'First Blood'|'Crystal Guard'|'Escape']??name;
