import type { Plugin } from 'vite';
import { gzipSync } from 'node:zlib';
import { readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {cacheHeaders,spaRedirects,notFoundHtml} from './pagesPolicy.ts';
export {cacheHeaders} from './pagesPolicy.ts';
export function performanceBudget(): Plugin {
  return {
    name:'rpggo-performance-budget',
    writeBundle(options) {
      const dir=options.dir??'dist',assetsDir=join(dir,'assets');
      const files=existsSync(assetsDir)?readdirSync(assetsDir).filter(f=>statSync(join(assetsDir,f)).isFile()).map(f=>'assets/'+f):[];
      // Rolldown may report optimized-away chunks in generateBundle: only emitted files get immutable.
      writeFileSync(join(dir,'_headers'),cacheHeaders(files));
    },
    generateBundle(_options,bundle) {
      const chunks=Object.values(bundle).filter(b=>b.type==='chunk');
      const roots=chunks.filter(c=>c.isEntry||Object.keys(c.modules).some(id=>id.endsWith('/presentation/react/App.tsx')));
      const seen=new Set<string>();const css=new Set<string>();
      const visit=(file:string)=>{
        if(seen.has(file))return;seen.add(file);const item=bundle[file];if(!item||item.type!=='chunk')return;
        const meta=(item as typeof item & {viteMetadata?:{importedCss:Set<string>}}).viteMetadata;
        for(const f of meta?.importedCss??[])css.add(f);
        for(const f of item.imports)visit(f);
      };
      for(const r of roots)visit(r.fileName);
      const sizes=chunks.map(c=>({file:c.fileName,bytes:Buffer.byteLength(c.code),gzip:gzipSync(c.code).length,critical:seen.has(c.fileName)})).sort((a,b)=>b.bytes-a.bytes);
      const cssSizes=[...css].map(file=>{const item=bundle[file];const data=item?.type==='asset'?item.source:'';return {file,bytes:Buffer.byteLength(data),gzip:gzipSync(data).length};});
      const assets:{file:string;bytes:number}[]=[];
      const walk=(dir:string)=>{if(!existsSync(dir))return;for(const entry of readdirSync(dir)){const f=join(dir,entry),st=statSync(f);if(st.isDirectory())walk(f);else assets.push({file:relative('public',f).replaceAll('\\','/'),bytes:st.size});}};
      walk('public');assets.sort((a,b)=>b.bytes-a.bytes);
      const criticalJsGzip=sizes.filter(c=>c.critical).reduce((sum,c)=>sum+c.gzip,0),criticalCssGzip=cssSizes.reduce((sum,c)=>sum+c.gzip,0);
      const report={criticalJsGzip,criticalCssGzip,largestChunk:sizes[0],chunks:sizes,criticalCss:cssSizes,topAssets:assets.slice(0,30),budgets:{jsGzip:350*1024,cssGzip:50*1024},scope:'Conservative static closure of HTML entry and App shell, excludes dynamic modes. Gzip summed per HTTP file.'};
      this.emitFile({type:'asset',fileName:'performance-budget.json',source:JSON.stringify(report,null,2)});
      this.emitFile({type:'asset',fileName:'_redirects',source:spaRedirects()});
      this.emitFile({type:'asset',fileName:'404.html',source:notFoundHtml});
      console.log(`[performance] critical JS ${(criticalJsGzip/1024).toFixed(1)} KiB gzip; CSS ${(criticalCssGzip/1024).toFixed(1)} KiB; largest ${sizes[0]?.file}`);
      if(criticalJsGzip>350*1024||criticalCssGzip>50*1024)this.warn('Performance budget exceeded (advisory; see performance-budget.json).');
      if(criticalJsGzip>2.5*1024*1024||criticalCssGzip>500*1024)this.error('Extreme critical bundle size regression.');
    },
  };
}
