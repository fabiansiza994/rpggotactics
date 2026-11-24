import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {DEFAULT_CONTENT} from '../src/game';
import {BattlePileBank} from '../src/presentation/battle/BattlePileZones';
import {makeEngine,mutable} from './helpers';
it('only icons and live counts render, retaining accessible zone names and private opponent information',()=>{
 const s=mutable(makeEngine());s.pileCounts={deck:37,discard:2,opponentHand:5,opponentDeck:35,opponentDiscard:3};
 s.player.discard=[{uid:'a',cardId:'fireball'},{uid:'b',cardId:'magic_missile'}];
 for(const opponent of [false,true]){
 const html=renderToStaticMarkup(createElement(BattlePileBank,{state:s,content:DEFAULT_CONTENT,opponent}));
 expect(html).toContain(opponent?'Rival mazo: 35 cartas':'Tu mazo: 37 cartas');
 expect(html).toContain(opponent?'Rival cementerio: 3 cartas':'Tu cementerio: 2 cartas');
 expect(html.replace(/<[^>]*>/g,'')).toBe(opponent?'353':'372');
 expect(html).not.toContain('<dialog');expect(html).not.toContain('fireball');
 }
 const css=readFileSync('src/styles/battle-piles.css','utf8');
 expect(css).toContain('min-height:44px');
 expect(css).toMatch(/\.is-rival \.battle-pile-grave\s*\{[^}]*grid-column:\s*1/);
 expect(css).toMatch(/\.is-rival \.battle-pile-deck\s*\{[^}]*grid-column:\s*2/);
});
