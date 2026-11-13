/** Static Pages policy. Never serve the SPA as a successful missing-module response. */
export const SPA_PATHS = ['/', '/play', '/store', '/terms', '/privacy', '/delivery', '/refunds', '/contact'] as const;
export const isVersionedAsset = (file: string) => /^assets\/[^/]+-[\w-]{8}\.(js|css|woff2?|png|webp|svg|jpg)$/.test(file);
export function cacheHeaders(files: readonly string[]): string {
  const html=['/','/index.html','/play','/play/*','/store','/terms','/privacy','/delivery','/refunds','/contact','/404.html'];
  const known=[...new Set(files.filter(isVersionedAsset))].sort();
  if(known.length+html.length+1>100) throw new Error('Pages _headers exceeds 100 rules; stop packaging, do not silently drop rules.');
  return '# Generated for both Cloudflare Pages domains; no environment-specific rule.\n'+
    '/assets/*\n  Cache-Control: no-store\n\n'+
    html.map(path=>`${path}\n  Cache-Control: public, max-age=0, must-revalidate\n`).join('\n')+'\n'+
    known.map(f=>`/${f}\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable\n`).join('\n');
}
export const spaRedirects = () => SPA_PATHS.flatMap(path=>path==='/'?[]:[`${path} / 200`,`${path}/ / 200`]).concat('/play/* / 200').join('\n')+'\n';
/** Top-level 404 disables Pages' implicit SPA fallback, without a Function or Worker. */
export const notFoundHtml = '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recurso no encontrado</title><h1>404 · Recurso no encontrado</h1><p>El recurso solicitado no está disponible.</p><a href="/play">Volver al juego</a></html>\n';
