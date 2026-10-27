import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const fixture=vi.hoisted(()=>({ownedAvatarIds:[] as string[],avatarId:'wizard_blue',saving:false,status:'READY'}));
vi.mock('../src/presentation/profile/avatarStore',()=>({useAvatarStore:()=>fixture}));
import { AvatarPicker } from '../src/presentation/profile/AvatarPicker';
describe('earned Premium avatar picker presentation',()=>{
  it('keeps the five initial avatars and hides unowned Premium assets',()=>{
    fixture.ownedAvatarIds=[];
    const html=renderToStaticMarkup(createElement(AvatarPicker,{onSelect:()=>{}}));
    expect(html).toContain('wizard_blue.jpg');expect(html).not.toContain('premium_celestial_fox.webp');
    expect((html.match(/<button/g)??[]).length).toBe(5);
  });
  it('adds the owned final avatar without granting or exposing the others',()=>{
    fixture.ownedAvatarIds=['premium_celestial_fox'];fixture.avatarId='premium_celestial_fox';
    const html=renderToStaticMarkup(createElement(AvatarPicker,{onSelect:()=>{}}));
    expect(html).toContain('premium_celestial_fox.webp');expect(html).not.toContain('premium_arcane_emblem.webp');
    expect((html.match(/<button/g)??[]).length).toBe(6);expect(html).toContain('aria-pressed="true"');
  });
});
