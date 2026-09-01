/**
 * <hic-pageflip> Custom Element Web Component.
 * Uses Shadow DOM with <canvas layoutsubtree><slot></slot></canvas> to project
 * light-DOM slide elements directly into the canvas without manual node manipulation.
 */

import { Pageflip } from '../core/pageflip.js';
import './hic-pageflip-page.js';

const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

const templateHTML = `
  <style>
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    canvas {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: block;
      touch-action: none;
    }
  </style>
  <canvas layoutsubtree>
    <slot></slot>
  </canvas>
`;

export class HICPageflip extends BaseElement {
  static get observedAttributes() {
    return ['engine', 'page-width', 'page-height', 'page-background', 'page'];
  }

  constructor() {
    super();

    if (typeof HTMLElement !== 'undefined' && this.attachShadow) {
      this.attachShadow({ mode: 'open' });
      const template = document.createElement('template');
      template.innerHTML = templateHTML;
      this.shadowRoot.appendChild(template.content.cloneNode(true));
      this.canvas = this.shadowRoot.querySelector('canvas');
      this.slotElement = this.shadowRoot.querySelector('slot');
    }

    this.slides = [];
    this.pageflip = null;
    this._engineMode = '2d';
    this._resizeObserver = null;
  }

  connectedCallback() {
    this.extractSlides();
    this.setupPageflip();

    if (this.slotElement) {
      this._boundSlotChange = () => {
        this.extractSlides();
        if (this.pageflip) {
          this.pageflip.slides = this.slides;
          this.pageflip.totalPages = this.slides.length;
          this.pageflip.reloadTextures();
          this.pageflip.render();
        }
      };
      this.slotElement.addEventListener('slotchange', this._boundSlotChange);
    }

    this._resizeObserver = new ResizeObserver(() => {
      if (this.pageflip) {
        this.pageflip.resize();
        this.pageflip.render();
      }
    });
    this._resizeObserver.observe(this);
  }

  disconnectedCallback() {
    if (this.slotElement && this._boundSlotChange) {
      this.slotElement.removeEventListener('slotchange', this._boundSlotChange);
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this.pageflip) {
      this.pageflip.destroy();
      this.pageflip = null;
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    if (name === 'engine' && newValue) {
      this.switchEngine(newValue);
    } else if (name === 'page-width' || name === 'page-height' || name === 'page-background') {
      this.applyDimensions();
      if (this.pageflip) this.pageflip.render();
    } else if (name === 'page' && newValue !== null) {
      const p = parseInt(newValue, 10);
      if (!isNaN(p) && this.pageflip) this.pageflip.gotoPage(p);
    }
  }

  extractSlides() {
    const pw = this.pageWidth;
    const ph = this.pageHeight;
    const assigned = this.slotElement ? this.slotElement.assignedElements() : [];
    const slideElements = assigned.length > 0
      ? assigned.filter((el) => el.matches('hic-pageflip-page') || el.tagName.toLowerCase() === 'hic-pageflip-page')
      : Array.from(this.querySelectorAll('hic-pageflip-page'));

    this.slides = slideElements.map((el, index) => ({
      pageNum: index + 1,
      element: el,
      pw,
      ph
    }));
  }

  applyDimensions() {
    const pw = this.pageWidth;
    const ph = this.pageHeight;
    const bg = this.pageBackground;

    this.style.setProperty('--pageflip-width', `${pw}px`);
    this.style.setProperty('--pageflip-height', `${ph}px`);
    this.style.setProperty('--pageflip-background', bg);

    if (this.pageflip) {
      this.pageflip.setDimensions(pw, ph);
      this.pageflip.resize();
    }
  }

  setupPageflip() {
    if (!this.canvas) return;

    const mode = this.getAttribute('engine') || this._engineMode || '2d';
    this._engineMode = mode;

    this.pageflip = new Pageflip(this.canvas, this.slides, {
      engine: mode,
      totalPages: this.slides.length || 6,
      onPageChange: (state) => {
        this.dispatchEvent(new CustomEvent('pagechange', {
          bubbles: true,
          composed: true,
          detail: state
        }));
      },
      onFlipProgress: (state) => {
        this.dispatchEvent(new CustomEvent('flipprogress', {
          bubbles: true,
          composed: true,
          detail: state
        }));
      }
    });

    this.applyDimensions();
    this.pageflip.resize();
    this.pageflip.render();
  }

  switchEngine(engineMode) {
    if (this._engineMode === engineMode && this.pageflip) return;
    this._engineMode = engineMode;
    if (this.getAttribute('engine') !== engineMode) {
      this.setAttribute('engine', engineMode);
    }

    if (this.pageflip) {
      this.pageflip.destroy();
      this.pageflip = null;
    }

    // Recreate fresh canvas inside Shadow Root to allow switching between 2D and WebGL contexts
    if (this.shadowRoot) {
      const oldCanvas = this.canvas;
      const newCanvas = document.createElement('canvas');
      newCanvas.setAttribute('layoutsubtree', '');
      const slot = document.createElement('slot');
      newCanvas.appendChild(slot);

      if (oldCanvas && oldCanvas.parentNode) {
        oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);
      } else {
        this.shadowRoot.appendChild(newCanvas);
      }
      this.canvas = newCanvas;
      this.slotElement = slot;
    }

    this.extractSlides();
    this.setupPageflip();
  }

  // Public Methods
  flipForward() {
    if (this.pageflip) this.pageflip.flipForward();
  }

  flipBackward() {
    if (this.pageflip) this.pageflip.flipBackward();
  }

  gotoPage(pageNum) {
    if (this.pageflip) this.pageflip.gotoPage(pageNum);
  }

  reloadTextures() {
    if (this.pageflip) this.pageflip.reloadTextures();
  }

  resize() {
    if (this.pageflip) this.pageflip.resize();
  }

  render() {
    if (this.pageflip) this.pageflip.render();
  }

  requestRender() {
    if (this.pageflip) this.pageflip.requestRender();
  }

  getState() {
    return this.pageflip ? this.pageflip.getState() : {
      currentPage: 0,
      totalPages: this.slides.length,
      currentSpread: [0, 1]
    };
  }

  // Public Properties
  get engine() {
    return this._engineMode;
  }

  set engine(val) {
    this.switchEngine(val);
  }

  get engineMode() {
    return this._engineMode;
  }

  set engineMode(val) {
    this.switchEngine(val);
  }

  get currentPage() {
    return this.pageflip ? this.pageflip.currentPage : 0;
  }

  get totalPages() {
    return this.pageflip ? this.pageflip.totalPages : this.slides.length;
  }

  get currentSpread() {
    return this.pageflip ? this.pageflip.currentSpread : [0, 1];
  }

  get pageWidth() {
    return parseInt(this.getAttribute('page-width') || this.dataset?.pageWidth || this.canvas?.getAttribute('data-pageflip-width'), 10) || 1024;
  }

  set pageWidth(val) {
    this.setAttribute('page-width', val);
  }

  get pageHeight() {
    return parseInt(this.getAttribute('page-height') || this.dataset?.pageHeight || this.canvas?.getAttribute('data-pageflip-height'), 10) || 768;
  }

  set pageHeight(val) {
    this.setAttribute('page-height', val);
  }

  get pageBackground() {
    return this.getAttribute('page-background') || this.dataset?.pageBackground || this.canvas?.getAttribute('data-pageflip-background') || 'white';
  }

  set pageBackground(val) {
    this.setAttribute('page-background', val);
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('hic-pageflip')) {
  customElements.define('hic-pageflip', HICPageflip);
}
