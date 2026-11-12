import type { GameContent, GameEvent, GameState } from '../../game';
import { STATUS_LABEL } from '../assets/statusLabels';
export type OpponentNotice = { id: string; text: string; priority: number; expires: number };
export type NoticeLane = { left: number; top: number; width: number; capacity: number };
/** Geometry uses the projected surface, not a fixed screen guess. A row is 28px plus 4px gap. */
export function noticeLane(left: number, surfaceBottom: number, right: number, bottom: number): NoticeLane {
  const top = Math.ceil(surfaceBottom + 10), capacity = Math.min(2, Math.max(0, Math.floor((bottom - top) / 32)));
  return { left: Math.ceil(left + 8), top, width: Math.max(0, Math.floor(right - left - 16)), capacity };
}
type Pending = { id: string; arrived: number; actor: string | null; base: string; damage: number; target: string; hits: Record<string,number>; priority: number; duration: number; tail: string };
const allowed = new Set(['ENEMY_ACTION_STARTED','ENEMY_ACTION_ENDED','CARD_PLAYED','UNIT_MOVED','UNIT_TELEPORTED','ENEMY_ATTACKED','SUMMON_ATTACKED','COUNTER_ATTACK','UNIT_DAMAGED','UNIT_DEFEATED','UNIT_SPAWNED','UNIT_HEALED','SHIELD_GAINED','STATUS_APPLIED','TRAP_PLACED','TRAP_TRIGGERED','RITUAL_ACTIVATED','TURN_STARTED']);
/** Per-canvas, bounded presentation state. Registration never displays anything. */
export class OpponentNotices {
  private pending = new WeakMap<GameEvent, Pending>();
  private batches = new Set<string>();
  private presented = new WeakSet<GameEvent>();
  private rows: OpponentNotice[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private capacity = 2;
  private serial = 0;
  constructor(private changed: (rows: OpponentNotice[]) => void, private now = () => performance.now()) {}
  setCapacity(n: number) { if(n===this.capacity)return; this.capacity = n; this.rows = this.rows.slice(0,n); this.publish(); }
  register(events: readonly GameEvent[], state: Readonly<GameState>, content: GameContent, heroId: string, previous: Readonly<GameState> = state) {
    const unit = (id: string) => state.units.find(u=>u.id===id) ?? previous.units.find(u=>u.id===id);
    const own = unit(heroId)?.faction;
    const rival = (id: string) => { const u=unit(id); return own !== undefined && !!u && u.faction!==own; };
    const name = (id: string) => { const u=unit(id); return u ? content.heroes[u.defId]?.name ?? content.enemies[u.defId]?.name ?? content.summons?.[u.defId]?.name ?? 'Unidad' : 'Rival'; };
    // Only public event kinds and public unit outcome fields. No hand/altar/username access.
    const signature=JSON.stringify([state.scenarioId,state.round,events.filter(e=>allowed.has(e.type)),state.units.map(u=>[u.id,u.hp,u.shield,u.pos])]);
    if(this.batches.has(signature))return;
    this.batches.add(signature); if(this.batches.size>512)this.batches.delete(this.batches.values().next().value!);
    let action: Pending | undefined;
    const damageByTarget = new Map<string, Pending>();
    const fresh=(actor:string|null,base:string,priority=1,duration=2200):Pending=>({id:`n${++this.serial}`,arrived:this.now(),actor,base,damage:0,target:'',hits:{},priority,duration,tail:''});
    for(const e of events){
      if(e.type==='ENEMY_ACTION_STARTED'){action=rival(e.enemyId)?fresh(e.enemyId,''):undefined;continue;}
      if(e.type==='ENEMY_ACTION_ENDED'){action=undefined;continue;}
      if(e.type==='CARD_RESOLVED'||e.type==='RITUAL_RESOLVED'){action=undefined;continue;}
      let p:Pending|undefined;
      switch(e.type){
        case 'CARD_PLAYED': action=rival(e.casterId)?fresh(e.casterId,`${name(e.casterId)} · ${content.cards[e.cardId]?.name ?? 'Carta utilizada'}`,2,2800):undefined;p=action;break;
        case 'RITUAL_ACTIVATED': action=rival(e.casterId)?fresh(e.casterId,`${name(e.casterId)} activa un ritual`,2,2800):undefined;p=action;break;
        case 'ENEMY_ATTACKED': if(rival(e.enemyId)){action=action?.actor===e.enemyId?action:fresh(e.enemyId,'');p=action;}break;
        case 'SUMMON_ATTACKED': case 'COUNTER_ATTACK': if(rival(e.unitId)){action=fresh(e.unitId,`${name(e.unitId)} ataca`);p=action;}break;
        case 'UNIT_MOVED': case 'UNIT_TELEPORTED': if(rival(e.unitId))p=action?.actor===e.unitId?action:fresh(e.unitId,`${name(e.unitId)} ${e.type==='UNIT_MOVED'?'avanza':'se desplaza'}`);break;
        case 'UNIT_DAMAGED': if(rival(e.sourceId)||action ){p=action ?? fresh(rival(e.sourceId)?e.sourceId:null,'');}break;
        case 'UNIT_DEFEATED': if(e.faction===own)p=damageByTarget.get(e.unitId)??action??fresh(null,'');break;
        case 'UNIT_SPAWNED': if(e.faction!==own)p=action??fresh(null,'');break;
        case 'UNIT_HEALED': if(rival(e.unitId)||rival(e.sourceId))p=action??fresh(null,'');break;
        case 'SHIELD_GAINED': if(rival(e.unitId)||rival(e.sourceId))p=action??fresh(null,'');break;
        case 'STATUS_APPLIED': if(rival(e.sourceId)||rival(e.unitId)||action)p=action??fresh(null,'');break;
        case 'TRAP_PLACED': case 'TRAP_TRIGGERED': if(rival(e.ownerId))p=action??fresh(e.ownerId,'');break;
      }
      if(p)this.pending.set(e,p);
      if(p && e.type==='UNIT_DAMAGED')damageByTarget.set(e.unitId,p);
      // Formatting waits for present(), so future damage cannot appear ahead of contact.
      if(p) this.details.set(e,{name,heroId,own});
    }
  }
  private details = new WeakMap<GameEvent,{name:(id:string)=>string;heroId:string;own:unknown}>();
  present(e: GameEvent, state: Readonly<GameState>) {
    if(this.presented.has(e))return;this.presented.add(e);
    if(e.type==='TURN_STARTED'&&e.faction===state.units.find(u=>u.id===state.player.heroId)?.faction){
      const end=this.now()+1200;this.rows=this.rows.map(r=>({...r,expires:Math.min(r.expires,end)}));this.publish();return;
    }
    const p=this.pending.get(e),d=this.details.get(e);if(!p||!d||this.now()-p.arrived>6000)return;
    const name=d.name;
    switch(e.type){
      case 'UNIT_MOVED': case 'UNIT_TELEPORTED': if(!p.base)p.base=`${name(e.unitId)} ${e.type==='UNIT_MOVED'?'avanza':'se desplaza'}`;break;
      case 'ENEMY_ATTACKED': if(!p.base||p.base.endsWith('avanza')||p.base.endsWith('se desplaza'))p.base=`${name(e.enemyId)} ataca`;break;
      case 'UNIT_DAMAGED':
        p.damage+=e.hpLost;p.target=name(e.unitId);if(e.hpLost>0)p.hits[e.unitId]=(p.hits[e.unitId]??0)+e.hpLost;
        if(!p.base)p.base=p.actor?`${name(p.actor)} ataca`:'Daño';
        if(e.hpLost===0)p.tail=e.shieldAbsorbed>0?' · escudo absorbe':' · bloqueado';
        if(e.unitId===d.heroId&&e.hpLost>0){p.priority=3;p.duration=3400;}break;
      case 'UNIT_DEFEATED':p.tail=` · ${name(e.unitId)} cae`;p.priority=3;p.duration=3400;break;
      case 'UNIT_SPAWNED':p.tail=` · invoca ${name(e.unitId)}`;p.priority=Math.max(2,p.priority);p.duration=Math.max(2800,p.duration);break;
      case 'UNIT_HEALED':p.tail=` · ${name(e.unitId)} +${e.amount} PV`;break;
      case 'SHIELD_GAINED':p.tail=` · ${name(e.unitId)} +${e.amount} escudo`;break;
      case 'STATUS_APPLIED':p.tail=` · ${name(e.unitId)}: ${STATUS_LABEL[e.status] ?? 'Estado'}`;p.priority=Math.max(2,p.priority);p.duration=Math.max(2800,p.duration);break;
      case 'TRAP_PLACED':if(!p.base)p.base=name(e.ownerId);p.tail=' · coloca una trampa';p.priority=2;p.duration=2800;break;
      case 'TRAP_TRIGGERED':if(!p.base)p.base=name(e.ownerId);p.tail=` · trampa sobre ${name(e.unitId)}`;p.priority=2;p.duration=2800;break;
    }
    const text=`${p.base}${p.damage>0?(Object.keys(p.hits).length>1?` · ${Object.keys(p.hits).length} objetivos · −${p.damage}`:` a ${p.target} · −${p.damage}`):''}${p.tail}`.trim().replace(/^· /,'');
    if(!text)return;
    const row={id:p.id,text,priority:p.priority,expires:this.now()+p.duration};
    this.rows=this.rows.filter(r=>r.expires>this.now()&&r.id!==p.id);
    this.rows.push(row);this.rows.sort((a,b)=>b.priority-a.priority||b.expires-a.expires);this.rows=this.rows.slice(0,this.capacity);this.publish();
  }
  private publish(){clearTimeout(this.timer);this.changed([...this.rows]);if(this.rows.length)this.timer=setTimeout(()=>{this.rows=this.rows.filter(r=>r.expires>this.now());this.publish();},Math.max(1,Math.min(...this.rows.map(r=>r.expires))-this.now()));}
  clear(){clearTimeout(this.timer);this.rows=[];this.pending=new WeakMap();this.details=new WeakMap();this.changed([]);}
  reset(){this.clear();this.batches.clear();this.presented=new WeakSet();}
  destroy(){this.reset();}
}
