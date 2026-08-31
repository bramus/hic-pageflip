/**
 * Flipbook Controller & Interaction Engine.
 * Manages state, gesture interactions (mouse/touch), corner hover peeks,
 * spring-eased animations, and page navigation.
 */

import { constrainPaper, Easing, clamp } from './math.js';

export class Flipbook {
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.canvas = renderer.canvas;

    this.totalPages = options.totalPages || 25;
    this.bookId = options.bookId || '';

    // Current page: 0 = closed (cover on right), 2 = pages 2 & 3, etc.
    this.currentPage = 0;
    this.activeFlip = null; // { sx, sy, px, py, dir, isPeek, animating, ... }
    this.hoverCorner = null; // 'tr' | 'br' | 'tl' | 'bl' | null
    this.isDragging = false;
    this.dragStartScreen = { x: 0, y: 0 };
    this.lastPointer = { x: 0, y: 0, time: 0 };
    this.velocity = { x: 0, y: 0 };

    // Auto-flip animation state
    this.animation = null;

    // Callbacks
    this.onPageChange = options.onPageChange || null;
    this.onFlipProgress = options.onFlipProgress || null;

    this.bindEvents();
    this.startLoop();
  }

  get currentSpread() {
    if (this.currentPage === 0) {
      return [0, 1]; // Left blank, Right is Cover (Page 1)
    }
    const left = this.currentPage;
    const right = this.currentPage + 1;
    return [left, right];
  }

  getState() {
    return {
      currentPage: this.currentPage,
      totalPages: this.totalPages,
      currentSpread: this.currentSpread,
      activeFlip: this.activeFlip,
      hoverCorner: this.hoverCorner,
      isDragging: this.isDragging
    };
  }

  setRenderer(renderer) {
    this.renderer = renderer;
    this.canvas = renderer.canvas;
    this.bindEvents();
  }

  setBook(bookMeta) {
    this.bookId = bookMeta.id;
    this.totalPages = bookMeta.pageCount;
    this.currentPage = 0;
    this.activeFlip = null;
    this.animation = null;

    // Reset image cache for the new book so old book images are cleared
    this.renderer.clearCache();
    this.renderer.setDimensions(bookMeta.width, bookMeta.height);
    this.renderer.resize();

    // Preload pages for the new book
    this.preloadSurroundingPages();
    this.notifyPageChange();
  }

  preloadSurroundingPages() {
    if (!this.bookId) return;
    const spread = this.currentSpread;
    const toPreload = [
      1, 2, 3, 4, 5, 6,
      spread[0] - 2,
      spread[0] - 1,
      spread[0],
      spread[1],
      spread[1] + 1,
      spread[1] + 2,
      spread[1] + 3
    ].filter((p) => p >= 1 && p <= this.totalPages);

    const uniquePages = Array.from(new Set(toPreload));
    for (const p of uniquePages) {
      const pageStr = String(p).padStart(2, '0');
      const url = `books/${this.bookId}/${pageStr}.png`;
      this.renderer.preloadImage(p, url);
    }
  }

  bindEvents() {
    const el = this.canvas;

    // Mouse events
    el.addEventListener('mousemove', (e) => this.handlePointerMove(e));
    el.addEventListener('mousedown', (e) => this.handlePointerDown(e));
    window.addEventListener('mouseup', (e) => this.handlePointerUp(e));
    el.addEventListener('mouseleave', () => this.handlePointerLeave());

    // Touch events
    el.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
    el.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
    window.addEventListener('touchend', (e) => this.handleTouchEnd(e));
    window.addEventListener('touchcancel', (e) => this.handleTouchEnd(e));
  }

  /**
   * Detects if pointer is near interactive flip areas / corners
   */
  detectCorner(bookPt) {
    const pw = this.renderer.pw;
    const ph = this.renderer.ph;
    const cornerSize = Math.min(pw, ph) * 0.35;
    const [leftPage, rightPage] = this.currentSpread;

    // Right side corners (Forward flip available if right page exists)
    if (rightPage <= this.totalPages && bookPt.x > 0 && bookPt.x <= pw) {
      // Top Right
      if (bookPt.x > pw - cornerSize && bookPt.y < -ph / 2 + cornerSize) {
        return { corner: 'tr', sx: pw, sy: -ph / 2, dir: 1 };
      }
      // Bottom Right
      if (bookPt.x > pw - cornerSize && bookPt.y > ph / 2 - cornerSize) {
        return { corner: 'br', sx: pw, sy: ph / 2, dir: 1 };
      }
      // Right edge
      if (bookPt.x > pw - cornerSize * 0.45 && Math.abs(bookPt.y) <= ph / 2) {
        const sy = bookPt.y < 0 ? -ph / 2 : ph / 2;
        return { corner: 're', sx: pw, sy: sy, dir: 1 };
      }
    }

    // Left side corners (Backward flip available if left page exists)
    if (leftPage > 0 && bookPt.x < 0 && bookPt.x >= -pw) {
      // Top Left
      if (bookPt.x < -pw + cornerSize && bookPt.y < -ph / 2 + cornerSize) {
        return { corner: 'tl', sx: -pw, sy: -ph / 2, dir: -1 };
      }
      // Bottom Left
      if (bookPt.x < -pw + cornerSize && bookPt.y > ph / 2 - cornerSize) {
        return { corner: 'bl', sx: -pw, sy: ph / 2, dir: -1 };
      }
      // Left edge
      if (bookPt.x < -pw + cornerSize * 0.45 && Math.abs(bookPt.y) <= ph / 2) {
        const sy = bookPt.y < 0 ? -ph / 2 : ph / 2;
        return { corner: 'le', sx: -pw, sy: sy, dir: -1 };
      }
    }

    return null;
  }

  handlePointerMove(e) {
    if (this.animation) return;

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const bookPt = this.renderer.screenToBook(screenX, screenY);

    const now = performance.now();
    const dt = Math.max(1, now - this.lastPointer.time);
    this.velocity = {
      x: (screenX - this.lastPointer.x) / dt,
      y: (screenY - this.lastPointer.y) / dt
    };
    this.lastPointer = { x: screenX, y: screenY, time: now };

    if (this.isDragging && this.activeFlip) {
      const pw = this.renderer.pw;
      const ph = this.renderer.ph;
      const constrained = constrainPaper(
        bookPt.x,
        bookPt.y,
        this.activeFlip.sx,
        this.activeFlip.sy,
        pw,
        ph
      );

      this.activeFlip.px = constrained.x;
      this.activeFlip.py = constrained.y;
      this.activeFlip.isPeek = false;
      this.canvas.style.cursor = 'grabbing';
      this.notifyFlipProgress();
      return;
    }

    // Dynamic hover tracking: Corner curl follows the mouse position in real-time
    const hit = this.detectCorner(bookPt);
    if (hit) {
      this.hoverCorner = hit.corner;
      this.canvas.style.cursor = 'pointer';

      const pw = this.renderer.pw;
      const ph = this.renderer.ph;

      // Constrain mouse position to valid paper curl physics
      const constrained = constrainPaper(
        bookPt.x,
        bookPt.y,
        hit.sx,
        hit.sy,
        pw,
        ph
      );

      this.activeFlip = {
        sx: hit.sx,
        sy: hit.sy,
        px: constrained.x,
        py: constrained.y,
        dir: hit.dir,
        isPeek: true
      };
      this.notifyFlipProgress();
    } else {
      this.hoverCorner = null;
      this.canvas.style.cursor = 'default';
      if (this.activeFlip && this.activeFlip.isPeek) {
        this.activeFlip = null;
        this.notifyFlipProgress();
      }
    }
  }

  handlePointerDown(e) {
    if (this.animation) return;

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const bookPt = this.renderer.screenToBook(screenX, screenY);

    const hit = this.detectCorner(bookPt);
    if (hit) {
      this.isDragging = true;
      this.dragStartScreen = { x: screenX, y: screenY };

      const pw = this.renderer.pw;
      const ph = this.renderer.ph;
      const constrained = constrainPaper(bookPt.x, bookPt.y, hit.sx, hit.sy, pw, ph);

      this.activeFlip = {
        sx: hit.sx,
        sy: hit.sy,
        px: constrained.x,
        py: constrained.y,
        dir: hit.dir,
        isPeek: false
      };
      this.canvas.style.cursor = 'grabbing';
      this.notifyFlipProgress();
    }
  }

  handlePointerUp(e) {
    if (!this.isDragging || !this.activeFlip || this.activeFlip.isPeek) {
      this.isDragging = false;
      return;
    }

    this.isDragging = false;
    this.canvas.style.cursor = 'default';

    const flip = this.activeFlip;
    const pw = this.renderer.pw;

    let shouldComplete = false;

    if (flip.dir > 0) {
      const progress = (pw - flip.px) / (pw * 2);
      if (progress > 0.22 || this.velocity.x < -0.35) {
        shouldComplete = true;
      }
    } else {
      const progress = (flip.px - (-pw)) / (pw * 2);
      if (progress > 0.22 || this.velocity.x > 0.35) {
        shouldComplete = true;
      }
    }

    this.animateFlipCompletion(flip, shouldComplete);
  }

  handlePointerLeave() {
    if (!this.isDragging && this.activeFlip && this.activeFlip.isPeek) {
      this.activeFlip = null;
      this.hoverCorner = null;
      this.notifyFlipProgress();
    }
  }

  handleTouchStart(e) {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      this.handlePointerDown({ clientX: touch.clientX, clientY: touch.clientY });
    }
  }

  handleTouchMove(e) {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      this.handlePointerMove({ clientX: touch.clientX, clientY: touch.clientY });
      if (this.isDragging) {
        e.preventDefault();
      }
    }
  }

  handleTouchEnd(e) {
    this.handlePointerUp(e);
  }

  animateFlipCompletion(flip, complete) {
    const pw = this.renderer.pw;
    const startPx = flip.px;
    const startPy = flip.py;

    let targetPx, targetPy;
    if (complete) {
      targetPx = flip.dir > 0 ? -pw - 15 : pw + 15;
      targetPy = flip.sy;
    } else {
      targetPx = flip.sx;
      targetPy = flip.sy;
    }

    const startTime = performance.now();
    const duration = complete ? 340 : 240;

    this.animation = {
      startTime,
      duration,
      tick: (now) => {
        const elapsed = now - startTime;
        const rawProgress = Math.min(1, elapsed / duration);
        const t = Easing.easeOutCubic(rawProgress);

        flip.px = startPx + (targetPx - startPx) * t;
        flip.py = startPy + (targetPy - startPy) * t;

        this.notifyFlipProgress();

        if (rawProgress >= 1) {
          this.animation = null;
          this.activeFlip = null;

          if (complete) {
            if (flip.dir > 0) {
              this.currentPage = Math.min(this.totalPages, this.currentPage + 2);
            } else {
              this.currentPage = Math.max(0, this.currentPage - 2);
            }
            this.preloadSurroundingPages();
            this.notifyPageChange();
          }
        }
      }
    };
  }

  flipForward() {
    if (this.animation) return;
    const [_, rightPage] = this.currentSpread;
    if (rightPage > this.totalPages) return;

    const pw = this.renderer.pw;
    const ph = this.renderer.ph;
    const sx = pw;
    const sy = ph / 2;

    this.activeFlip = {
      sx,
      sy,
      px: sx - 10,
      py: sy - 10,
      dir: 1,
      isPeek: false
    };

    const startTime = performance.now();
    const duration = 480;

    this.animation = {
      startTime,
      duration,
      tick: (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const t = Easing.easeInOutCubic(progress);

        const x = pw - (pw * 2 + 30) * t;
        const arcY = Math.sin(progress * Math.PI) * (ph * 0.16);
        const y = sy - arcY;

        const constrained = constrainPaper(x, y, sx, sy, pw, ph);
        this.activeFlip.px = constrained.x;
        this.activeFlip.py = constrained.y;

        this.notifyFlipProgress();

        if (progress >= 1) {
          this.animation = null;
          this.activeFlip = null;
          this.currentPage = Math.min(this.totalPages, this.currentPage + 2);
          this.preloadSurroundingPages();
          this.notifyPageChange();
        }
      }
    };
  }

  flipBackward() {
    if (this.animation) return;
    const [leftPage, _] = this.currentSpread;
    if (leftPage <= 0) return;

    const pw = this.renderer.pw;
    const ph = this.renderer.ph;
    const sx = -pw;
    const sy = ph / 2;

    this.activeFlip = {
      sx,
      sy,
      px: sx + 10,
      py: sy - 10,
      dir: -1,
      isPeek: false
    };

    const startTime = performance.now();
    const duration = 480;

    this.animation = {
      startTime,
      duration,
      tick: (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const t = Easing.easeInOutCubic(progress);

        const x = -pw + (pw * 2 + 30) * t;
        const arcY = Math.sin(progress * Math.PI) * (ph * 0.16);
        const y = sy - arcY;

        const constrained = constrainPaper(x, y, sx, sy, pw, ph);
        this.activeFlip.px = constrained.x;
        this.activeFlip.py = constrained.y;

        this.notifyFlipProgress();

        if (progress >= 1) {
          this.animation = null;
          this.activeFlip = null;
          this.currentPage = Math.max(0, this.currentPage - 2);
          this.preloadSurroundingPages();
          this.notifyPageChange();
        }
      }
    };
  }

  gotoPage(target) {
    const cleanTarget = clamp(Math.floor(target), 0, this.totalPages);
    const targetSpread = cleanTarget <= 1 ? 0 : Math.floor(cleanTarget / 2) * 2;

    if (targetSpread === this.currentPage) return;

    if (Math.abs(targetSpread - this.currentPage) === 2) {
      if (targetSpread > this.currentPage) {
        this.flipForward();
      } else {
        this.flipBackward();
      }
    } else {
      this.currentPage = targetSpread;
      this.activeFlip = null;
      this.animation = null;
      this.preloadSurroundingPages();
      this.notifyPageChange();
    }
  }

  notifyPageChange() {
    if (this.onPageChange) {
      this.onPageChange(this.getState());
    }
  }

  notifyFlipProgress() {
    if (this.onFlipProgress) {
      this.onFlipProgress(this.getState());
    }
  }

  startLoop() {
    const loop = (now) => {
      if (this.animation) {
        this.animation.tick(now);
      }
      this.renderer.render(this.getState());
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
