/**
 * Interactive Overlays for PDF Links and Search Highlights.
 */

export class BookOverlay {
  constructor(container, renderer, flipbook) {
    this.container = container;
    this.renderer = renderer;
    this.flipbook = flipbook;

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'book-overlay-layer';
    this.container.appendChild(this.overlayEl);

    this.links = [];
    this.activeSearchMatches = [];
  }

  update(state) {
    // Only show clickable link overlays when book is not currently in an active animated flip
    if (state.activeFlip && !state.activeFlip.isPeek) {
      this.overlayEl.style.display = 'none';
      return;
    }
    this.overlayEl.style.display = 'block';
    this.overlayEl.innerHTML = '';

    const data = this.flipbook.bookData;
    if (!data) return;

    const [leftPage, rightPage] = state.currentSpread;

    if (leftPage > 0) {
      this.renderPageLinks(leftPage, -this.renderer.pw, -this.renderer.ph / 2, this.renderer.pw, this.renderer.ph);
    }
    if (rightPage <= state.totalPages) {
      this.renderPageLinks(rightPage, 0, -this.renderer.ph / 2, this.renderer.pw, this.renderer.ph);
    }
  }

  renderPageLinks(pageNum, bookX, bookY, pw, ph) {
    const data = this.flipbook.bookData;
    if (!data) return;

    const pageData = data.find((d) => d.page === pageNum);
    if (!pageData || !pageData.links || !Array.isArray(pageData.links)) return;

    const viewW = pageData.view ? pageData.view[2] : pw;
    const viewH = pageData.view ? pageData.view[3] : ph;

    for (const link of pageData.links) {
      if (!link.url || !link.rect) continue;

      const [rx1, ry1, rx2, ry2] = link.rect;

      // Normalize PDF coordinate system to page space
      const normX = rx1 / viewW;
      const normW = (rx2 - rx1) / viewW;

      // In PDF coordinate space, Y=0 is often at the bottom
      const isBottomOrigin = ry2 > ry1 && ry2 <= viewH;
      const normY = isBottomOrigin ? (viewH - ry2) / viewH : ry1 / viewH;
      const normH = Math.abs(ry2 - ry1) / viewH;

      const linkBookX = bookX + normX * pw;
      const linkBookY = bookY + normY * ph;
      const linkBookW = normW * pw;
      const linkBookH = normH * ph;

      const screenTopLeft = this.renderer.bookToScreen(linkBookX, linkBookY);
      const screenBotRight = this.renderer.bookToScreen(linkBookX + linkBookW, linkBookY + linkBookH);

      const linkEl = document.createElement('a');
      linkEl.className = 'book-interactive-link';
      linkEl.href = link.url;
      linkEl.target = '_blank';
      linkEl.rel = 'noopener noreferrer';
      linkEl.title = `Open link: ${link.url}`;

      const linkW = Math.max(12, screenBotRight.x - screenTopLeft.x);
      const linkH = Math.max(12, screenBotRight.y - screenTopLeft.y);

      linkEl.style.left = `${screenTopLeft.x}px`;
      linkEl.style.top = `${screenTopLeft.y}px`;
      linkEl.style.width = `${linkW}px`;
      linkEl.style.height = `${linkH}px`;

      this.overlayEl.appendChild(linkEl);
    }
  }

  /**
   * Search through all book text and return matches with page numbers and text snippets
   */
  search(query) {
    if (!query || query.trim().length < 2) {
      this.activeSearchMatches = [];
      return [];
    }

    const clean = query.trim().toLowerCase();
    const data = this.flipbook.bookData;
    if (!data) return [];

    const results = [];

    for (const page of data) {
      if (!page.text || !Array.isArray(page.text)) continue;

      const fullPageText = page.text.map((t) => t.str).join(' ');
      if (fullPageText.toLowerCase().includes(clean)) {
        // Extract snippet
        const idx = fullPageText.toLowerCase().indexOf(clean);
        const start = Math.max(0, idx - 30);
        const end = Math.min(fullPageText.length, idx + clean.length + 40);
        const snippet = (start > 0 ? '...' : '') + fullPageText.substring(start, end) + (end < fullPageText.length ? '...' : '');

        results.push({
          page: page.page,
          snippet,
          fullText: fullPageText
        });
      }
    }

    this.activeSearchMatches = results;
    return results;
  }
}
