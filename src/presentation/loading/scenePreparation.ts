import{create}from'zustand';
export const useScenePreparation=create<{boardReady:boolean;dialogues:number;presentedId:string|null}>(()=>({boardReady:false,dialogues:0,presentedId:null}));
const pending=new Set<symbol>();
export function registerInitialDialogue(token:symbol,open:boolean){if(open)pending.add(token);else pending.delete(token);useScenePreparation.setState({dialogues:pending.size});}
