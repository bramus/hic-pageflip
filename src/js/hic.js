/**
 * HTML-in-Canvas (HIC) Controller for PageFlip.
 * Uses the Chrome HTML-in-Canvas API (drawElementImage & layoutsubtree).
 * See: https://developer.chrome.com/blog/html-in-canvas-origin-trial
 */

import { FlipbookRenderer } from './renderer.js';
import { WebGLFlipbookRenderer } from './renderer3d.js';
import { Flipbook } from './flipbook.js';

/**
 * Custom Renderer extending FlipbookRenderer to use ctx.drawElementImage with full-viewport canvas
 */
class HICFlipbookRenderer extends FlipbookRenderer {
  constructor(canvas, slides) {
    super(canvas);
    this.slides = slides;
    this.devicePixelRatio = 1;
    this.updateDimensionsFromAttributes();
  }

  updateDimensionsFromAttributes() {
    const pw = parseInt(this.canvas.getAttribute('data-pageflip-width') || this.canvas.dataset.pageflipWidth, 10) || 1024;
    const ph = parseInt(this.canvas.getAttribute('data-pageflip-height') || this.canvas.dataset.pageflipHeight, 10) || 768;
    this.setDimensions(pw, ph);
  }

  resize() {
    this.updateDimensionsFromAttributes();

    const rect = this.canvas.getBoundingClientRect();
    this.devicePixelRatio = 1;

    // Use CSS pixel dimensions directly for 1:1 context coordinate mapping
    this.canvas.width = Math.round(rect.width) || 1024;
    this.canvas.height = Math.round(rect.height) || 768;
    this.viewportWidth = this.canvas.width;
    this.viewportHeight = this.canvas.height;
    this.offsetX = this.canvas.width / 2;
    this.offsetY = this.canvas.height / 2;

    const pad = 40;
    const availW = Math.max(100, this.canvas.width - pad);
    const availH = Math.max(100, this.canvas.height - pad);
    const spreadW = this.pw * 2;
    const spreadH = this.ph;

    this.scale = Math.min(availW / spreadW, availH / spreadH, 1);
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
  }

  render(state) {
    const [leftPage, rightPage] = state.currentSpread;
    const totalPages = state.totalPages || this.slides.length;
    const activePages = new Set();

    // Once the pointer goes down (dragging) or during active fold animation, inert ALL pages
    const isInteracting = state.isDragging || (state.activeFlip && !state.activeFlip.isPeek);
    if (!isInteracting) {
      if (leftPage > 0) activePages.add(leftPage);
      if (rightPage <= totalPages) activePages.add(rightPage);
    }

    // Dynamically inert all non-active pages
    this.slides.forEach((s) => {
      if (s.element) {
        s.element.inert = !activePages.has(s.pageNum);
      }
    });

    super.render(state);
  }

  requestRender(callback) {
    if (this.canvas && typeof this.canvas.requestPaint === 'function') {
      this.canvas.requestPaint();
    }
    super.requestRender(callback);
  }

  drawPage(ctx, pageNum, x, y, w, h) {
    const slide = this.slides[pageNum - 1];
    if (!slide || !slide.element) return;

    const el = slide.element;
    if (typeof ctx.drawElementImage === 'function') {
      try {
        ctx.save();
        ctx.translate(x, y);
        const transform = ctx.drawElementImage(el, 0, 0);
        if (transform && el.style) {
          el.style.transform = transform.toString();
        }
        ctx.restore();
      } catch (err) {
        // Ignore if paint record not ready
      }
    }
  }

  drawPageBack(ctx, pageNum, x, y, w, h) {
    const slide = this.slides[pageNum - 1];
    if (!slide || !slide.element) return;

    const el = slide.element;
    if (typeof ctx.drawElementImage === 'function') {
      try {
        ctx.save();
        ctx.translate(x + w, y);
        ctx.scale(-1, 1);
        const transform = ctx.drawElementImage(el, 0, 0);
        if (transform && el.style) {
          el.style.transform = transform.toString();
        }
        ctx.restore();
      } catch (err) {
        // Ignore
      }
    }
  }

