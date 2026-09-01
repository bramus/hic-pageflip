/**
 * Pageflip Controller & Interaction Engine.
 * Standalone class that manages page flip state, gesture interactions (mouse/touch),
 * corner hover peeks, animations, and active engine (2D/3D) rendering on a canvas.
 */

import { constrainPaper, Easing, clamp } from './utils/math.js';
import { HICPageflipEngine2D } from './engines/engine-2d.js';
import { HICPageflipEngine3D } from './engines/engine-3d.js';

export class Pageflip {
  constructor(canvas, slides = [], options = {}) {
    this.canvas = canvas;
    this.slides = slides;
    this.engineMode = options.engine || '2d';
    this.totalPages = options.totalPages || slides.length || 6;

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
    this._rafLoopId = null;

    // Callbacks
    this.onPageChange = options.onPageChange || null;
    this.onFlipProgress = options.onFlipProgress || null;

    this.createEngine(this.engineMode);
    this.bindEvents();
    this.startLoop();
  }

  createEngine(engineMode) {
    if (engineMode === '3d') {
      this.engine = new HICPageflipEngine3D(this.canvas, this.slides);
    } else {
      this.engine = new HICPageflipEngine2D(this.canvas, this.slides);
    }
  }

  setSlides(slides) {
    this.slides = slides || [];
    this.totalPages = this.slides.length;
    if (this.engine) {
      this.engine.slides = this.slides;
    }
  }

  switchEngine(engineMode) {
    if (this.engineMode === engineMode && this.engine) return;
    this.engineMode = engineMode;

    this.createEngine(engineMode);
    this.setDimensions(this.pw, this.ph);
    this.render();
  }

  get pw() {
    return this.engine ? this.engine.pw : 1024;
  }

  get ph() {
    return this.engine ? this.engine.ph : 768;
  }

  setDimensions(pw, ph) {
    this.slides.forEach((s) => {
      s.pw = pw;
      s.ph = ph;
    });
    if (this.engine) {
      this.engine.setDimensions(pw, ph);
    }
  }

  resize() {
    if (this.engine) {
      this.engine.resize();
    }
  }

  render() {
    if (this.engine) {
      this.engine.render(this.getState());
    }
  }

  requestRender() {
    if (this.canvas && typeof this.canvas.requestPaint === 'function') {
      this.canvas.requestPaint();
    } else if (this.engine) {
      this.engine.requestRender(() => this.render());
    }
  }

  handlePaint() {
    if (this.engineMode === '3d' && this.engine) {
      const state = this.getState();
      const [leftPage, rightPage] = state.currentSpread;
      if (!state.isDragging && (!state.activeFlip || state.activeFlip.isPeek)) {
        if (leftPage > 0 && this.slides[leftPage - 1]) {
          this.engine.rasterizeSlideToTexture(this.slides[leftPage - 1]);
        }
        if (rightPage <= this.slides.length && this.slides[rightPage - 1]) {
          this.engine.rasterizeSlideToTexture(this.slides[rightPage - 1]);
        }
      }
      this.engine.render(state);
    } else if (this.engine) {
      this.engine.render(this.getState());
    }
  }

