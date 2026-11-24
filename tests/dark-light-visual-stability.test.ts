import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {unitPresentationId} from '../src/presentation/assets/unitPresentation';
import {formUnitVisualId,formVisual} from '../src/presentation/qa/shapeshifter/visuals';
import {MISSING_UNIT_ART} from '../src/presentation/assets/missingUnitArt';
import {FeatureCard} from '../src/presentation/react/components/BattleCardFeature';
import {DARK_LIGHT_CARDS} from '../src/game/data/dark-light';
import {makeEngine,mutable,setHand} from './helpers';
import {createProfile,GameEngine} from '../src/game';
import {visualFixture,activation} from '../qa/dark-light-visual-20261123/fixtures';
import {createDuel,validateLoadout,applyDuel,duelView} from '../src/game/pvp/duel';
import {PVP_CONTENT} from '../server/src/pvp';
it('actual transform, serialized restore and reversion retain distinct visual identities without changing stats',()=>{
 const e=makeEngine({hero:{heroId:'shapeshifter',pos:{x:2,y:2}}},PVP_CONTENT);mutable(e).player.energy=20;
 const hp=e.state.units.find(u=>u.id===e.heroId)!.hp;const [uid]=setHand(e,['dark_abyssal_minotaur']);
 expect(e.dispatch({type:'PLAY_CARD',cardUid:uid!,target:null}).ok).toBe(true);
 const unit=e.state.units.find(u=>u.id===e.heroId)!;
 expect(unit.activeForm).toBe('dark_abyssal_minotaur');expect(unit.hp).toBe(hp);
 for(const copy of [unit,JSON.parse(JSON.stringify(unit))])for(const flag of [true,false])expect(unitPresentationId(copy,flag)).toBe('dark_abyssal_minotaur');
 expect(unitPresentationId({...unit,activeForm:undefined},true)).toBe('qa_form_humanoid');
 expect(unitPresentationId({...unit,activeForm:'minotaur'},true)).toBe('qa_form_minotaur');
 expect(unitPresentationId({...unit,activeForm:'bear'},true)).toBe('qa_form_bear');
 expect(formUnitVisualId('dark_abyssal_minotaur')).not.toBe(formUnitVisualId('minotaur'));
 const move=e.getLegalMoves()[0];expect(move).toBeDefined();expect(e.dispatch({type:'MOVE_UNIT',unitId:e.heroId,to:move!.pos}).ok).toBe(true);
 mutable(e).player.hand.push({uid:'return',cardId:'wild_burst'});expect(e.dispatch({type:'PLAY_CARD',cardUid:'return',target:null}).ok).toBe(true);expect(unitPresentationId(e.state.units.find(u=>u.id===e.heroId)!,true)).toBe('qa_form_humanoid');
});
it('new authored Abisal keeps a distinct resource and explicit load-failure diagnostics',()=>{
 expect(formVisual('dark_abyssal_minotaur')).toMatchObject({assetStatus:'AVAILABLE',visualId:'dark_abyssal_minotaur',icon:'/art/dark-light/units/v7/dark_abyssal_minotaur.png',locomotion:{atlas:'/art/dark-light/units/v7/dark_abyssal_minotaur-atlas.png',walkFrames:6,runFrames:6}});
 expect(Object.keys(MISSING_UNIT_ART).sort()).toEqual(['dark_abyssal_minotaur','dark_scorpion_king','dark_serpent_king','light_pact_fairy']);
 expect(MISSING_UNIT_ART.dark_the_reaper).toBeUndefined();
});
it.each(DARK_LIGHT_CARDS)('full %s rules remain intact and keyboard-scrollable; miniature stays inert',card=>{
 const full=renderToStaticMarkup(createElement(FeatureCard,{def:card,className:'',extras:{playable:true}}));
 expect(full).toContain('data-card-rules-scroll="true"');expect(full).toContain('tabindex="0"');expect(full).toContain('Efecto completo de');
 const mini=renderToStaticMarkup(createElement(FeatureCard,{def:card,className:'',extras:{playable:true},ariaHidden:true}));
 expect(mini).not.toContain('data-card-rules-scroll="true"');expect(mini).not.toContain('tabindex="0"');
});

it('both private PvP seats restore the same Abisal identity after confirmed response resolution',()=>{
 const p=createProfile(PVP_CONTENT),load=validateLoadout(p,'shapeshifter',PVP_CONTENT);let s=createDuel([load,load],47,'DUEL','classic',PVP_CONTENT);s.player.energy=20;s.player.hand=[{uid:'form',cardId:'dark_abyssal_minotaur'}];
 s=applyDuel(s,{type:'PLAY_CARD',cardUid:'form',target:null},PVP_CONTENT).state;expect(s.pendingCast).toBeDefined();s=applyDuel(s,{type:'SILENCE_RESPONSE',windowId:s.pendingCast!.id,pass:true},PVP_CONTENT).state;
 const caster=s.units.find(u=>u.activeForm==='dark_abyssal_minotaur')!;expect(caster).toBeDefined();
 for(const seat of [0,1] as const){const view=JSON.parse(JSON.stringify(duelView(s,seat,PVP_CONTENT)));expect(view.duel).toBeUndefined();expect(unitPresentationId(view.units.find((u:{id:string})=>u.id===caster.id)!,true)).toBe('dark_abyssal_minotaur');}
});

it.each(['dark_the_reaper','dark_serpent_king','dark_scorpion_king','dark_abyssal_minotaur','light_pact_fairy'])('snapshot after real %s activation preserves the selected unit resource without duplication',id=>{
 const {engine:e,scenario}=visualFixture(id);expect(e.dispatch(activation(e)).ok).toBe(true);if(e.state.player.pendingCardChoice)expect(e.dispatch({type:'RESOLVE_CARD_CHOICE',choiceUid:e.state.player.pendingCardChoice.options[0]!.uid}).ok).toBe(true);
 const target=e.state.units.find(u=>id==='dark_abyssal_minotaur'?u.activeForm===id:u.defId===id)!;expect(target).toBeDefined();
 const restored=GameEngine.fromSnapshot(JSON.parse(JSON.stringify(e.state)),PVP_CONTENT,scenario);const after=restored.state.units.find(u=>u.id===target.id)!;expect(after.hp).toBe(target.hp);expect(after.pos).toEqual(target.pos);expect(unitPresentationId(after,true)).toBe(id);expect(restored.state.units.filter(u=>u.id===target.id)).toHaveLength(1);
});
