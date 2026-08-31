/**
 * Main Application Orchestrator for PageFlip Book Viewer.
 * Uses books.json as the single source of truth.
 */

import { FlipbookRenderer } from './renderer.js';
import { Flipbook } from './flipbook.js';
import { ThumbnailsManager } from './thumbnails.js';

class App {
  constructor() {
    this.books = [];
    this.currentBook = null;
    this.renderer = null;
    this.flipbook = null;
    this.thumbnails = null;

    this.autoPlayTimer = null;
    this.autoPlayInterval = 4000;
    this.isAutoPlaying = false;

    this.init();
  }

  async init() {
    // 1. DOM elements
    this.canvas = document.getElementById('book-canvas');
    this.bookContainer = document.getElementById('book-container');
    this.bookSelect = document.getElementById('book-select');
    this.prevBtn = document.getElementById('prev-btn');
    this.nextBtn = document.getElementById('next-btn');
    this.pageInput = document.getElementById('page-input');
    this.totalPagesSpan = document.getElementById('total-pages');
    this.timelineSlider = document.getElementById('timeline-slider');
    this.timelineFill = document.getElementById('timeline-fill');

    this.playBtn = document.getElementById('autoplay-btn');
    this.fullscreenBtn = document.getElementById('fullscreen-btn');
    this.thumbsBtn = document.getElementById('thumbs-btn');
    this.themeSelect = document.getElementById('theme-select');

    this.thumbsDrawer = document.getElementById('thumbnails-drawer');
    this.thumbsGrid = document.getElementById('thumbnails-grid');
    this.closeThumbsBtn = document.getElementById('close-thumbs-btn');

    // 2. Initialize renderer & engine
    this.renderer = new FlipbookRenderer(this.canvas);
    this.flipbook = new Flipbook(this.renderer, {
      onPageChange: (state) => this.onPageChanged(state)
    });
    this.thumbnails = new ThumbnailsManager(this.thumbsGrid, this.timelineSlider, this.flipbook);

    // 3. Load books manifest (single source of truth)
    await this.loadBooks();

    // 4. Bind UI listeners
    this.bindUIEvents();

    // 5. Initial resize
    window.addEventListener('resize', () => {
      this.renderer.resize();
    });
    this.renderer.resize();
  }

  async loadBooks() {
    try {
      const resp = await fetch('books/books.json');
      this.books = await resp.json();

      this.bookSelect.innerHTML = '';
      for (const b of this.books) {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = `${b.title} (${b.pageCount} pages)`;
        this.bookSelect.appendChild(opt);
      }

      // Check URL query param for default book
      const params = new URLSearchParams(window.location.search);
      const requestedBook = params.get('book');
      const startBook = this.books.find((b) => b.id === requestedBook) || this.books[0];

      if (startBook) {
        this.bookSelect.value = startBook.id;
        this.selectBook(startBook.id);
      }
    } catch (e) {
      console.error('Failed to load books.json:', e);
    }
  }

  selectBook(bookId) {
    const meta = this.books.find((b) => b.id === bookId);
    if (!meta) return;

    this.currentBook = meta;

    // Update book title in header
    const titleEl = document.getElementById('book-title');
    const subTitleEl = document.getElementById('book-subtitle');
    if (titleEl) titleEl.textContent = `${meta.title} (${meta.pageCount} pages)`;
    if (subTitleEl) subTitleEl.textContent = meta.subtitle || meta.author;

    // Inform flipbook, renderer, and UI from books.json
    this.flipbook.setBook(meta);
    this.thumbnails.build(meta);
    this.totalPagesSpan.textContent = meta.pageCount;
    this.timelineSlider.max = meta.pageCount;
    this.pageInput.max = meta.pageCount;

    // Check if initial page specified in URL
    const params = new URLSearchParams(window.location.search);
    const pageParam = parseInt(params.get('page'), 10);
    if (pageParam && pageParam > 1) {
      this.flipbook.gotoPage(pageParam);
    } else {
      this.onPageChanged(this.flipbook.getState());
    }
  }

