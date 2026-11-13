import {cp,readdir,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {cacheHeaders,spaRedirects,notFoundHtml,isVersionedAsset} from './pagesPolicy.ts';
const hash=(body:Uint8Array)=>createHash('sha256').update(body).digest('hex');
const inside=(parent:string,child:string)=>{const rel=relative(parent,child);return rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel));};

/** Package an approved dist plus explicit archived dists. Never copies a previous index or config. */
export async function preparePagesArtifact(currentDir:string,previousDirs:readonly string[],outputDir:string) {
  const current=resolve(currentDir),previous=previousDirs.map(p=>resolve(p)),output=resolve(outputDir);
  if([current,...previous].some(p=>inside(p,output)||inside(output,p))) throw new Error('Output must be separate from source artifacts.');
  try {await stat(output);throw new Error('Output already exists; use a fresh directory.');} catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const known=(await readdir(join(current,'assets'))).map(f=>'assets/'+f).filter(isVersionedAsset);
  const headers=cacheHeaders(known); // Fail before copying if the platform rule budget is exceeded.
  await readFile(join(current,'index.html'));
  const retained:string[]=[];
  try {
    await cp(current,output,{recursive:true});
    for(const archive of previous) {
      for(const entry of await readdir(join(archive,'assets'),{withFileTypes:true})) {
        const name='assets/'+entry.name;
        if(!entry.isFile()||!isVersionedAsset(name)) continue;
        const bytes=await readFile(join(archive,name)),target=join(output,name);
        let existing:Buffer|undefined;
        try {existing=await readFile(target);} catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
        if(existing&&!bytes.equals(existing)) throw new Error('Hash-path collision with different bytes: '+name);
        if(!existing){await writeFile(target,bytes);retained.push(name);}
      }
    }
    const all=(await readdir(join(output,'assets'))).map(f=>'assets/'+f).filter(isVersionedAsset).sort();
    // Also checks historical entry chunks and their lazy-import/preload references.
    for(const file of ['index.html',...all.filter(f=>/\.(js|css)$/.test(f))]) {
      const body=await readFile(join(output,file),'utf8');
      for(const match of body.matchAll(/["'](?:\.\/|\/?assets\/)([^"'/?#]+-[\w-]{8}\.(?:js|css|woff2?|png|webp|svg|jpg))["']/g)) {
        const dependency=join(output,'assets',match[1]!);
        try {await stat(dependency);} catch {throw new Error('Missing compiled dependency in '+file+': '+match[1]);}
      }
    }
    await writeFile(join(output,'_headers'),headers); // Only CURRENT known assets receive immutable; retained assets remain no-store.
    await writeFile(join(output,'_redirects'),spaRedirects());
    await writeFile(join(output,'404.html'),notFoundHtml);
    const manifest={indexSha256:hash(await readFile(join(output,'index.html'))),archiveCount:previous.length,retained:retained.sort(),assets:await Promise.all(all.map(async file=>({file,sha256:hash(await readFile(join(output,file)))})))};
    await writeFile(join(output,'release-assets.json'),JSON.stringify(manifest,null,2)+'\n');
    return manifest;
  }catch(error){await rm(output,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [current,output,...archives]=process.argv.slice(2);
  if(!current||!output)throw new Error('Usage: node --experimental-strip-types build/preparePagesArtifact.ts CURRENT_DIST NEW_OUTPUT [ARCHIVED_DIST ...]');
  const manifest=await preparePagesArtifact(current,archives,output);
  console.log(JSON.stringify({assets:manifest.assets.length,retained:manifest.retained.length,indexSha256:manifest.indexSha256}));
}
