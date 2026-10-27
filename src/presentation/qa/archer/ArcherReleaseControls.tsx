import { useBattleStore } from '../../store/battleStore';
import { archerGameplayQaEnabled } from './battlePreview';

/** Explicit local-only arrangements for short manual checks, never authoritative game rules. */
export function ArcherReleaseControls() {
  const busy = useBattleStore(s => s.playbackBusy || s.introLocked);
  if (!archerGameplayQaEnabled) return null;
  async function prepare(kind: 'hunt' | 'heart' | 'heart-blocked' | 'pierce' | 'trap') {
    const store = useBattleStore.getState();
    if (!await store.startScenario('first_blood', 101, 'archer')) return;
    const current = useBattleStore.getState(), engine = current.engine!;
    const state = structuredClone(engine.state);
    const hero = state.units.find(u=>u.id===state.player.heroId)!;
    hero.pos = {x:1,y:2};
    const foes = state.units.filter(u=>u.kind==='ENEMY');
    foes[0]!.pos = {x:4,y:2}; foes[1]!.pos = {x:5,y:2};
    const ids = kind==='hunt' ? ['hunters_eye','true_shot','stalker_step','tactical_retreat','archer_shot']
      : kind==='heart' || kind==='heart-blocked' ? ['hunters_eye','heart_shot','first_aid','archer_shot','true_shot']
      : kind==='pierce' ? ['piercing_arrow','hunters_eye','archer_shot','stalker_step','tactical_retreat']
      : ['bramble_trap','hunters_eye','archer_shot','stalker_step','tactical_retreat'];
    // Move actual starter copies out of their piles; preserve ownership and total card count.
    const pool = [...state.player.hand,...state.player.deck,...state.player.discard];
    if (ids.some(id=>!pool.some(c=>c.cardId===id))) {
      useBattleStore.setState({notice:'Este escenario requiere el mazo inicial del Arquero. Restáuralo desde el editor.'});
      return;
    }
    state.player.hand = ids.map(id=>pool.splice(pool.findIndex(c=>c.cardId===id),1)[0]!);
    state.player.deck = pool; state.player.discard = [];
    hero.focus!.value = kind==='heart' ? 3 : kind==='pierce' ? 2 : 0;
    // Keep the existing engine subscription: only the local QA fixture changes.
    Object.assign(engine.state, state);
    useBattleStore.setState({ state:{...engine.state}, selectedCardUid:null, aim:null,
      notice:`Escenario QA preparado: ${kind}. Concentración inicial ${hero.focus!.value}/3. Sin recompensas.` });
  }
  return <details style={{position:'fixed',left:12,top:164,zIndex:10001,maxWidth:280,background:'#111c29',color:'#ead9ae',padding:6}}>
    <summary>Playtest Arquero · escenarios QA</summary>
    <p>Posiciones y mano preparadas; comandos reales, sin cambios de balance.</p>
    <button disabled={busy} onClick={()=>void prepare('hunt')}>Presa y Concentración · 0/3</button>
    <button disabled={busy} onClick={()=>void prepare('heart')}>Tiro al Corazón · 3/3</button>
    <button disabled={busy} onClick={()=>void prepare('heart-blocked')}>Tiro al Corazón · 0/3</button>
    <button disabled={busy} onClick={()=>void prepare('pierce')}>Perforante · 2/3</button>
    <button disabled={busy} onClick={()=>void prepare('trap')}>Trampa · 0/3</button>
  </details>;
}
