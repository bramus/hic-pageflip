/**
 * Pageflip entry point.
 * Exports custom elements (<hic-pageflip>, <hic-pageflip-page>) and core Pageflip engine.
 */

import { HICPageflip } from './components/hic-pageflip.js';
import { HICPageflipPage } from './components/hic-pageflip-page.js';
import { Pageflip } from './core/pageflip.js';

if (typeof customElements !== 'undefined' && !customElements.get('hic-pageflip-page')) {
  customElements.define('hic-pageflip-page', HICPageflipPage);
}
if (typeof customElements !== 'undefined' && !customElements.get('hic-pageflip')) {
  customElements.define('hic-pageflip', HICPageflip);
}

export { HICPageflip, HICPageflipPage, Pageflip };