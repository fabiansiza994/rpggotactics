import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {existsSync} from 'node:fs';
import {FINAL_CARD_ART} from '../src/presentation/assets/paintedAssets';
import {SpellArt} from '../src/presentation/react/components/SpellArt';
import {MarketCard} from '../src/presentation/shop/MarketCard';
import {resolvePresentationCard} from '../src/presentation/catalog/cardPresentation';

it('the legendary uses its own final painting in both the shared renderer and real market card face',()=>{
 const path='/art/mage-thunder/thunder_incarnation.jpg';
 expect(FINAL_CARD_ART.thunder_incarnation).toBe(path);
 expect(existsSync('public'+path)).toBe(true);
 const art=renderToStaticMarkup(createElement(SpellArt,{cardId:'thunder_incarnation',spell:'storm_avatar'}));
 expect(art).toContain('src="'+path+'"');expect(art).toContain('data-final-art="true"');expect(art).not.toContain('<svg');
 const card=resolvePresentationCard('thunder_incarnation')!;
 const face=renderToStaticMarkup(createElement(MarketCard,{card}));
 expect(face).toContain(path);expect(face).toContain('Encarnación del Dios del Trueno');
});
it('Storm Avatar keeps its original illustration, independent from the new per-card override',()=>{
 const art=renderToStaticMarkup(createElement(SpellArt,{cardId:'storm_avatar',spell:'storm_avatar'}));
 expect(FINAL_CARD_ART.storm_avatar).toBe('/art/mage-thunder/storm_avatar.webp');
 expect(art).toContain('/art/mage-thunder/storm_avatar.webp');expect(art).not.toContain('thunder_incarnation.jpg');
});
