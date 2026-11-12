import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StartupBoundary } from '../src/presentation/startup/StartupBoundary';
it('preserves the existing frontend when loading succeeds',()=>{const boundary=new StartupBoundary({children:createElement('div',null,'Existing frontend')});expect(renderToStaticMarkup(boundary.render())).toBe('<div>Existing frontend</div>');});
it('provides an explicit retry after a lazy import rejects, without changing gameplay',()=>{const boundary=new StartupBoundary({children:null});boundary.state=StartupBoundary.getDerivedStateFromError();const html=renderToStaticMarkup(boundary.render());expect(html).toContain('role="alert"');expect(html).toContain('No se pudo cargar el juego');expect(html).toContain('Reintentar carga');});
