/**
 * HTML-in-Canvas (HIC) Controller for PageFlip.
 * Uses the Chrome HTML-in-Canvas API (drawElementImage & layoutsubtree).
 * See: https://developer.chrome.com/blog/html-in-canvas-origin-trial
 */

import { FlipbookRenderer } from './renderer.js';
import { Flipbook } from './flipbook.js';

/**
 * Custom Renderer extending FlipbookRenderer to use ctx.drawElementImage with full-viewport canvas
 */
class HICFlipbookRenderer extends FlipbookRenderer {
  constructor(canvas, slides) {
    super(canvas);
    this.slides = slides;
    this.devicePixelRatio = 1;
  }

  resize() {
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

    if (leftPage > 0) activePages.add(leftPage);
    if (rightPage <= totalPages) activePages.add(rightPage);

    if (state.activeFlip) {
      if (state.activeFlip.dir > 0) {
        if (rightPage + 1 <= totalPages) activePages.add(rightPage + 1);
        if (rightPage + 2 <= totalPages) activePages.add(rightPage + 2);
      } else {
        if (leftPage - 1 > 0) activePages.add(leftPage - 1);
        if (leftPage - 2 > 0) activePages.add(leftPage - 2);
      }
    }

    // Dynamically inert all non-viewed pages
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
    let drawn = false;

    if (typeof ctx.drawElementImage === 'function') {
      try {
        ctx.save();
        ctx.translate(x, y);
        const transform = ctx.drawElementImage(el, 0, 0);
        if (transform && el.style) {
          el.style.transform = transform.toString();
        }
        ctx.restore();
        drawn = true;
      } catch (err) {
        // Fallback if paint record not ready
      }
    }

    if (!drawn) {
      super.drawPage(ctx, pageNum, x, y, w, h);
    }
  }

  drawPageBack(ctx, pageNum, x, y, w, h) {
    const slide = this.slides[pageNum - 1];
    if (!slide || !slide.element) return;

    const el = slide.element;
    let drawn = false;

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
        drawn = true;
      } catch (err) {
        // Fallback
      }
    }

    if (!drawn) {
      super.drawPageBack(ctx, pageNum, x, y, w, h);
    }
  }

  drawPageFrontReflected(ctx, pageNum, x, y, w, h) {
    const slide = this.slides[pageNum - 1];
    if (!slide || !slide.element) return;

    const el = slide.element;
    let drawn = false;

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
        drawn = true;
      } catch (err) {
        // Fallback
      }
    }

    if (!drawn) {
      super.drawPageFrontReflected(ctx, pageNum, x, y, w, h);
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
    this.fullscreenBtn = document.getElementById('fullscreen-btn');

    this.slides = [];
    this.renderer = null;
    this.flipbook = null;

    this.init();
  }

  init() {
    // 1. Extract slides from canvas child elements
    const slideElements = Array.from(this.canvas.querySelectorAll('.slide'));
    this.slides = slideElements.map((el, index) => {
      const pageNum = index + 1;
      const bgEl = el.querySelector('.bg');
      let imgUrl = '';
      if (bgEl) {
        const bgStyle = bgEl.style.backgroundImage || '';
        const match = bgStyle.match(/url\(["']?([^"']+)["']?\)/);
        if (match && match[1]) {
          imgUrl = match[1].replace(/^\//, ''); // normalize relative path
        }
      }

      // Read dimensions from span attributes or default to 1024x768
      const spanEl = el.querySelector('.texts span, .text span');
      const pw = spanEl ? parseInt(spanEl.getAttribute('page-width') || spanEl.style.getPropertyValue('--page-width'), 10) || 1024 : 1024;
      const ph = spanEl ? parseInt(spanEl.getAttribute('page-height') || spanEl.style.getPropertyValue('--page-height'), 10) || 768 : 768;

      return {
        pageNum,
        element: el,
        imgUrl,
        pw,
        ph
      };
    });

    const totalPages = this.slides.length || 6;
    const pw = this.slides[0]?.pw || 1024;
    const ph = this.slides[0]?.ph || 768;

    // 2. Initialize HIC Canvas Renderer & Engine
    this.renderer = new HICFlipbookRenderer(this.canvas, this.slides);
    this.renderer.setDimensions(pw, ph);

    // Preload fallback images for browsers without drawElementImage
    this.slides.forEach((s) => {
      if (s.imgUrl) {
        this.renderer.preloadImage(s.pageNum, s.imgUrl);
      }
    });

    this.flipbook = new Flipbook(this.renderer, {
      totalPages,
      onPageChange: (state) => this.onPageChanged(state)
    });

    this.flipbook.totalPages = totalPages;
    this.renderer.resize();

    // 3. Handle canvas resize with ResizeObserver
    const observer = new ResizeObserver(() => {
      this.renderer.resize();
      this.renderer.render(this.flipbook.getState());
    });
    observer.observe(this.container || this.canvas);

    // 4. Handle canvas paint & selection events
    const handlePaint = () => {
      this.renderer.render(this.flipbook.getState());
    };
    this.canvas.onpaint = handlePaint;
    this.canvas.addEventListener('paint', handlePaint);

    document.addEventListener('selectionchange', () => {
      if (this.canvas && typeof this.canvas.requestPaint === 'function') {
        this.canvas.requestPaint();
        requestAnimationFrame(() => {
          this.canvas.requestPaint();
        });
      } else {
        this.renderer.render(this.flipbook.getState());
        requestAnimationFrame(() => {
          this.renderer.render(this.flipbook.getState());
        });
      }
    });

    // 5. Setup UI bindings
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
      this.themeSelect.addEventListener('change', (e) => {
        document.body.dataset.theme = e.target.value;
      });
    }

    if (this.fullscreenBtn) {
      this.fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen();
        } else {
          document.exitFullscreen();
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
