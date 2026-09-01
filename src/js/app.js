/**
 * HTML-in-Canvas (HIC) Application Controller for PageFlip.
 * Manages UI controls, theme selector, URL parameters, keyboard shortcuts,
 * and communicates directly with the <hic-pageflip> custom element.
 */

import './hic-pageflip/index.js';

export class HICApp {
  constructor() {
    this.pageflip = document.querySelector('hic-pageflip');
    this.prevBtn = document.getElementById('prev-btn');
    this.nextBtn = document.getElementById('next-btn');
    this.pageInput = document.getElementById('page-input');
    this.totalPagesSpan = document.getElementById('total-pages');
    this.timelineSlider = document.getElementById('timeline-slider');
    this.timelineFill = document.getElementById('timeline-fill');
    this.spreadIndicator = document.getElementById('spread-indicator');
    this.themeSelect = document.getElementById('theme-select');

    this.engineMode = '2d'; // '2d' or '3d'

    this.init();
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

    if (!this.pageflip) return;

    // 1. Determine engine mode from URL param ?engine=2d or ?engine=3d
    const urlParams = new URLSearchParams(window.location.search);
    const engineParam = urlParams.get('engine');
    this.engineMode = engineParam === '3d' ? '3d' : '2d';
    this.pageflip.engineMode = this.engineMode;

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

    // 2. Setup UI bindings
    const totalPages = this.pageflip.totalPages || 6;
    this.totalPagesSpan.textContent = totalPages;
    this.pageInput.max = totalPages;
    this.timelineSlider.max = totalPages;

    this.bindEvents();
    this.onPageChanged(this.pageflip.getState());
  }

  bindEvents() {
    // Listen for custom element pagechange events
    this.pageflip.addEventListener('pagechange', (e) => {
      this.onPageChanged(e.detail);
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

    // Handle selection and focus updates
    const triggerPaintUpdate = () => {
      this.pageflip.requestRender();
    };
    document.addEventListener('selectionchange', triggerPaintUpdate);
    document.addEventListener('focusin', triggerPaintUpdate);
    document.addEventListener('focusout', triggerPaintUpdate);

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
