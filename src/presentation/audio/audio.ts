import { runtimeAudioFiles, gatheringLoop } from './runtimeCatalog';
import type{GameEvent}from'../../game';import type{PresentationBatch}from'../events/presentationBus';import{AudioManager}from'./AudioManager';import type{AudioCue}from'./catalog';
export const audioExperimentEnabled=import.meta.env.VITE_ARCANE_AUDIO_ENABLED==='1';
export const arcaneAudio=new AudioManager({files:runtimeAudioFiles,categories:{ranked_search_loop:'music'},gains:{card_hover:.12,ui_cancel:.45,card_activate:.6},loopBounds:gatheringLoop});
export function audioCue(cue:AudioCue){if(audioExperimentEnabled)arcaneAudio.play(cue);}
export function audioHover(epoch:unknown,uid:string){if(audioExperimentEnabled)arcaneAudio.hover(epoch,uid);}
/** Shares the existing VFX queue's confirmed batch and cast beat, never predicts outcomes. */
export class ConfirmedAudioPolicy{
 private batches=new Set<string>();private events=new WeakMap<GameEvent,string>();private consumed=new Set<string>();
 constructor(private play:()=>void){}
 capture(events:readonly GameEvent[],batch?:PresentationBatch){if(!batch?.key)return;const duplicate=this.batches.has(batch.key);this.batches.add(batch.key);if(this.batches.size>512)this.batches.delete(this.batches.values().next().value!);if(duplicate||!batch.live)return;const blocked=new Set(events.flatMap(e=>e.type==='CARD_NEGATED'||e.type==='CARD_CURSE_TRIGGERED'?[e.cardUid]:[]));events.forEach((e,i)=>{if(e.type==='CARD_PLAYED'&&!blocked.has(e.cardUid)&&!(blocked.size>0&&e.cardId==='dark_silence_seal'))this.events.set(e,`${batch.key}:${i}`);});}
 cast(event:GameEvent){const key=this.events.get(event);if(!key||this.consumed.has(key))return false;this.consumed.add(key);if(this.consumed.size>512)this.consumed.delete(this.consumed.values().next().value!);this.play();return true;}
}
export const confirmedAudio=new ConfirmedAudioPolicy(()=>audioCue('card_activate'));
export class RankedAudioSession{
 private intent=false;private searching:string|null=null;private seen=new Set<string>();private generation=0;
 constructor(private audio:Pick<AudioManager,'startSearch'|'stopSearch'|'play'>=arcaneAudio,private enabled=audioExperimentEnabled){}
 begin(){this.intent=true;this.generation++;}
 update(queue:{state:string;since?:number;code?:string}){if(!this.enabled)return;if(queue.state==='SEARCHING'){this.searching=String(queue.since??this.generation);void this.audio.startSearch(this.searching);return;}this.audio.stopSearch();if(queue.state==='MATCHED'&&(this.intent||this.searching)){const key=queue.code;if(key&&!this.seen.has(key)){this.seen.add(key);if(this.seen.size>128)this.seen.delete(this.seen.values().next().value!);this.audio.play('ranked_match_found');}}this.searching=null;this.intent=false;}
 rejected(status:number){if([401,403,404,410,426,503].includes(status))this.terminal();}
 terminal(){this.searching=null;this.intent=false;if(this.enabled)this.audio.stopSearch();}
 dispose(){this.terminal();}
}
