/**
 * Thumbnails Grid & Bottom Scrubbable Timeline.
 */

export class ThumbnailsManager {
  constructor(gridContainer, timelineContainer, flipbook) {
    this.gridContainer = gridContainer;
    this.timelineContainer = timelineContainer;
    this.flipbook = flipbook;

    this.isOpen = false;
    this.thumbnails = [];
  }

  build(bookMeta) {
    this.gridContainer.innerHTML = '';
    this.thumbnails = [];

    const pageCount = bookMeta.pageCount || 25;
    const bookId = bookMeta.id;

    for (let i = 1; i <= pageCount; i++) {
      const pageStr = String(i).padStart(2, '0');
      const thumbUrl = `books/${bookId}/${pageStr}.png`;

      const card = document.createElement('div');
      card.className = 'thumb-card';
      card.dataset.page = i;

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = thumbUrl;
      img.alt = `Page ${i}`;

      const label = document.createElement('div');
      label.className = 'thumb-label';
      label.textContent = `${i}`;

      card.appendChild(img);
      card.appendChild(label);

      card.addEventListener('click', () => {
        this.flipbook.gotoPage(i);
        this.closeDrawer();
      });

      this.gridContainer.appendChild(card);
      this.thumbnails.push({ page: i, el: card });
    }
  }

  updateActive(state) {
    const [left, right] = state.currentSpread;

    for (const thumb of this.thumbnails) {
      if (thumb.page === left || thumb.page === right) {
        thumb.el.classList.add('active');
        if (this.isOpen) {
          thumb.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } else {
        thumb.el.classList.remove('active');
      }
    }
  }

  toggleDrawer() {
    this.isOpen = !this.isOpen;
    return this.isOpen;
  }

  closeDrawer() {
    this.isOpen = false;
    const drawerEl = document.getElementById('thumbnails-drawer');
    if (drawerEl) {
      drawerEl.classList.remove('open');
    }
  }
}
