import {it,expect,afterEach} from 'vitest';
import {useBattleStore} from '../src/presentation/store/battleStore';
import {makeEngine,setHand,p} from './helpers';
const initial=useBattleStore.getState();afterEach(()=>useBattleStore.setState(initial));
function arrange(card='ice_wall') {const engine=makeEngine();const uid=setHand(engine,[card])[0]!;useBattleStore.setState({engine,state:engine.state,selectedCardUid:uid,wallOrientation:'HORIZONTAL',aim:{pos:p(2,2),source:'tap'},introLocked:false,playbackBusy:false,handDiscard:null});return {engine,uid};}
it('rotates without playing, retains armed target, and submits the chosen axis',()=>{const {engine,uid}=arrange();const before=structuredClone(engine.state);useBattleStore.getState().rotateIceWall();expect(engine.state).toEqual(before);expect(useBattleStore.getState().aim?.pos).toEqual(p(2,2));expect(engine.selectionCommand(uid,p(2,2))).toMatchObject({wallOrientation:'VERTICAL'});useBattleStore.getState().setHoverTile(p(1,2));expect(engine.wallOrientation).toBe('VERTICAL');});
it('no control or orientation change for any other card',()=>{const {engine}=arrange('fireball');useBattleStore.getState().rotateIceWall();expect(engine.wallOrientation).toBe('HORIZONTAL');});
it('rejects rotation while presentation input is locked',()=>{const {engine}=arrange();useBattleStore.setState({playbackBusy:true});useBattleStore.getState().rotateIceWall();expect(engine.wallOrientation).toBe('HORIZONTAL');});
