import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RankedAvatar} from '../src/presentation/profile/RankedAvatar';
import {PROFILE_FRAME_ART} from '../src/presentation/assets/profileFrames';
it('renders exactly one external artwork and the same portrait for every owned cosmetic',()=>{
 const plain=renderToStaticMarkup(createElement(RankedAvatar,{avatarId:'mystic_fox'}));
 const src=plain.match(/src="([^"]+)"/)![1];
 for(const frameId of Object.keys(PROFILE_FRAME_ART)){
  const html=renderToStaticMarkup(createElement(RankedAvatar,{avatarId:'mystic_fox',frameId}));
  expect(html).toContain(src);
  expect((html.match(/class="circular-frame-art"/g)||[])).toHaveLength(1);
  expect((html.match(/alt="Avatar:/g)||[])).toHaveLength(1);
  expect(html).toContain('circular-frame-portrait');
 }
});
it('unknown cosmetic falls back to the original unframed portrait',()=>{
 expect(renderToStaticMarkup(createElement(RankedAvatar,{avatarId:'mystic_fox',frameId:'not-owned-art'}))).not.toContain('circular-frame-art');
});
