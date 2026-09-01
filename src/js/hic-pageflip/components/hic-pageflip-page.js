/**
 * <hic-pageflip-page> Custom Element Web Component.
 * Represents an individual page slide within <hic-pageflip>.
 * Renders slotted content on a standardized pageflip page surface.
 */

const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

const templateHTML = `
  <style>
    :host {
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
      height: var(--pageflip-height);
      width: var(--pageflip-width);
      overflow: hidden;
      box-sizing: border-box;
      user-select: text;
      -webkit-user-select: text;
      background: var(--pageflip-background);
    }
  </style>
  <slot></slot>
`;

export class HICPageflipPage extends BaseElement {
  constructor() {
    super();

    if (typeof HTMLElement !== 'undefined' && this.attachShadow) {
      this.attachShadow({ mode: 'open' });
      const template = document.createElement('template');
      template.innerHTML = templateHTML;
      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }
  }
}
