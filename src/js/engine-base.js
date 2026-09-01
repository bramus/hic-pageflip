/**
 * Base Pageflip Engine (BaseEngine)
 * Shared state, viewport management, and coordinate mapping for 2D and 3D HTML-in-Canvas engines.
 */

export class BaseEngine {
  constructor(canvas, slides = []) {
    this.canvas = canvas;
    this.slides = slides;

    // Page dimensions (initialized from canvas attributes if present, updated dynamically via setDimensions)
    const attrPw = parseInt(this.canvas.getAttribute('data-pageflip-width') || this.canvas.dataset?.pageflipWidth, 10);
    const attrPh = parseInt(this.canvas.getAttribute('data-pageflip-height') || this.canvas.dataset?.pageflipHeight, 10);
    this.pw = attrPw || 1024;
    this.ph = attrPh || 768;
    this.devicePixelRatio = window.devicePixelRatio || 1;

    // Viewport transformations
    this.viewportWidth = this.pw;
    this.viewportHeight = this.ph;
    this.scale = 1;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.offsetX = this.pw / 2;
    this.offsetY = this.ph / 2;
  }

  updateDimensionsFromAttributes() {
    const pw = parseInt(this.canvas.getAttribute('data-pageflip-width') || this.canvas.dataset?.pageflipWidth, 10) || 1024;
    const ph = parseInt(this.canvas.getAttribute('data-pageflip-height') || this.canvas.dataset?.pageflipHeight, 10) || 768;
    this.pw = pw;
    this.ph = ph;
  }

  setDimensions(pw, ph) {
    this.pw = pw;
    this.ph = ph;
    this.resize();
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

  requestRender(callback) {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      if (callback) callback();
    });
  }

  clearCache() {}

  resize() {}

  render(state) {}
}
