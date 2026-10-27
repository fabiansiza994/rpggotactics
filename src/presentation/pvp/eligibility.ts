/** Presentation of restrictions already enforced by server/src/pvp.ts; never grants access. */
const existingRestrictions:Readonly<Record<string,string>>={shapeshifter:'PvP pendiente de validación'};
export const pvpChampionRestriction=(id:string)=>existingRestrictions[id];
