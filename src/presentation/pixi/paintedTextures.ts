import { AssetQueue } from '../loading/AssetQueue';
import { loadingMark } from '../performance/marks';
import { VERTICAL_ASSETS } from '../qa/locomotion/directionalProfiles';
import { shapeshifterPresentationEnabled } from '../shapeshifterRelease';
import { Assets, Rectangle, Texture } from 'pixi.js';
import {
  BATTLE_CHARACTER_PAINTINGS,
  CHARACTER_PAINTINGS,
  MATERIAL_PAINTINGS,
} from '../assets/paintedAssets.ts';
import { GUARDIAN_EXPOSED_VISUAL_ID, TEMPLE_GUARDIAN_EXPOSED_ANIMATION, TEMPLE_GUARDIAN_ANIMATION, CHARACTER_ANIMATIONS, animationRegion, type CharacterAnimationLayout } from './characterAnimations.ts';
import type { CharacterMotion } from './CharacterAnimator.ts';

const characters = new Map<string, Texture>();
const animations = new Map<string, Map<string, Map<CharacterMotion, Texture[]>>>();
const verticalFrames = new Map<string, Map<string, Texture[]>>();
const wizardViews = new Map<string, Texture>();
export const wizardTexture = (view: string) => wizardViews.get(view);
const textureQueue = new AssetQueue(3);
const textureJobs = new Map<string, Promise<Texture>>();
const characterJobs = new Map<string, Promise<void>>();

/** Art loading is independent of release/ownership: an authoritative battle may contain
 * Warrior even if the client was built with its selection flag off. UI/server still gate play. */
export function loadSharedTexture(url: string): Promise<Texture> {
  const existing = textureJobs.get(url);
  if (existing) return existing;
  const job = textureQueue.run(async () => {
    for (let attempt=0; ; attempt++) {
      try { loadingMark('texture-request', {url, attempt}); return await Assets.load<Texture>(url); }
      catch (error) { if (attempt >= 1) throw error; }
    }
  });
  textureJobs.set(url, job);
  void job.catch(() => { if (textureJobs.get(url) === job) textureJobs.delete(url); });
  return job;
}
const loadTexture = loadSharedTexture;

async function loadCharacterAnimation(id:string,layout:CharacterAnimationLayout):Promise<void>{
        if (animations.has(id)) return;
        try {
          const views = new Map<string, Map<CharacterMotion, Texture[]>>();
          const urls = layout.directionalUrls ?? { front: layout.url };
          await Promise.all(Object.entries(urls).map(async ([view, url]) => {
            const atlas = await loadTexture(url);
            const clips = new Map<CharacterMotion, Texture[]>();
            for (const [motion, clip] of Object.entries(layout.clips) as [
              CharacterMotion,
              NonNullable<(typeof layout.clips)[CharacterMotion]>,
            ][]) {
              const frames: Texture[] = [];
              for (let frame = 0; frame < clip.count; frame++) {
                const region = animationRegion(layout, motion, frame, view);
                if (!region) continue;
                frames.push(
                  new Texture({
                    source: atlas.source,
                    frame: new Rectangle(region.frame.x, region.frame.y, region.frame.width, region.frame.height),
                    orig: new Rectangle(0,0,region.orig.width,region.orig.height),
                    trim: region.trim ? new Rectangle(region.trim.x,region.trim.y,region.trim.width,region.trim.height) : undefined,
                  }),
                );
              }
              clips.set(motion, frames);
            }
            views.set(view, clips);
          }));
          animations.set(id, views);
        } catch {
          console.warn(`Character animation atlas unavailable: ${id}; using master artwork.`);
        }
}
/** Specialized boss variants remain on demand, with retry on a subsequent mount. */
export async function loadTempleGuardian(): Promise<void> {
  await Promise.all([
    loadCharacterAnimation('temple_guardian', TEMPLE_GUARDIAN_ANIMATION),
    loadCharacterAnimation(GUARDIAN_EXPOSED_VISUAL_ID, TEMPLE_GUARDIAN_EXPOSED_ANIMATION),
    loadTexture('/art/temple/guardian-animations-v2/guardian-idle.webp').then(t=>{characters.set('temple_guardian',t);}).catch(()=>{console.warn('Guardian master unavailable; retaining fallback.');}),
  ]);
}
async function loadCharacter(id: string): Promise<void> {
  if (id === 'temple_guardian') return loadTempleGuardian();
  const registry = {...CHARACTER_PAINTINGS,...BATTLE_CHARACTER_PAINTINGS,...MATERIAL_PAINTINGS};
  const art = Object.entries(registry).filter(([key])=>key===id||key.startsWith(id+':'));
  await Promise.all([
    ...art.map(async ([key,url])=>{
      if (characters.has(key)) return;
      try { characters.set(key,await loadTexture(url)); }
      catch { console.warn(`Character artwork unavailable: ${key}; using vector fallback.`); }
    }),
    ...(CHARACTER_ANIMATIONS[id] ? [loadCharacterAnimation(id,CHARACTER_ANIMATIONS[id]!)] : []),
    ...(shapeshifterPresentationEnabled && VERTICAL_ASSETS[id] && !verticalFrames.has(id) ? [(async()=>{
      const asset=VERTICAL_ASSETS[id]!,views=new Map<string,Texture[]>();
      try {
        await Promise.all((['front','back'] as const).map(async view=>{
          const atlas=await loadTexture(asset[view]);
          views.set(view,Array.from({length:6},(_,i)=>new Texture({source:atlas.source,frame:new Rectangle((i%3)*256,Math.floor(i/3)*256,256,256)})));
        }));
        verticalFrames.set(id,views);
      } catch { console.warn(`Vertical artwork unavailable: ${id}; retaining lateral fallback.`); }
    })()] : []),
    ...(id==='mage' ? ['front3q','side','back3q','back'].map(async view=>{
      if (!wizardViews.has(view)) try {wizardViews.set(view,await loadTexture(`/art/facing/mage-${view}.png`));} catch {console.warn(`Mage facing unavailable: ${view}`);}
    }) : []),
  ]);
}
/** One bounded shared cache, selected by actual scene IDs; no global character sweep. */
export function loadPaintedCharacters(ids: readonly string[] = []): Promise<void> {
  return Promise.all([...new Set(ids)].map(id=>{
    const existing=characterJobs.get(id);
    if(existing)return existing;
    const job=loadCharacter(id);characterJobs.set(id,job);
    void job.finally(()=>{if(characterJobs.get(id)===job)characterJobs.delete(id);});
    return job;
  })).then(()=>{});
}

export const paintedCharacter = (id: string): Texture | undefined => characters.get(id);
export const paintedAnimationFrame = (
  id: string,
  motion: CharacterMotion,
  frame: number,
  view = 'front',
): Texture | undefined => animations.get(id)?.get(view)?.get(motion)?.[frame];
export const paintedAnimationClips = (id: string): Map<CharacterMotion, Texture[]> | undefined =>
  animations.get(id)?.get('front');

export function paintedVerticalFrame(id: string, view: string, motion: CharacterMotion, frame: number): Texture | undefined {
  return verticalFrames.get(id)?.get(view)?.[(motion === 'run' ? 3 : 0) + (motion === 'walk' || motion === 'run' ? frame % 3 : 0)];
}
