/**
 * HTML-in-Canvas (HIC) Application Controller for Pageflip.
 * Manages UI controls, theme selector, URL parameters, keyboard shortcuts,
 * and delegates all pageflip lifecycle & rendering interactions exclusively to Pageflip.
 */

import { Pageflip } from './pageflip.js';

export class HICApp {
  constructor() {
    this.canvas = document.getElementById('book-canvas');
    this.container = document.getElementById('book-container');
    this.prevBtn = document.getElementById('prev-btn');
    this.nextBtn = document.getElementById('next-btn');
    this.pageInput = document.getElementById('page-input');
    this.totalPagesSpan = document.getElementById('total-pages');
    this.timelineSlider = document.getElementById('timeline-slider');
    this.timelineFill = document.getElementById('timeline-fill');
    this.spreadIndicator = document.getElementById('spread-indicator');
    this.themeSelect = document.getElementById('theme-select');

    this.engineMode = '2d'; // '2d' or '3d'
    this.slides = [];
    this.pageflip = null;

    this.init();
  }

  applyDimensions() {
    const pw = parseInt(this.canvas.getAttribute('data-pageflip-width') || this.canvas.dataset?.pageflipWidth, 10) || 1024;
    const ph = parseInt(this.canvas.getAttribute('data-pageflip-height') || this.canvas.dataset?.pageflipHeight, 10) || 768;
    const bg = this.canvas.getAttribute('data-pageflip-background') || this.canvas.dataset?.pageflipBackground || 'white';

    this.canvas.style.setProperty('--pageflip-width', `${pw}px`);
    this.canvas.style.setProperty('--pageflip-height', `${ph}px`);
    this.canvas.style.setProperty('--pageflip-background', bg);

    if (this.pageflip) {
      this.pageflip.setDimensions(pw, ph);
      this.pageflip.resize();
    }
  }

  switchEngine(engineMode) {
    if (this.engineMode === engineMode) return;
    this.engineMode = engineMode;

    if (this.pageflip) {
      this.pageflip.switchEngine(engineMode);
      this.canvas = this.pageflip.canvas;
      this.applyDimensions();
    }
  }

  checkHICSupport() {
    const canvasProto = HTMLCanvasElement.prototype;
    const ctxProto = CanvasRenderingContext2D.prototype;
    const hasLayoutSubtree = 'layoutSubtree' in canvasProto || 'layoutsubtree' in canvasProto;
    const hasDrawElementImage = 'drawElementImage' in ctxProto;
    return hasLayoutSubtree && hasDrawElementImage;
  }

