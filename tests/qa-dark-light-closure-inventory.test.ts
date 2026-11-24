import {expect,it} from 'vitest';
import {writeFileSync} from 'node:fs';
import {DARK_LIGHT_CARDS} from '../src/game/data/dark-light';
import {DARK_LIGHT_CARD_ART} from '../src/presentation/assets/darkLightArt';
import {requiredRivalZones} from '../src/game/domain/cards/rival-zones';
it('exports the exact current thirty-card metadata for documentary comparison',()=>{
 expect(DARK_LIGHT_CARDS).toHaveLength(30);
 writeFileSync('qa/dark-light-closure-20261123/catalog-current.json',JSON.stringify(DARK_LIGHT_CARDS.map(c=>({...c,art:DARK_LIGHT_CARD_ART[c.id]??null,rivalZones:requiredRivalZones(c)})),null,2));
});