  reloadTextures() {
    if (this.engine && typeof this.engine.preloadSlideTextures === 'function') {
      this.engine.isReloadingTextures = true;
      this.slides.forEach((s) => {
        if (s.element) {
          s.element.style.transform = 'none';
        }
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.engine.preloadSlideTextures();
          this.engine.isReloadingTextures = false;
          this.render();
        });
      });
    } else {
      this.render();
    }
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

  bindEvents() {
    const el = this.canvas;
    if (!el) return;

    this._onPointerMove = (e) => this.handlePointerMove(e);
    this._onPointerDown = (e) => this.handlePointerDown(e);
    this._onPointerUp = (e) => this.handlePointerUp(e);
    this._onPointerLeave = () => this.handlePointerLeave();
    this._onTouchStart = (e) => this.handleTouchStart(e);
    this._onTouchMove = (e) => this.handleTouchMove(e);
    this._onTouchEnd = (e) => this.handleTouchEnd(e);
    this._onPaint = () => this.handlePaint();

    // Mouse events
    el.addEventListener('mousemove', this._onPointerMove);
    el.addEventListener('mousedown', this._onPointerDown);
    window.addEventListener('mouseup', this._onPointerUp);
    el.addEventListener('mouseleave', this._onPointerLeave);

    // Touch events
    el.addEventListener('touchstart', this._onTouchStart, { passive: false });
    el.addEventListener('touchmove', this._onTouchMove, { passive: false });
    window.addEventListener('touchend', this._onTouchEnd);
    window.addEventListener('touchcancel', this._onTouchEnd);

    // Paint listener
    el.onpaint = this._onPaint;
    el.addEventListener('paint', this._onPaint);
  }

  unbindEvents() {
    const el = this.canvas;
    if (!el) return;

    el.removeEventListener('mousemove', this._onPointerMove);
    el.removeEventListener('mousedown', this._onPointerDown);
    window.removeEventListener('mouseup', this._onPointerUp);
    el.removeEventListener('mouseleave', this._onPointerLeave);

    el.removeEventListener('touchstart', this._onTouchStart);
    el.removeEventListener('touchmove', this._onTouchMove);
    window.removeEventListener('touchend', this._onTouchEnd);
    window.removeEventListener('touchcancel', this._onTouchEnd);

    el.removeEventListener('paint', this._onPaint);
  }

  destroy() {
    this.unbindEvents();
    if (this._rafLoopId) {
      cancelAnimationFrame(this._rafLoopId);
      this._rafLoopId = null;
    }
  }

  detectCorner(bookX, bookY) {
    const pw = this.pw;
    const ph = this.ph;
    const cornerSize = Math.min(pw * 0.35, 180);
    const [leftPage, rightPage] = this.currentSpread;

    if (rightPage <= this.totalPages) {
      if (bookX > pw - cornerSize && bookX <= pw) {
        if (bookY > ph / 2 - cornerSize) return 'br';
        if (bookY < -ph / 2 + cornerSize) return 'tr';
      }
    }

    if (leftPage > 0) {
      if (bookX < -pw + cornerSize && bookX >= -pw) {
        if (bookY > ph / 2 - cornerSize) return 'bl';
        if (bookY < -ph / 2 + cornerSize) return 'tl';
      }
    }

    return null;
  }

  handlePointerMove(e) {
    if (this.animation || !this.engine) return;

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const now = performance.now();
    const dt = Math.max(1, now - (this.lastPointer.time || now));
    this.velocity = {
      x: (screenX - this.lastPointer.x) / dt,
      y: (screenY - this.lastPointer.y) / dt
    };
    this.lastPointer = { x: screenX, y: screenY, time: now };

    const bookPt = this.engine.screenToBook(screenX, screenY);

    if (this.isDragging && this.activeFlip) {
      this.updateDrag(bookPt.x, bookPt.y);
      return;
    }

    const corner = this.detectCorner(bookPt.x, bookPt.y);
    if (corner !== this.hoverCorner) {
      this.hoverCorner = corner;
      this.canvas.style.cursor = corner ? 'pointer' : 'default';

      if (corner && !this.activeFlip) {
        this.startCornerPeek(corner);
      } else if (!corner && this.activeFlip && this.activeFlip.isPeek) {
        this.endCornerPeek();
      }
    }
  }

  handlePointerDown(e) {
    if (e.button !== 0 || this.animation || !this.engine) return;

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const bookPt = this.engine.screenToBook(screenX, screenY);

    const corner = this.detectCorner(bookPt.x, bookPt.y);
    if (corner) {
      this.startDrag(corner, bookPt.x, bookPt.y, screenX, screenY);
    }
  }

  handlePointerUp(e) {
    if (!this.isDragging) return;
    this.endDrag();
  }

  handlePointerLeave() {
    if (!this.isDragging && this.activeFlip && this.activeFlip.isPeek) {
      this.endCornerPeek();
    }
    this.hoverCorner = null;
    if (this.canvas) this.canvas.style.cursor = 'default';
  }

  handleTouchStart(e) {
    if (e.touches.length !== 1 || this.animation || !this.engine) return;
    const touch = e.touches[0];
    const rect = this.canvas.getBoundingClientRect();
    const screenX = touch.clientX - rect.left;
    const screenY = touch.clientY - rect.top;
    const bookPt = this.engine.screenToBook(screenX, screenY);

    const corner = this.detectCorner(bookPt.x, bookPt.y);
    if (corner) {
      e.preventDefault();
      this.startDrag(corner, bookPt.x, bookPt.y, screenX, screenY);
    }
  }

  handleTouchMove(e) {
    if (!this.isDragging || e.touches.length !== 1 || !this.engine) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = this.canvas.getBoundingClientRect();
    const screenX = touch.clientX - rect.left;
    const screenY = touch.clientY - rect.top;

    const now = performance.now();
    const dt = Math.max(1, now - (this.lastPointer.time || now));
    this.velocity = {
      x: (screenX - this.lastPointer.x) / dt,
      y: (screenY - this.lastPointer.y) / dt
    };
    this.lastPointer = { x: screenX, y: screenY, time: now };

    const bookPt = this.engine.screenToBook(screenX, screenY);
    this.updateDrag(bookPt.x, bookPt.y);
  }

  handleTouchEnd(e) {
    if (this.isDragging) {
      this.endDrag();
    }
  }

  getCornerCoords(corner) {
    const pw = this.pw;
    const ph = this.ph;
    switch (corner) {
      case 'br': return { x: pw, y: ph / 2, dir: 1 };
      case 'tr': return { x: pw, y: -ph / 2, dir: 1 };
      case 'bl': return { x: -pw, y: ph / 2, dir: -1 };
      case 'tl': return { x: -pw, y: -ph / 2, dir: -1 };
      default: return null;
    }
  }

  startCornerPeek(corner) {
    const origin = this.getCornerCoords(corner);
    if (!origin) return;

    const peekDistance = 35;
    const targetPx = origin.dir > 0 ? origin.x - peekDistance : origin.x + peekDistance;
    const targetPy = origin.y > 0 ? origin.y - peekDistance : origin.y + peekDistance;

    this.activeFlip = {
      corner,
      sx: origin.x,
      sy: origin.y,
      px: targetPx,
      py: targetPy,
      dir: origin.dir,
      isPeek: true
    };
  }

  endCornerPeek() {
    if (!this.activeFlip || !this.activeFlip.isPeek) return;
    const flip = this.activeFlip;
    const startPx = flip.px;
    const startPy = flip.py;
    const targetPx = flip.sx;
    const targetPy = flip.sy;

    const startTime = performance.now();
    const duration = 200;

    this.animation = {
      startTime,
      duration,
      tick: (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const t = Easing.easeOutQuad(progress);

        flip.px = startPx + (targetPx - startPx) * t;
        flip.py = startPy + (targetPy - startPy) * t;

        if (progress >= 1) {
          this.animation = null;
          this.activeFlip = null;
        }
      }
    };
  }

  startDrag(corner, bookX, bookY, screenX, screenY) {
    const origin = this.getCornerCoords(corner);
    if (!origin) return;

    this.isDragging = true;
    this.hoverCorner = null;
    this.animation = null;
    this.dragStartScreen = { x: screenX, y: screenY };

    this.activeFlip = {
      corner,
      sx: origin.x,
      sy: origin.y,
      px: bookX,
      py: bookY,
      dir: origin.dir,
      isPeek: false
    };

    if (this.canvas) this.canvas.style.cursor = 'grabbing';
  }

  updateDrag(bookX, bookY) {
    if (!this.activeFlip) return;
    const pw = this.pw;
    const ph = this.ph;
    const flip = this.activeFlip;

    const constrained = constrainPaper(bookX, bookY, flip.sx, flip.sy, pw, ph);
    flip.px = constrained.x;
    flip.py = constrained.y;

    this.notifyFlipProgress();
  }

  endDrag() {
    this.isDragging = false;
    if (this.canvas) this.canvas.style.cursor = 'default';
    if (!this.activeFlip) return;

    const pw = this.pw;
    const flip = this.activeFlip;
    const dragX = flip.px;
    const vx = this.velocity.x;

    let complete = false;
    if (flip.dir > 0) {
      complete = dragX < 0 || vx < -0.4;
    } else {
      complete = dragX > 0 || vx > 0.4;
    }

    this.animateFlipCompletion(complete);
  }

  animateFlipCompletion(complete) {
    const flip = this.activeFlip;
    if (!flip) return;

    const pw = this.pw;
    const startPx = flip.px;
    const startPy = flip.py;

    let targetPx, targetPy;
    if (complete) {
      targetPx = flip.dir > 0 ? -pw : pw;
      targetPy = flip.sy;
    } else {
      targetPx = flip.sx;
      targetPy = flip.sy;
    }

    const dist = Math.hypot(targetPx - startPx, targetPy - startPy);
    const duration = clamp(dist * 0.75, 200, 480);
    const startTime = performance.now();

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

    const pw = this.pw;
    const ph = this.ph;
    const sx = pw;
    const sy = ph / 2;

    this.activeFlip = {
      sx,
      sy,
      px: sx,
      py: sy,
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

        const x = pw - (pw * 2) * t;
        const arcY = Math.sin(t * Math.PI) * (ph * 0.16);
        const y = sy - arcY;

        const constrained = constrainPaper(x, y, sx, sy, pw, ph);
        this.activeFlip.px = constrained.x;
        this.activeFlip.py = constrained.y;

        this.notifyFlipProgress();

        if (progress >= 1) {
          this.animation = null;
          this.activeFlip = null;
          this.currentPage = Math.min(this.totalPages, this.currentPage + 2);
          this.notifyPageChange();
        }
      }
    };
  }

  flipBackward() {
    if (this.animation) return;
    const [leftPage, _] = this.currentSpread;
    if (leftPage <= 0) return;

    const pw = this.pw;
    const ph = this.ph;
    const sx = -pw;
    const sy = ph / 2;

    this.activeFlip = {
      sx,
      sy,
      px: sx,
      py: sy,
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

        const x = -pw + (pw * 2) * t;
        const arcY = Math.sin(t * Math.PI) * (ph * 0.16);
        const y = sy - arcY;

        const constrained = constrainPaper(x, y, sx, sy, pw, ph);
        this.activeFlip.px = constrained.x;
        this.activeFlip.py = constrained.y;

        this.notifyFlipProgress();

        if (progress >= 1) {
          this.animation = null;
          this.activeFlip = null;
          this.currentPage = Math.max(0, this.currentPage - 2);
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
      this.render();
      this._rafLoopId = requestAnimationFrame(loop);
    };
    this._rafLoopId = requestAnimationFrame(loop);
  }
}