  init() {
    const warningBanner = document.getElementById('hic-warning-banner');
    if (!this.checkHICSupport()) {
      if (warningBanner) warningBanner.hidden = false;
      console.warn('HTML-in-Canvas (HiC) is not supported in this browser. layoutSubtree and/or drawElementImage not found in prototypes.');
    } else {
      if (warningBanner) warningBanner.hidden = true;
    }

    if (!this.canvas.hasAttribute('layoutsubtree')) {
      this.canvas.setAttribute('layoutsubtree', '');
    }

    // 1. Extract slides from canvas child elements
    const pw = parseInt(this.canvas.getAttribute('data-pageflip-width') || this.canvas.dataset?.pageflipWidth, 10) || 1024;
    const ph = parseInt(this.canvas.getAttribute('data-pageflip-height') || this.canvas.dataset?.pageflipHeight, 10) || 768;

    const slideElements = Array.from(this.canvas.querySelectorAll('.slide'));
    this.slides = slideElements.map((el, index) => ({
      pageNum: index + 1,
      element: el,
      pw: pw,
      ph: ph
    }));

    // 2. Determine engine mode from URL param ?engine=2d or ?engine=3d
    const urlParams = new URLSearchParams(window.location.search);
    const engineParam = urlParams.get('engine');
    this.engineMode = engineParam === '3d' ? '3d' : '2d';

    const link2D = document.getElementById('engine-link-2d');
    const link3D = document.getElementById('engine-link-3d');
    if (link2D && link3D) {
      if (this.engineMode === '3d') {
        link3D.classList.add('active');
        link3D.setAttribute('aria-current', 'page');
        link2D.classList.remove('active');
        link2D.removeAttribute('aria-current');
      } else {
        link2D.classList.add('active');
        link2D.setAttribute('aria-current', 'page');
        link3D.classList.remove('active');
        link3D.removeAttribute('aria-current');
      }
    }

    // 3. Apply canvas dimensions and background variables before textures load
    this.applyDimensions();

    const totalPages = this.slides.length || 6;

    // 4. Initialize Pageflip (which creates and manages its engine)
    this.pageflip = new Pageflip(this.canvas, this.slides, {
      engine: this.engineMode,
      totalPages,
      onPageChange: (state) => this.onPageChanged(state)
    });

    this.pageflip.resize();

    // 5. Observe attribute changes for dynamic width/height/background
    const attrObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && (m.attributeName === 'data-pageflip-width' || m.attributeName === 'data-pageflip-height' || m.attributeName === 'data-pageflip-background')) {
          this.applyDimensions();
          this.pageflip.render();
        }
      }
    });
    attrObserver.observe(this.canvas, { attributes: true, attributeFilter: ['data-pageflip-width', 'data-pageflip-height', 'data-pageflip-background'] });

    // 6. Handle container resize with ResizeObserver
    const observer = new ResizeObserver(() => {
      this.pageflip.resize();
      this.pageflip.render();
    });
    observer.observe(this.container || this.canvas);

    // 7. Handle selection and focus updates
    const triggerPaintUpdate = () => {
      this.pageflip.requestRender();
    };
    document.addEventListener('selectionchange', triggerPaintUpdate);
    document.addEventListener('focusin', triggerPaintUpdate);
    document.addEventListener('focusout', triggerPaintUpdate);

    // 8. Setup UI bindings
    this.totalPagesSpan.textContent = totalPages;
    this.pageInput.max = totalPages;
    this.timelineSlider.max = totalPages;

    this.bindEvents();
    this.onPageChanged(this.pageflip.getState());
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      this.pageflip.resize();
      this.pageflip.render();
    });

    this.prevBtn.addEventListener('click', () => this.pageflip.flipBackward());
    this.nextBtn.addEventListener('click', () => this.pageflip.flipForward());

    this.pageInput.addEventListener('change', (e) => {
      const p = parseInt(e.target.value, 10);
      if (!isNaN(p)) this.pageflip.gotoPage(p);
    });

    this.timelineSlider.addEventListener('input', (e) => {
      const p = parseInt(e.target.value, 10);
      this.updateTimelineProgress(p);
    });

    this.timelineSlider.addEventListener('change', (e) => {
      const p = parseInt(e.target.value, 10);
      this.pageflip.gotoPage(p);
    });

    if (this.themeSelect) {
      const savedTheme = localStorage.getItem('pageflip_theme');
      if (savedTheme) {
        document.body.dataset.theme = savedTheme;
        document.documentElement.dataset.theme = savedTheme;
        this.themeSelect.value = savedTheme;
      }

      this.themeSelect.addEventListener('change', (e) => {
        const theme = e.target.value;
        document.body.dataset.theme = theme;
        document.documentElement.dataset.theme = theme;
        try {
          localStorage.setItem('pageflip_theme', theme);
        } catch (err) {}

        this.pageflip.reloadTextures();
      });
    }

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        this.pageflip.flipBackward();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        this.pageflip.flipForward();
      } else if (e.key === 'Home') {
        e.preventDefault();
        this.pageflip.gotoPage(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        this.pageflip.gotoPage(this.pageflip.totalPages);
      }
    });
  }

  onPageChanged(state) {
    const [left, right] = state.currentSpread;
    const total = state.totalPages;

    let label = '';
    let curPageNum = 1;
    if (left === 0) {
      label = `Cover (1 of ${total})`;
      curPageNum = 1;
    } else if (right > total) {
      label = `Page ${left} of ${total}`;
      curPageNum = left;
    } else {
      label = `Pages ${left}–${right} of ${total}`;
      curPageNum = left;
    }

    if (this.spreadIndicator) this.spreadIndicator.textContent = label;
    this.pageInput.value = curPageNum;
    this.timelineSlider.value = curPageNum;
    this.updateTimelineProgress(curPageNum);

    this.prevBtn.disabled = left <= 0;
    this.nextBtn.disabled = right > total;

    this.pageflip.requestRender();
  }

  updateTimelineProgress(pageNum) {
    const total = this.pageflip.totalPages || 1;
    const pct = Math.max(0, Math.min(100, (pageNum / total) * 100));
    if (this.timelineFill) {
      this.timelineFill.style.width = `${pct}%`;
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    window.hicApp = new HICApp();
  });
}
