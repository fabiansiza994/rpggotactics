import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {SilenceResponseDialog} from '../src/presentation/react/components/SilenceResponseDialog';
import {GameEngine,createProfile} from '../src/game';
import {createDuel,duelView,validateLoadout,DUEL_SCENARIO} from '../src/game/pvp/duel';
import {PVP_CONTENT} from '../server/src/pvp';
it('renders an optional nonmodal response panel with no backdrop, real choices and expired-state controls',()=>{
 const p=createProfile(PVP_CONTENT),load=validateLoadout(p,'mage',PVP_CONTENT),s=createDuel([load,load],47,'DUEL','classic',PVP_CONTENT);
 s.player.hand=[{uid:'seal',cardId:'dark_silence_seal'},{uid:'cost',cardId:'fireball'}];s.player.energy=4;
 const view=duelView(s,s.duel!.active,PVP_CONTENT);view.responseWindow={id:'window',cardId:'barrier',casterId:s.duel!.other.heroId,respondingHeroId:view.player.heroId,deadline:Date.now()+5000};
 const engine=GameEngine.fromSnapshot(view,PVP_CONTENT,DUEL_SCENARIO);
 const render=()=>renderToStaticMarkup(createElement(SilenceResponseDialog,{state:view,engine}));
 const html=render();expect(html).toContain('aria-modal="false"');expect(html).toContain('Pasar');expect(html).toContain('Fireball');expect(html).not.toContain('<dialog');expect(html).not.toContain('disabled=""');
 view.responseWindow.deadline=0;const expired=render();expect(expired).toContain('Esperando resolución del servidor');expect(expired.match(/disabled=""/g)).toHaveLength(2);
});