  drawPageFrontReflected(ctx, pageNum, x, y, w, h) {
    const slide = this.slides[pageNum - 1];
    if (!slide || !slide.element) return;

    const el = slide.element;
    if (typeof ctx.drawElementImage === 'function') {
      try {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(-1, 1);
        ctx.translate(-w, 0);
        const transform = ctx.drawElementImage(el, 0, 0);
        if (transform && el.style) {
          el.style.transform = transform.toString();
        }
        ctx.restore();
      } catch (err) {
        // Ignore
      }
    }
  }
}

class HICApp {
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
    this.renderer = null;
    this.flipbook = null;

    this.init();
  }

  applyDimensions() {
    const pw = parseInt(this.canvas.getAttribute('data-pageflip-width') || this.canvas.dataset.pageflipWidth, 10) || 1024;
    const ph = parseInt(this.canvas.getAttribute('data-pageflip-height') || this.canvas.dataset.pageflipHeight, 10) || 768;
    const bg = this.canvas.getAttribute('data-pageflip-background') || this.canvas.dataset.pageflipBackground || 'white';

    this.canvas.style.setProperty('--pageflip-width', `${pw}px`);
    this.canvas.style.setProperty('--pageflip-height', `${ph}px`);
    this.canvas.style.setProperty('--pageflip-background', bg);

    this.slides.forEach((s) => {
      s.pw = pw;
      s.ph = ph;
    });

    if (this.renderer) {
      this.renderer.setDimensions(pw, ph);
      this.renderer.resize();
    }
  }

  switchEngine(engineMode) {
    if (this.engineMode === engineMode) return;
    this.engineMode = engineMode;

    const oldCanvas = this.canvas;
    const newCanvas = oldCanvas.cloneNode(true);
    oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);
    this.canvas = newCanvas;

    if (!this.canvas.hasAttribute('layoutsubtree')) {
      this.canvas.setAttribute('layoutsubtree', '');
    }

    const pw = parseInt(this.canvas.getAttribute('data-pageflip-width') || this.canvas.dataset?.pageflipWidth, 10) || 1024;
    const ph = parseInt(this.canvas.getAttribute('data-pageflip-height') || this.canvas.dataset?.pageflipHeight, 10) || 768;

    const slideElements = Array.from(this.canvas.querySelectorAll('.slide'));
    this.slides = slideElements.map((el, index) => ({
      pageNum: index + 1,
      element: el,
      pw: pw,
      ph: ph
    }));

    if (engineMode === '3d') {
      this.renderer = new WebGLFlipbookRenderer(this.canvas, this.slides);
    } else {
      this.renderer = new HICFlipbookRenderer(this.canvas, this.slides);
    }

    this.applyDimensions();

    const curPage = this.flipbook ? this.flipbook.currentPage : 1;
    if (this.flipbook) {
      this.flipbook.setRenderer(this.renderer);
      this.flipbook.gotoPage(curPage);
    }
    this.renderer.resize();
    this.renderer.render(this.flipbook.getState());

    const handlePaint = () => {
      this.renderer.render(this.flipbook.getState());
    };
    this.canvas.onpaint = handlePaint;
    this.canvas.addEventListener('paint', handlePaint);
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
    this.slides = slideElements.map((el, index) => {
      return {
        pageNum: index + 1,
        element: el,
        pw: pw,
        ph: ph
      };
    });

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

    // 3. Apply canvas dimensions and background variables before renderer preloads textures
    this.applyDimensions();

    // 4. Initialize chosen renderer
    if (this.engineMode === '3d') {
      this.renderer = new WebGLFlipbookRenderer(this.canvas, this.slides);
    } else {
      this.renderer = new HICFlipbookRenderer(this.canvas, this.slides);
    }

    const totalPages = this.slides.length || 6;

    this.flipbook = new Flipbook(this.renderer, {
      totalPages,
      onPageChange: (state) => this.onPageChanged(state)
    });

    this.flipbook.totalPages = totalPages;
    this.renderer.resize();

    // 3. Observe attribute changes for dynamic width/height/background
    const attrObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && (m.attributeName === 'data-pageflip-width' || m.attributeName === 'data-pageflip-height' || m.attributeName === 'data-pageflip-background')) {
          this.applyDimensions();
          this.renderer.render(this.flipbook.getState());
        }
      }
    });
    attrObserver.observe(this.canvas, { attributes: true, attributeFilter: ['data-pageflip-width', 'data-pageflip-height', 'data-pageflip-background'] });

    // 4. Handle canvas resize with ResizeObserver
    const observer = new ResizeObserver(() => {
      this.renderer.resize();
      this.renderer.render(this.flipbook.getState());
    });
    observer.observe(this.container || this.canvas);

    // 5. Handle canvas paint & selection events
    const handlePaint = () => {
      if (this.engineMode === '3d' && this.renderer && this.flipbook) {
        const state = this.flipbook.getState();
        const [leftPage, rightPage] = state.currentSpread;
        if (!state.isDragging && (!state.activeFlip || state.activeFlip.isPeek)) {
          if (leftPage > 0 && this.slides[leftPage - 1]) {
            this.renderer.rasterizeSlideToTexture(this.slides[leftPage - 1]);
          }
          if (rightPage <= this.slides.length && this.slides[rightPage - 1]) {
            this.renderer.rasterizeSlideToTexture(this.slides[rightPage - 1]);
          }
        }
        this.renderer.render(state);
      } else if (this.renderer && this.flipbook) {
        this.renderer.render(this.flipbook.getState());
      }
    };
    this.canvas.onpaint = handlePaint;
    this.canvas.addEventListener('paint', handlePaint);

    const triggerPaintUpdate = () => {
      if (this.canvas && typeof this.canvas.requestPaint === 'function') {
        this.canvas.requestPaint();
      } else {
        handlePaint();
      }
    };

    document.addEventListener('selectionchange', triggerPaintUpdate);
    document.addEventListener('focusin', triggerPaintUpdate);
    document.addEventListener('focusout', triggerPaintUpdate);

    // 6. Setup UI bindings
    this.totalPagesSpan.textContent = totalPages;
    this.pageInput.max = totalPages;
    this.timelineSlider.max = totalPages;

    this.bindEvents();
    this.onPageChanged(this.flipbook.getState());
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.renderer.render(this.flipbook.getState());
    });

    this.prevBtn.addEventListener('click', () => this.flipbook.flipBackward());
    this.nextBtn.addEventListener('click', () => this.flipbook.flipForward());

    this.pageInput.addEventListener('change', (e) => {
      const p = parseInt(e.target.value, 10);
      if (!isNaN(p)) this.flipbook.gotoPage(p);
    });

    this.timelineSlider.addEventListener('input', (e) => {
      const p = parseInt(e.target.value, 10);
      this.updateTimelineProgress(p);
    });

    this.timelineSlider.addEventListener('change', (e) => {
      const p = parseInt(e.target.value, 10);
      this.flipbook.gotoPage(p);
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

        if (this.renderer && typeof this.renderer.preloadSlideTextures === 'function') {
          this.renderer.isReloadingTextures = true;
          this.slides.forEach((s) => {
            if (s.element) {
              s.element.style.transform = 'none';
            }
          });

          // Wait for layout frame to commit before capturing textures with texElementImage2D
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              this.renderer.preloadSlideTextures();
              this.renderer.isReloadingTextures = false;
              this.renderer.render(this.flipbook.getState());
            });
          });
        }
      });
    }

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        this.flipbook.flipBackward();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        this.flipbook.flipForward();
      } else if (e.key === 'Home') {
        e.preventDefault();
        this.flipbook.gotoPage(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        this.flipbook.gotoPage(this.flipbook.totalPages);
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

    if (this.canvas.requestPaint) {
      this.canvas.requestPaint();
    }
  }

  updateTimelineProgress(pageNum) {
    const total = this.flipbook.totalPages || 1;
    const pct = Math.max(0, Math.min(100, (pageNum / total) * 100));
    if (this.timelineFill) {
      this.timelineFill.style.width = `${pct}%`;
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.hicApp = new HICApp();
});