  bindUIEvents() {
    // Book selector
    this.bookSelect.addEventListener('change', (e) => {
      this.selectBook(e.target.value);
    });

    // Navigation buttons
    this.prevBtn.addEventListener('click', () => {
      this.stopAutoplay();
      this.flipbook.flipBackward();
    });

    this.nextBtn.addEventListener('click', () => {
      this.stopAutoplay();
      this.flipbook.flipForward();
    });

    // Page input direct jump
    this.pageInput.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val)) {
        this.stopAutoplay();
        this.flipbook.gotoPage(val);
      }
    });

    this.pageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.pageInput.blur();
      }
    });

    // Timeline Slider
    this.timelineSlider.addEventListener('input', (e) => {
      const page = parseInt(e.target.value, 10);
      this.updateTimelineProgress(page);
    });

    this.timelineSlider.addEventListener('change', (e) => {
      const page = parseInt(e.target.value, 10);
      this.stopAutoplay();
      this.flipbook.gotoPage(page);
    });

    // Autoplay / Slideshow
    this.playBtn.addEventListener('click', () => {
      this.toggleAutoplay();
    });

    // Thumbnails Drawer
    this.thumbsBtn.addEventListener('click', () => {
      this.thumbsDrawer.classList.toggle('open');
      this.thumbnails.isOpen = this.thumbsDrawer.classList.contains('open');
      if (this.thumbnails.isOpen) {
        this.thumbnails.updateActive(this.flipbook.getState());
      }
    });

    this.closeThumbsBtn.addEventListener('click', () => {
      this.thumbsDrawer.classList.remove('open');
      this.thumbnails.isOpen = false;
    });

    // Fullscreen
    this.fullscreenBtn.addEventListener('click', () => {
      this.toggleFullscreen();
    });

    // Desk theme selector
    this.themeSelect.addEventListener('change', (e) => {
      document.body.dataset.theme = e.target.value;
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;

      switch (e.key) {
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          this.stopAutoplay();
          this.flipbook.flipBackward();
          break;
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          this.stopAutoplay();
          this.flipbook.flipForward();
          break;
        case 'Home':
          e.preventDefault();
          this.stopAutoplay();
          this.flipbook.gotoPage(1);
          break;
        case 'End':
          e.preventDefault();
          this.stopAutoplay();
          this.flipbook.gotoPage(this.flipbook.totalPages);
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          this.toggleFullscreen();
          break;
        case 't':
        case 'T':
          e.preventDefault();
          this.thumbsBtn.click();
          break;
        case 'Escape':
          this.thumbsDrawer.classList.remove('open');
          break;
      }
    });

    // Mouse wheel page flipping
    let wheelAccum = 0;
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      wheelAccum += e.deltaY + e.deltaX;

      if (wheelAccum > 90) {
        wheelAccum = 0;
        this.stopAutoplay();
        this.flipbook.flipForward();
      } else if (wheelAccum < -90) {
        wheelAccum = 0;
        this.stopAutoplay();
        this.flipbook.flipBackward();
      }
    }, { passive: false });
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

    const labelEl = document.getElementById('spread-indicator');
    if (labelEl) labelEl.textContent = label;

    this.pageInput.value = curPageNum;
    this.timelineSlider.value = curPageNum;
    this.updateTimelineProgress(curPageNum);

    this.prevBtn.disabled = left <= 0;
    this.nextBtn.disabled = right > total;

    this.thumbnails.updateActive(state);
  }

  updateTimelineProgress(pageNum) {
    const total = this.flipbook.totalPages || 1;
    const pct = Math.max(0, Math.min(100, (pageNum / total) * 100));
    if (this.timelineFill) {
      this.timelineFill.style.width = `${pct}%`;
    }
  }

  toggleAutoplay() {
    if (this.isAutoPlaying) {
      this.stopAutoplay();
    } else {
      this.startAutoplay();
    }
  }

  startAutoplay() {
    this.isAutoPlaying = true;
    this.playBtn.classList.add('playing');
    this.playBtn.querySelector('.icon').textContent = '⏸';
    this.playBtn.setAttribute('aria-label', 'Pause Slideshow');

    this.autoPlayTimer = setInterval(() => {
      const [_, right] = this.flipbook.currentSpread;
      if (right > this.flipbook.totalPages) {
        this.flipbook.gotoPage(1);
      } else {
        this.flipbook.flipForward();
      }
    }, this.autoPlayInterval);
  }

  stopAutoplay() {
    if (!this.isAutoPlaying) return;
    this.isAutoPlaying = false;
    clearInterval(this.autoPlayTimer);
    this.autoPlayTimer = null;
    this.playBtn.classList.remove('playing');
    this.playBtn.querySelector('.icon').textContent = '▶';
    this.playBtn.setAttribute('aria-label', 'Play Slideshow');
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn('Fullscreen error:', err);
      });
      this.fullscreenBtn.classList.add('active');
    } else {
      document.exitFullscreen();
      this.fullscreenBtn.classList.remove('active');
    }
  }
}

// Instantiate application on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
