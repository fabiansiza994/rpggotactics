import type { GameEvent, GameState } from '../../game';
import type { PresentationBatch } from '../events/presentationBus';
import type { AudioCue } from './catalog';
export const BATTLE_TRACKS = ['ancient_battlefield','echoes_of_the_arcane','the_silent_war'] as const;
export type BattleTrack = typeof BATTLE_TRACKS[number];
interface Entry { track:BattleTrack; seen:string[]; finished:boolean }
interface History { last?:BattleTrack; entries:Record<string,Entry> }
const KEY='rpggo:battle-audio:v1';
/** Presentation-only choices. Never reads the combat RNG or writes game snapshots. */
export class BattleAudioSession {
 private history:History={entries:{}}; private current:string|null=null; private latestTurn='';
 private ending:ReturnType<typeof setTimeout>|undefined;
 constructor(private audio:{startBattleMusic(owner:string,file:string):Promise<void>;stopBattleMusic(fade?:number,release?:boolean):void;prepare(cues:readonly AudioCue[]):Promise<void>;playPrepared(cue:AudioCue,stillValid?:()=>boolean):Promise<boolean>},private storage?:Pick<Storage,'getItem'|'setItem'>,private random:()=>number=Math.random){
  try{const data=JSON.parse(storage?.getItem(KEY)??'null');if(data&&typeof data==='object'&&data.entries&&typeof data.entries==='object'){
   if(BATTLE_TRACKS.includes(data.last))this.history.last=data.last;
   for(const [id,e]of Object.entries(data.entries).slice(-24)){const entry=e as Entry;if(entry&&BATTLE_TRACKS.includes(entry.track)&&Array.isArray(entry.seen))this.history.entries[id]={track:entry.track,finished:entry.finished===true,seen:entry.seen.filter(s=>typeof s==='string').slice(-256)};}
  }}catch{/* Optional tab-local history; never needed for battle correctness. */}
 }
 private save(){try{this.storage?.setItem(KEY,JSON.stringify(this.history));}catch{/* blocked storage */}}
 attach(id:string,state:Readonly<GameState>){
  this.latestTurn=`${state.round}:${state.activeFaction}`;
  if(this.current!==id){if(this.ending)clearTimeout(this.ending);this.current=id;}
  let entry=this.history.entries[id];
  if(!entry){const alternatives=BATTLE_TRACKS.filter(t=>t!==this.history.last);const track=alternatives[Math.min(alternatives.length-1,Math.max(0,Math.floor(this.random()*alternatives.length)))]!;entry={track,seen:[],finished:false};this.history.entries[id]=entry;this.history.last=track;const keys=Object.keys(this.history.entries);if(keys.length>24)delete this.history.entries[keys[0]!];this.save();}
  if(state.outcome){this.audio.stopBattleMusic(.4,true);return;}
  if(!entry.finished){void this.audio.startBattleMusic(id,`/audio/arcane-battle/v1/battle_music_${entry.track}.m4a`);void this.audio.prepare(['battle_victory','battle_defeat','battle_turn_start','battle_enemy_turn']);}
 }
 opening(id:string,state:Readonly<GameState>){
  this.attach(id,state);const entry=this.history.entries[id];if(!entry||entry.finished||entry.seen.includes('opening'))return;
  entry.seen.push('opening');this.save();const turn=this.latestTurn;void this.audio.playPrepared(state.activeFaction==='PLAYER'?'battle_turn_start':'battle_enemy_turn',()=>this.current===id&&this.latestTurn===turn);
 }
 observe(events:readonly GameEvent[],state:Readonly<GameState>,batch?:PresentationBatch){
  if(!this.current)return;this.latestTurn=`${state.round}:${state.activeFaction}`;
  if(!batch?.live||!batch.before)return;
  const entry=this.history.entries[this.current];if(!entry||entry.finished)return;
  if(state.outcome){
   entry.finished=true;this.save();this.audio.stopBattleMusic(.4,true);
   const cue=state.outcome.result==='WON'?'battle_victory':state.outcome.result==='LOST'?'battle_defeat':null;
   if(cue){const owner=this.current;this.ending=setTimeout(()=>{this.ending=undefined;if(this.current===owner)void this.audio.playPrepared(cue,()=>this.current===owner);},420);}
   return;
  }
  for(const e of events){if(e.type!=='TURN_STARTED')continue;
   // Response windows, repeated snapshots and replay on reconnect are not new turns.
   if(batch.before.round===state.round&&batch.before.activeFaction===state.activeFaction)continue;
   const key=`turn:${e.round}:${e.faction}`;if(entry.seen.includes(key))continue;
   entry.seen.push(key);entry.seen=entry.seen.slice(-256);this.save();
   const owner=this.current,turn=this.latestTurn;void this.audio.playPrepared(state.activeFaction==='PLAYER'?'battle_turn_start':'battle_enemy_turn',()=>this.current===owner&&this.latestTurn===turn);
  }
 }
 detach(id:string){if(this.current!==id)return;this.current=null;if(this.ending)clearTimeout(this.ending);this.ending=undefined;this.audio.stopBattleMusic(.35,true);}
 get diagnostics(){return{current:this.current,track:this.current?this.history.entries[this.current]?.track:null};}
}
