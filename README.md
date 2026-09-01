# hic-pageflip

An interactive page flip book viewer built with the experimental **HTML-in-Canvas** web API.

> [!WARNING]
> **HTML-in-Canvas is experimental technology.**
> This project relies on experimental browser APIs (`<canvas layoutsubtree>`, `ctx.drawElementImage`, `gl.texElementImage2D`, and `canvas.updateElementGeometry`) currently being developed in Chromium. Features and API surfaces are subject to change.

---

## Overview

`hic-pageflip` allows you to render interactive, flip-book style page presentations where every page is composed of **real, accessible DOM elements** (with selectable text, live links, CSS animations, and rich markup), while being deformed and rendered through high-performance 2D Canvas or 3D WebGL deformation pipelines.

---

## Prerequisites

To view and interact with `hic-pageflip`, you need a browser that supports the **HTML-in-Canvas** API (e.g. Chrome Canary):

1. **Browser**: Google Chrome Canary (v134+ recommended).
2. **Flag**: Enable `chrome://flags/#enable-experimental-web-platform-features` or launch with:
   ```bash
   google-chrome-canary --enable-blink-features=HTMLInCanvas
   ```
3. **APIs required**:
   - `<canvas layoutsubtree>` element attribute.
   - `CanvasRenderingContext2D.prototype.drawElementImage` (for 2D engine).
   - `WebGLRenderingContext.prototype.texElementImage2D` (for 3D engine).
   - `HTMLCanvasElement.prototype.updateElementGeometry` (for DOM hit-testing alignment).

---

## Rendering Engines

`hic-pageflip` comes equipped with two distinct rendering engines that can be switched dynamically at runtime via the `engine` attribute or property:

### 1. 2D Engine (`engine="2d"`)
- **Class**: [`HICPageflipEngine2D`](src/js/hic-pageflip/core/engines/engine-2d.js)
- **Technology**: 2D Canvas context with direct DOM element drawing via `ctx.drawElementImage()`.
- **Techniques**:
  - **Geometric Fold Clipping**: Uses half-plane clipping (`clipHalfPlane`) to separate the stationary spread, underneath revealed pages, and turning flap.
  - **Affine Reflection**: Performs 2D affine matrix reflection across the dynamic fold crease line.
  - **Dynamic Lighting**: Renders drop shadows cast under the fold crease and spine gutter shadows.
  - **Pre-warmed Paint Records**: Pre-warms slide paint records to eliminate unstyled content flashing during initial corner peeks.

### 2. 3D Engine (`engine="3d"`)
- **Class**: [`HICPageflipEngine3D`](src/js/hic-pageflip/core/engines/engine-3d.js)
- **Technology**: WebGL / WebGL2 context capturing live DOM nodes to GPU textures via `gl.texElementImage2D()`.
- **Techniques**:
  - **Chris Luke's Page Curl Algorithm**: Complete GLSL vertex shader implementation based on [*The Anatomy of a Page Curl*](https://blog.flirble.org/2010/10/08/the-anatomy-of-a-page-curl/).
  - **Cylindrical & Conical Deformation**: Dynamically transitions between a uniform cylinder (for horizontal flips) and a tapered cone (for diagonal corner pulls), keeping the fold apex anchored to the page edge without bulging.
  - **Hardware Dual-Sided Texturing**: Shaders sample front (`uSamplerFront`) and back (`uSamplerBack`) textures in a single draw pass using `gl_FrontFacing`.
  - **Z-Fighting Prevention**: Employs sub-pixel depth offsetting (`uDepthOffset`) to eliminate z-fighting between overlapping sheets.

---

## Component API & Usage

### Declarative Markup

```html
<script type="module" src="./js/hic-pageflip/index.js"></script>

<hic-pageflip engine="3d" page-width="1024" page-height="768" page-background="#ffffff">
  <!-- Slide 1: Cover (Right Desk) -->
  <hic-pageflip-page>
    <div class="content">
      <h1>Cover Page</h1>
      <p>This is live HTML inside a 3D WebGL pageflip!</p>
    </div>
  </hic-pageflip-page>

  <!-- Slide 2: Left Desk -->
  <hic-pageflip-page>
    <div class="content">
      <h2>Inside Left Page</h2>
      <p>Selectable text and clickable <a href="#test">links</a> work natively.</p>
    </div>
  </hic-pageflip-page>

  <!-- Slide 3: Right Desk -->
  <hic-pageflip-page>
    <div class="content">
      <h2>Inside Right Page</h2>
    </div>
  </hic-pageflip-page>
</hic-pageflip>
```

### Attributes & Properties

| Attribute | Property | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `engine` | `engine` / `engineMode` | `string` | `'2d'` | Rendering engine mode: `'2d'` or `'3d'`. |
| `page-width` | `pageWidth` | `number` | `1024` | Width of a single page in CSS pixels. |
| `page-height` | `pageHeight` | `number` | `768` | Height of a single page in CSS pixels. |
| `page-background` | `pageBackground` | `string` | `'white'` | Background color/fill applied to each page sheet. |
| `page` | `page` / `currentPage` | `number` | `0` | Current page index (0 = Cover / Spread [0, 1]). |

### Methods

