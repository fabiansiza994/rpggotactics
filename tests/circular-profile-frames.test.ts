import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {PROFILE_FRAME_ART} from '../src/presentation/assets/profileFrames';
import {COSMETICS} from '../src/game';
import {RANKED_COSMETICS} from '../src/game/ranked/rewardTrack';
import {RANKED_PREMIUM_COSMETICS} from '../src/game/ranked/premiumCosmetics';
it('replaces artwork only for existing owned cosmetic IDs, without adding economic products',()=>{
 const existing={...COSMETICS,...RANKED_COSMETICS,...RANKED_PREMIUM_COSMETICS};
 expect(Object.keys(PROFILE_FRAME_ART)).toHaveLength(7);
 for(const id of Object.keys(PROFILE_FRAME_ART))expect(existing[id]?.kind).toBe('PROFILE_FRAME');
 expect(Object.values(PROFILE_FRAME_ART).some(path=>path.endsWith('/ice.png'))).toBe(false);
});
for(const theme of ['fire','ice','thunder','arcane','nature','shadow','gold','diamond'])it(`${theme}: real RGBA art with an empty transparent center`,()=>{
 const png=readFileSync(new URL(`../public/art/profile-frames-v2/${theme}.png`,import.meta.url));
 expect(png.subarray(1,4).toString()).toBe('PNG');
 let width=0,height=0;const chunks:Buffer[]=[];
 for(let offset=8;offset<png.length;){const n=png.readUInt32BE(offset),kind=png.toString('ascii',offset+4,offset+8),data=png.subarray(offset+8,offset+8+n);offset+=n+12;
 if(kind==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);expect(data[8]).toBe(8);expect(data[9]).toBe(6);}
 if(kind==='IDAT')chunks.push(data);
 }
 expect(width).toBeGreaterThanOrEqual(512);expect(height).toBe(width);
 const bytes=inflateSync(Buffer.concat(chunks)),stride=width*4;let prior=new Uint8Array(stride),offset=0;
 for(let y=0;y<=Math.floor(height/2);y++){
 const filter=bytes[offset++]!,row=new Uint8Array(bytes.subarray(offset,offset+stride));offset+=stride;
 for(let x=0;x<stride;x++){const left=x>=4?row[x-4]!:0,up=prior[x]!,corner=x>=4?prior[x-4]!:0;let predictor=0;
 if(filter===1)predictor=left;else if(filter===2)predictor=up;else if(filter===3)predictor=Math.floor((left+up)/2);else if(filter===4){const p=left+up-corner,a=Math.abs(p-left),b=Math.abs(p-up),c=Math.abs(p-corner);predictor=a<=b&&a<=c?left:b<=c?up:corner;}row[x]=(row[x]!+predictor)&255;
 }
 if(y===0)expect(row[3]).toBe(0);
 if(y===Math.floor(height/2))expect(row[Math.floor(width/2)*4+3]).toBe(0);
 prior=row;
 }
});
