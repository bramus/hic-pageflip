/**
 * High-DPI Canvas 2D Flipbook Renderer.
 * Implements precise geometric fold clipping, affine reflection matrices,
 * fold drop shadows, spine shadows, and 100% color-accurate slide rendering.
 */

import { calculateFold, clamp } from './math.js';

export class FlipbookRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    this.images = new Map(); // pageNum -> HTMLImageElement
    this.loading = new Set();
    this.devicePixelRatio = window.devicePixelRatio || 1;

    // Viewport transform
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;

    // Book dimensions
    this.pw = 1024;
    this.ph = 768;
    this.bookMode = 'spread';

    // Theme
    this.theme = 'slate';
  }

  setDimensions(pw, ph) {
    this.pw = pw;
    this.ph = ph;
  }

  clearCache() {
    this.images.clear();
    this.loading.clear();
  }

  preloadImage(pageNum, url) {
    if (this.images.has(pageNum) || this.loading.has(pageNum)) return;
    this.loading.add(pageNum);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    img.onload = () => {
      this.images.set(pageNum, img);
      this.loading.delete(pageNum);
      this.requestRender();
    };
    img.onerror = () => {
      this.loading.delete(pageNum);
    };
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.devicePixelRatio = dpr;

    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    // Compute fit scale
    const availW = rect.width * 0.92;
    const availH = rect.height * 0.88;
    const totalBookW = this.pw * 2;
    const totalBookH = this.ph;

    const scaleX = availW / totalBookW;
    const scaleY = availH / totalBookH;
    this.scale = Math.min(scaleX, scaleY, 1.25);

    this.offsetX = rect.width / 2;
    this.offsetY = rect.height / 2;
  }

  requestRender(callback) {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      if (callback) callback();
    });
  }

  /**
   * Main render loop
   */
  render(state) {
    const ctx = this.ctx;
    const dpr = this.devicePixelRatio;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Apply main viewport transformations (center + zoom + pan)
    ctx.translate(this.offsetX + this.panX, this.offsetY + this.panY);
    ctx.scale(this.scale * this.zoom, this.scale * this.zoom);

    // 1. Ambient shadow of the physical book block resting on the desk
    this.renderBookShadow(ctx, state);

    // 2. Render book pages, stationary gutter shadows, and turning flap on top
    this.renderPages(ctx, state);

    ctx.restore();
  }

  /**
   * Ambient shadow of the physical book resting on the desk surface.
   * On the cover (left = 0), the book body only exists on the right side [0, pw].
   */
  renderBookShadow(ctx, state) {
    const pw = this.pw;
    const ph = this.ph;
    const [leftPageNum, rightPageNum] = state.currentSpread;
    const flip = state.activeFlip;

    let leftX = leftPageNum === 0 ? 0 : -pw;
    let rightX = rightPageNum > state.totalPages ? 0 : pw;

    if (flip) {
      if (flip.dir < 0 && leftPageNum - 2 <= 0) {
        // Turning page 2 back to reveal empty desk on left
        leftX = 0;
      }
      if (flip.dir > 0 && rightPageNum + 2 > state.totalPages) {
        // Turning last right page to reveal empty desk on right
        rightX = 0;
      }
    }

    const bookW = rightX - leftX;
    if (bookW <= 0) return;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 38 * this.scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 16 * this.scale;

    ctx.fillStyle = '#12141a';
    ctx.fillRect(leftX, -ph / 2, bookW, ph);
    ctx.restore();
  }

  /**
   * Renders pages and dynamic page curl
   */
  renderPages(ctx, state) {
    const pw = this.pw;
    const ph = this.ph;
    const [leftPageNum, rightPageNum] = state.currentSpread;
    const flip = state.activeFlip;

    if (!flip) {
      // Static double-page spread
      if (leftPageNum > 0) {
        this.drawPage(ctx, leftPageNum, -pw, -ph / 2, pw, ph);
      }
      if (rightPageNum <= state.totalPages) {
        this.drawPage(ctx, rightPageNum, 0, -ph / 2, pw, ph);
      }
      // Gutter shadow between the two stationary pages
      if (leftPageNum > 0 && rightPageNum <= state.totalPages) {
        this.renderSpineShadow(ctx, state);
      }
      return;
    }

    const fold = calculateFold(flip.px, flip.py, flip.sx, flip.sy, pw, ph);

    if (flip.dir > 0) {
      // ==========================================
      // FORWARD FLIP: Right page turning to Left
      // ==========================================

      // 1. Current left page stays visible on the left desk
      if (leftPageNum > 0) {
        this.drawPage(ctx, leftPageNum, -pw, -ph / 2, pw, ph);
      }

      // 2. Underneath right page (Page N+2) revealed as page is peeled back
      const nextRightPage = rightPageNum + 2;
      if (nextRightPage <= state.totalPages) {
        this.drawPage(ctx, nextRightPage, 0, -ph / 2, pw, ph);
      }

      if (!fold) {
        if (rightPageNum <= state.totalPages) {
          this.drawPage(ctx, rightPageNum, 0, -ph / 2, pw, ph);
        }
        if (leftPageNum > 0) {
          this.renderSpineShadow(ctx, state);
        }
        return;
      }

      // 3. Drop shadow cast by the fold crease onto the revealed page underneath
      if (nextRightPage <= state.totalPages) {
        this.drawFoldUnderShadow(ctx, fold, 0, -ph / 2, pw, ph);
      }

      // 4. Flat unpeeled portion of Page N (contains spine: onDragSide = true)
      if (rightPageNum <= state.totalPages) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, -ph / 2, pw, ph);
        ctx.clip();
        ctx.beginPath();
        this.clipHalfPlane(ctx, fold, true);
        ctx.clip();
        this.drawPage(ctx, rightPageNum, 0, -ph / 2, pw, ph);
        ctx.restore();
      }

      // 5. Gutter spine shadow on the flat stationary spread UNDER the turning flap
      if (leftPageNum > 0 && rightPageNum <= state.totalPages) {
        this.renderSpineShadow(ctx, state);
      }

      // 6. The Turning Flap (Back of turning page = Page N+1) rendered ON TOP
      const backPageNum = rightPageNum + 1;
      const theta = Math.atan2(fold.ny, fold.nx);

      ctx.save();
      // Clip to the dragged side of the fold (side containing P: onDragSide = true)
      ctx.beginPath();
      this.clipHalfPlane(ctx, fold, true);
      ctx.clip();

      // Apply reflection transformation across the fold crease line
      ctx.translate(fold.cx, fold.cy);
      ctx.rotate(theta);
      ctx.scale(-1, 1);
      ctx.rotate(-theta);
      ctx.translate(-fold.cx, -fold.cy);

      // Clip to the original right sheet boundary [0, -ph/2, pw, ph]
      ctx.beginPath();
      ctx.rect(0, -ph / 2, pw, ph);
      ctx.clip();

      // Draw Page N+1 with 100% color fidelity on top of everything
      this.drawPageBack(ctx, backPageNum, 0, -ph / 2, pw, ph);
      ctx.restore();

    } else {
      // ==========================================
      // BACKWARD FLIP: Left page turning to Right
      // ==========================================

      // 1. Current right page stays visible on the right desk
      if (rightPageNum <= state.totalPages) {
        this.drawPage(ctx, rightPageNum, 0, -ph / 2, pw, ph);
      }

      // 2. Underneath left page (Page N-3) revealed as left page is peeled back
      const prevLeftPage = leftPageNum - 2;
      if (prevLeftPage > 0) {
        this.drawPage(ctx, prevLeftPage, -pw, -ph / 2, pw, ph);
      }

      if (!fold) {
        if (leftPageNum > 0) {
          this.drawPage(ctx, leftPageNum, -pw, -ph / 2, pw, ph);
        }
        if (leftPageNum > 0 && rightPageNum <= state.totalPages) {
          this.renderSpineShadow(ctx, state);
        }
        return;
      }

      // 3. Drop shadow cast by fold crease onto revealed page underneath
      if (prevLeftPage > 0) {
        this.drawFoldUnderShadow(ctx, fold, -pw, -ph / 2, pw, ph);
      }

      // 4. Flat unpeeled portion of Page N-1 (contains spine: onDragSide = true)
      if (leftPageNum > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(-pw, -ph / 2, pw, ph);
        ctx.clip();
        ctx.beginPath();
        this.clipHalfPlane(ctx, fold, true);
        ctx.clip();
        this.drawPage(ctx, leftPageNum, -pw, -ph / 2, pw, ph);
        ctx.restore();
      }

      // 5. Gutter spine shadow on the flat stationary spread UNDER the turning flap
      if (leftPageNum > 0 && rightPageNum <= state.totalPages) {
        this.renderSpineShadow(ctx, state);
      }

      // 6. The Turning Flap (Front of left sheet = Page N-1) rendered ON TOP
      const frontPageNum = leftPageNum - 1;
      const theta = Math.atan2(fold.ny, fold.nx);

      ctx.save();
      // Clip to the dragged side of the fold (side containing P: onDragSide = true)
      ctx.beginPath();
      this.clipHalfPlane(ctx, fold, true);
      ctx.clip();

      // Apply reflection transformation across the fold crease line
      ctx.translate(fold.cx, fold.cy);
      ctx.rotate(theta);
      ctx.scale(-1, 1);
      ctx.rotate(-theta);
      ctx.translate(-fold.cx, -fold.cy);

      // Clip to the left sheet boundary [-pw, -ph/2, pw, ph]
      ctx.beginPath();
      ctx.rect(-pw, -ph / 2, pw, ph);
      ctx.clip();

      // Draw Page N-1 with 100% color fidelity on top of everything
      this.drawPageFrontReflected(ctx, frontPageNum, -pw, -ph / 2, pw, ph);
      ctx.restore();
    }
  }

  /**
   * Clips to one half of the plane divided by the fold crease line.
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} fold
   * @param {boolean} onDragSide - true for dragged corner/spine side (P), false for peeled corner side (S)
   */
  clipHalfPlane(ctx, fold, onDragSide) {
    const L = Math.max(this.pw, this.ph) * 6;
    const tx = -fold.ny;
    const ty = fold.nx;
    const sign = onDragSide ? 1 : -1;
    const nx = fold.nx * sign;
    const ny = fold.ny * sign;

    const p1 = { x: fold.cx - tx * L, y: fold.cy - ty * L };
    const p2 = { x: fold.cx + tx * L, y: fold.cy + ty * L };
    const p3 = { x: p2.x + nx * L, y: p2.y + ny * L };
    const p4 = { x: p1.x + nx * L, y: p1.y + ny * L };

    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
  }

  /**
   * Soft drop shadow under the fold crease onto the revealed page underneath.
   */
  drawFoldUnderShadow(ctx, fold, rx, ry, rw, rh) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx, ry, rw, rh);
    ctx.clip();

    ctx.beginPath();
    this.clipHalfPlane(ctx, fold, false); // revealed area is on the S-side
    ctx.clip();

    const shadowWidth = clamp(fold.len * 0.16, 12, 45);
    const grad = ctx.createLinearGradient(
      fold.cx,
      fold.cy,
      fold.cx - fold.nx * shadowWidth,
      fold.cy - fold.ny * shadowWidth
    );
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
    grad.addColorStop(0.35, 'rgba(0, 0, 0, 0.14)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad;
    ctx.fillRect(rx - 20, ry - 20, rw + 40, rh + 40);
    ctx.restore();
  }

  /**
   * Draws a flat page image with 1:1 pixel color accuracy.
   */
  drawPage(ctx, pageNum, x, y, w, h) {
    const img = this.images.get(pageNum);

    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, x, y, w, h);
    } else {
      this.drawLoadingPage(ctx, pageNum, x, y, w, h);
    }
  }

  /**
   * Draws the backside of the turning page (Page N+1) onto the sheet [0, -ph/2, pw, ph].
   * The back of the page is horizontally flipped so that after the fold reflection,
   * it appears correctly oriented and right-reading.
   */
  drawPageBack(ctx, pageNum, x, y, w, h) {
    const img = this.images.get(pageNum);

    if (img && img.complete && img.naturalWidth > 0) {
      ctx.save();
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, w, h);
      ctx.restore();
    } else {
      this.drawLoadingPage(ctx, pageNum, x, y, w, h);
    }
  }

  /**
   * Draws the front of the turning left page reflected onto the right side.
   */
  drawPageFrontReflected(ctx, pageNum, x, y, w, h) {
    const img = this.images.get(pageNum);

    if (img && img.complete && img.naturalWidth > 0) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(-1, 1);
      ctx.translate(-w, 0);
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, w, h);
      ctx.restore();
    } else {
      this.drawLoadingPage(ctx, pageNum, x, y, w, h);
    }
  }

  drawBlankPage(ctx, x, y, w, h) {
    ctx.save();
    ctx.fillStyle = '#171920';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  drawLoadingPage(ctx, pageNum, x, y, w, h) {
    ctx.save();
    ctx.fillStyle = '#1c1f26';
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = '#5a6275';
    ctx.font = `600 ${Math.round(22 * this.scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Page ${pageNum}`, x + w / 2, y + h / 2 - 12);

    ctx.font = `400 ${Math.round(13 * this.scale)}px sans-serif`;
    ctx.fillStyle = '#7a859c';
    ctx.fillText('Loading slide...', x + w / 2, y + h / 2 + 16);
    ctx.restore();
  }

  /**
   * Center spine crease shadow on the flat spread between stationary pages.
   */
  renderSpineShadow(ctx, state) {
    const ph = this.ph;
    const spineWidth = 32;
    const [leftPageNum, rightPageNum] = state.currentSpread;

    ctx.save();
    // Left side of spine (only if left page exists on the desk)
    if (leftPageNum > 0) {
      const leftGrad = ctx.createLinearGradient(-spineWidth, 0, 0, 0);
      leftGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      leftGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0.14)');
      leftGrad.addColorStop(1, 'rgba(0, 0, 0, 0.38)');
      ctx.fillStyle = leftGrad;
      ctx.fillRect(-spineWidth, -ph / 2, spineWidth, ph);
    }

    // Right side of spine (only if right page exists on the desk)
    if (rightPageNum <= state.totalPages) {
      const rightGrad = ctx.createLinearGradient(0, 0, spineWidth, 0);
      rightGrad.addColorStop(0, 'rgba(0, 0, 0, 0.38)');
      rightGrad.addColorStop(0.3, 'rgba(0, 0, 0, 0.14)');
      rightGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = rightGrad;
      ctx.fillRect(0, -ph / 2, spineWidth, ph);
    }

    // Fine center line (only if both pages exist on desk)
    if (leftPageNum > 0 && rightPageNum <= state.totalPages) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -ph / 2);
      ctx.lineTo(0, ph / 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  screenToBook(screenX, screenY) {
    const relX = screenX - (this.offsetX + this.panX);
    const relY = screenY - (this.offsetY + this.panY);
    const scale = this.scale * this.zoom;
    return {
      x: relX / scale,
      y: relY / scale
    };
  }

  bookToScreen(bookX, bookY) {
    const scale = this.scale * this.zoom;
    return {
      x: (bookX * scale) + this.offsetX + this.panX,
      y: (bookY * scale) + this.offsetY + this.panY
    };
  }
}