```javascript
const flipbook = document.querySelector('hic-pageflip');

// Navigate forwards by one spread
flipbook.flipForward();

// Navigate backwards by one spread
flipbook.flipBackward();

// Jump to a specific page number
flipbook.gotoPage(4);

// Switch rendering engine
flipbook.engine = '3d'; // or '2d'

// Reload textures from DOM
flipbook.reloadTextures();
```

### Events

- **`pagechange`**: Fired when the active spread changes upon completing a flip.
  ```javascript
  flipbook.addEventListener('pagechange', (e) => {
    console.log('Current page:', e.detail.currentPage);
    console.log('Current spread:', e.detail.currentSpread); // e.g. [2, 3]
  });
  ```
- **`flipprogress`**: Fired continuously during drag or transition animation ticks with progress data.

---

## Folder Structure

```
pageflip/
├── package.json
├── README.md
└── src/
    ├── index.html              # Demo shell, UI buttons, and slides markup
    ├── css/
    │   ├── app.css             # UI theme, layout, timeline styles
    │   └── presentation.css    # Typography, slide content, slide designs
    └── js/
        ├── app.js              # Application entry point & demo UI controller
        └── hic-pageflip/       # Core package
            ├── index.js        # Main entry point exporting Custom Elements
            ├── components/
            │   ├── hic-pageflip.js       # <hic-pageflip> Web Component
            │   └── hic-pageflip-page.js  # <hic-pageflip-page> Web Component
            └── core/
                ├── pageflip.js           # Core Pageflip state machine & gestures
                ├── engines/
                │   ├── engine-base.js    # BaseEngine abstract base class
                │   ├── engine-2d.js      # HICPageflipEngine2D (2D Canvas)
                │   └── engine-3d.js      # HICPageflipEngine3D (3D WebGL)
                └── utils/
                    └── math.js           # Fold math, easing curves, constraints
```

---

## Class Inheritance & Architecture Structure

```mermaid
classDiagram
    direction TB

    class HTMLElement {
        <<browser>>
    }

    class HICPageflip {
        +canvas: HTMLCanvasElement
        +pageflip: Pageflip
        +engineMode: string
        +flipForward()
        +flipBackward()
        +gotoPage(n)
        +switchEngine(mode)
    }

    class HICPageflipPage {
        +pageNum: number
    }

    class Pageflip {
        +engine: BaseEngine
        +activeFlip: object
        +currentPage: number
        +currentSpread: number[]
        +handlePaint()
        +startCornerPeek(corner)
        +startDrag(x, y)
        +flipForward()
        +flipBackward()
        +render()
    }

    class BaseEngine {
        <<abstract>>
        +canvas: HTMLCanvasElement
        +slides: object[]
        +render(state)*
        +resize()*
        +destroy()*
    }

    class HICPageflipEngine2D {
        +ctx: CanvasRenderingContext2D
        +renderPages(ctx, state)
        +clipHalfPlane(ctx, fold, onDragSide)
        +drawFoldUnderShadow()
        +warmupSlidePaintRecords()
    }

    class HICPageflipEngine3D {
        +gl: WebGLRenderingContext
        +program: WebGLProgram
        +meshBuffers: object
        +drawTurningSheet(front, back, side, flip)
        +drawDoubleSidedPage(front, back, side, isActive, cyl)
        +rasterizeSlideToTexture(slide)
    }

    HTMLElement <|-- HICPageflip
    HTMLElement <|-- HICPageflipPage
    HICPageflip *-- Pageflip : contains
    HICPageflip o-- HICPageflipPage : slots light DOM
    Pageflip *-- BaseEngine : delegates rendering to
    BaseEngine <|-- HICPageflipEngine2D : implements
    BaseEngine <|-- HICPageflipEngine3D : implements
```

### Architectural Highlights

1. **Shadow DOM & Layout Subtree**:
   `<hic-pageflip>` encapsulates the rendering canvas in its Shadow Root using `<canvas layoutsubtree><slot></slot></canvas>`. This projects light-DOM `<hic-pageflip-page>` elements directly into the browser's canvas layout subtree without manual DOM relocation.
2. **Engine Decoupling**:
   `Pageflip` acts as an engine-agnostic controller managing gesture coordinates, timeline animations, paper constraint math (`constrainPaper`), and page state. It delegates painting to whichever `BaseEngine` implementation is currently active.
3. **Pluggable Engine Hierarchy**:
   Both `HICPageflipEngine2D` and `HICPageflipEngine3D` extend `BaseEngine` and implement a unified interface (`render`, `resize`, `setDimensions`, `destroy`), allowing seamless hot-switching between 2D and 3D rendering modes on the fly.

---

## Development

### Install & Run Locally

```bash
# Start local development server on port 3000
npm start
```

Open Chrome Canary at `http://localhost:3000`.

### Deploy to Production

```bash
npm run deploy
```

---

## References

- [The Anatomy of a Page Curl by Chris Luke](https://blog.flirble.org/2010/10/08/the-anatomy-of-a-page-curl/)
- [Chrome HTML-in-Canvas Documentation](https://developer.chrome.com/blog/html-in-canvas-origin-trial)

---

## License

[MIT](LICENSE) © [Bramus Van Damme](https://www.bram.us)
