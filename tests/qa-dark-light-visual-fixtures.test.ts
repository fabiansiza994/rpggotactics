import {expect,it} from 'vitest';
import {DARK_LIGHT_CARDS} from '../src/game/data/dark-light';
import {visualFixture,activation} from '../qa/dark-light-visual-20261123/fixtures';
it.each(DARK_LIGHT_CARDS.filter(c=>!c.responseOnly))('visual fixture of %s executes real rules without inventing alternatives',c=>{
 const {engine:e}=visualFixture(c.id);const result=e.dispatch(activation(e));expect(result.ok,JSON.stringify(result)).toBe(true);
 if(e.state.pendingCast)expect(e.dispatch({type:'SILENCE_RESPONSE',windowId:e.state.pendingCast.id,pass:true}).ok).toBe(true);
 if(e.state.player.pendingCardChoice){const choice=e.state.player.pendingCardChoice;expect(choice.options.length).toBeGreaterThan(0);expect(e.dispatch({type:'RESOLVE_CARD_CHOICE',choiceUid:choice.options[0]!.uid}).ok).toBe(true);}
});
