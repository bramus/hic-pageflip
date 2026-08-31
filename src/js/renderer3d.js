/**
 * 3D WebGL Flipbook Renderer
 * Complete implementation based on Chris Luke's "The Anatomy of a Page Curl":
 * https://blog.flirble.org/2010/10/08/the-anatomy-of-a-page-curl/
 */

export class WebGLFlipbookRenderer {
  constructor(canvas, slidesOrBook = []) {
    this.canvas = canvas;
    this.slides = slidesOrBook;
    this.gl = null;
    this.program = null;

    // Page dimensions (initialized from canvas attributes if present, updated dynamically via setDimensions)
    const attrPw = parseInt(this.canvas.getAttribute('data-pageflip-width') || this.canvas.dataset?.pageflipWidth, 10);
    const attrPh = parseInt(this.canvas.getAttribute('data-pageflip-height') || this.canvas.dataset?.pageflipHeight, 10);
    this.pw = attrPw || 1024;
    this.ph = attrPh || 768;
    this.devicePixelRatio = window.devicePixelRatio || 1;

    // Viewport transformations (updated dynamically on resize)
    this.viewportWidth = this.pw;
    this.viewportHeight = this.ph;
    this.scale = 1;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.offsetX = this.pw / 2;
    this.offsetY = this.ph / 2;

    // Mesh resolution (Chris Luke cylinder grid)
    this.gridX = 80;
    this.gridY = 60;

    this.meshBuffers = null;
    this.textures = new Map();

    this.initGL();
    this.resize();
    if (this.slides) {
      this.slides.forEach((s) => {
        if (s.element) s.element.style.transform = 'none';
      });
    }
    this.preloadSlideTextures();
  }

  setDimensions(pw, ph) {
    this.pw = pw;
    this.ph = ph;
    this.resize();
    this.preloadSlideTextures();
  }

  initGL() {
    const glOpts = {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false
    };
    const gl = this.canvas.getContext('webgl2', glOpts) ||
               this.canvas.getContext('webgl', glOpts) ||
               this.canvas.getContext('experimental-webgl', glOpts);

    if (!gl) {
      console.error('WebGL is not supported in this browser.');
      return;
    }
    this.gl = gl;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);

    this.initShaders();
    this.initBuffers();
  }

  initShaders() {
    const gl = this.gl;

    // Vertex Shader: Chris Luke's Exact 3D Cylindrical Page Curl Algorithm
    const vsSource = `
      attribute vec2 aPosition; // [0, 1] UV coordinates on page sheet
      uniform mat4 uProjection;
      uniform mat4 uModelView;

      uniform vec2 uPageSize;   // (pw, ph)
      uniform float uPageSide;  // -1.0 for left page, 1.0 for right page
      uniform float uIsActive;  // 1.0 if curling, 0.0 if flat

      // Chris Luke's Cylindrical Parameters
      uniform float uTheta;     // Cylinder angle in x,y plane
      uniform vec2 uCylBase;    // (B, A) origin of cylinder base
      uniform float uC;         // Radius of cylinder C

      varying vec2 vUv;
      varying vec2 vBackUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      #define M_PI 3.14159265358979323846
      #define M_PI_2 1.57079632679489661923

      vec2 rot(vec2 pt, float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return vec2(pt.x * c - pt.y * s, pt.x * s + pt.y * c);
      }

      void main() {
        // Local page coordinates: vx in [0, pw], vy in [-ph/2, ph/2]
        float vx = aPosition.x * uPageSize.x;
        float vy = (aPosition.y - 0.5) * uPageSize.y;

        vec3 v1 = vec3(vx, vy, 0.0);
        vec3 norm = vec3(0.0, 0.0, 1.0);

        if (uIsActive > 0.5) {
          float A = uCylBase.y;
          float B = uCylBase.x;
          float C = uC;
          float theta = uTheta;

          float tanTheta = tan(theta);
          if (abs(tanTheta) < 0.0001) tanTheta = 0.0001 * sign(tanTheta);

          // 1. Work out starting X of the cylinder for this Y
          float sx = B + ((vy - A) / tanTheta);

          // 2. Amount of flat x-travel around cylinder
          float cx = (C * M_PI) * abs(sin(theta));
          if (cx < 0.001) cx = 0.001;

          // 3. How far round the cylinder we are
          float tx = clamp(vx - sx, 0.0, cx);

          // 4. Excess of x after the cylinder
          float xx = vx - (cx + sx);

          if (vx < sx) {
            // Region 1: Flat before cylinder (anchored at spine)
            v1.x = vx;
            v1.y = vy;
            v1.z = 0.0;
            norm = vec3(0.0, 0.0, 1.0);

          } else if (xx >= 0.0) {
            // Region 3: Flat after cylinder (the turned flap, rotated by 2*theta)
            float beta = M_PI;
            float dy = clamp(tan(M_PI_2 - theta), -2.0, 2.0);

            vec2 v0 = vec2(C * sin(beta), C * dy);
            vec2 vRot = rot(v0, theta - M_PI_2);
            vec2 excessRot = rot(vec2(xx, 0.0), theta * 2.0);

            v1.x = vRot.x + excessRot.x + sx;
            v1.y = vRot.y + excessRot.y + vy;
            v1.z = C * 2.0;
            norm = vec3(0.0, 0.0, -1.0);

          } else {
            // Region 2: Curl around cylinder
            float beta = (tx / cx) * M_PI;
            float dy = clamp(tan(M_PI_2 - theta) * (tx / cx), -2.0, 2.0);

            vec2 v0 = vec2(C * sin(beta), C * dy);
            vec2 vRot = rot(v0, theta - M_PI_2);

            v1.x = vRot.x + sx;
            v1.y = vRot.y + vy;
            v1.z = C * (1.0 - cos(beta));
            norm = vec3(-sin(beta) * cos(theta), -sin(beta) * sin(theta), cos(beta));
          }

          // If turning left page backward, reflect horizontally across spine
          if (uPageSide < 0.0) {
            v1.x = -v1.x;
            norm.x = -norm.x;
            vUv = vec2(1.0 - aPosition.x, aPosition.y);
            vBackUv = aPosition;
          } else {
            vUv = aPosition;
            vBackUv = vec2(1.0 - aPosition.x, aPosition.y);
          }

        } else if (uPageSide < 0.0) {
          // Stationary left page anchored at [-pw, 0]
          v1.x = -uPageSize.x + vx;
          vUv = aPosition;
          vBackUv = aPosition;
        } else {
          // Stationary right page anchored at [0, pw]
          vUv = aPosition;
          vBackUv = aPosition;
        }

        vNormal = normalize(norm);
        vWorldPos = v1;
        gl_Position = uProjection * uModelView * vec4(v1, 1.0);
      }
    `;

    // Fragment Shader: Hardware gl_FrontFacing Dual-Texture Shading
    const fsSource = `
      precision mediump float;

      uniform sampler2D uSamplerFront;
      uniform sampler2D uSamplerBack;
      uniform vec3 uLightDir;

      varying vec2 vUv;
      varying vec2 vBackUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      void main() {
        vec4 texColor;
        vec3 N;

        if (gl_FrontFacing) {
          // Front of sheet
          texColor = texture2D(uSamplerFront, vUv);
          N = normalize(vNormal);
        } else {
          // Underside of turned flap
          texColor = texture2D(uSamplerBack, vBackUv);
          N = normalize(-vNormal);
        }

        // Diffuse paper lighting
        vec3 L = normalize(uLightDir);
        float diff = clamp(dot(N, L), 0.0, 1.0) * 0.3 + 0.7;

        // Subtle specular paper sheen
        vec3 V = vec3(0.0, 0.0, 1.0);
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 32.0) * 0.05;

        gl_FragColor = vec4(texColor.rgb * diff + vec3(spec), texColor.a);
      }
    `;

    this.program = this.createProgram(vsSource, fsSource);
  }

  createShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  createProgram(vsSource, fsSource) {
    const gl = this.gl;
    const vs = this.createShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.createShader(gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }

  initBuffers() {
    const gl = this.gl;

    const positions = [];
    const indices = [];
    const gx = this.gridX;
    const gy = this.gridY;

    for (let j = 0; j <= gy; j++) {
      const v = j / gy;
      for (let i = 0; i <= gx; i++) {
        const u = i / gx;
        positions.push(u, v);
      }
    }

    for (let j = 0; j < gy; j++) {
      for (let i = 0; i < gx; i++) {
        const row1 = j * (gx + 1) + i;
        const row2 = (j + 1) * (gx + 1) + i;
        indices.push(row1, row2, row1 + 1);
        indices.push(row1 + 1, row2, row2 + 1);
      }
    }

    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    this.meshBuffers = {
      position: posBuffer,
      indexBuffer: indexBuffer,
      indexCount: indices.length
    };
  }

  preloadSlideTextures() {
    if (!this.slides || this.slides.length === 0) return;
    this.slides.forEach((slide) => {
      this.rasterizeSlideToTexture(slide);
    });

    if (document.fonts && typeof document.fonts.ready?.then === 'function') {
      document.fonts.ready.then(() => {
        this.slides.forEach((slide) => {
          this.rasterizeSlideToTexture(slide);
        });
      });
    }
  }

  rasterizeSlideToTexture(slide) {
    if (!this.gl || !slide || !slide.element) return;
    const pageNum = slide.pageNum;
    const gl = this.gl;
    const el = slide.element;

    let texture = this.textures.get(pageNum);
    if (!texture) {
      texture = gl.createTexture();
      this.textures.set(pageNum, texture);
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Direct HTML-in-Canvas WebGL capture via gl.texElementImage2D
    if (typeof gl.texElementImage2D === 'function') {
      const isWebGL2 = (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext);
      const internalFormat = isWebGL2 ? (gl.RGBA8 || gl.RGBA) : gl.RGBA;

      let captured = false;

      // 1. Signature A (3 args with validated internalFormat): (target, internalformat, element)
      if (!captured) {
        try {
          gl.texElementImage2D(gl.TEXTURE_2D, internalFormat, el);
          captured = true;
        } catch (e) {}
      }

      // 2. Signature B (6 args): (target, level, internalformat, format, type, element)
      if (!captured) {
        try {
          gl.texElementImage2D(gl.TEXTURE_2D, 0, internalFormat, gl.RGBA, gl.UNSIGNED_BYTE, el);
          captured = true;
        } catch (e) {}
      }

      // 3. Signature C (2 args): (target, element)
      if (!captured) {
        try {
          gl.texElementImage2D(gl.TEXTURE_2D, el);
          captured = true;
        } catch (e) {}
      }
    }

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.devicePixelRatio = window.devicePixelRatio || 1;

    const w = rect.width > 0 ? rect.width : (this.canvas.clientWidth || 1024);
    const h = rect.height > 0 ? rect.height : (this.canvas.clientHeight || 768);

    this.viewportWidth = w;
    this.viewportHeight = h;
    this.canvas.width = Math.round(w * this.devicePixelRatio);
    this.canvas.height = Math.round(h * this.devicePixelRatio);
    this.offsetX = w / 2;
    this.offsetY = h / 2;

    const pad = 40;
    const availW = Math.max(100, w - pad);
    const availH = Math.max(100, h - pad);
    const spreadW = this.pw * 2;
    const spreadH = this.ph;

    this.scale = Math.min(availW / spreadW, availH / spreadH, 1);
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;

    if (this.gl) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  updateDOMSlides(state) {
    if (!this.slides || this.slides.length === 0) return;

    const [leftPage, rightPage] = state.currentSpread;
    const totalPages = state.totalPages || this.slides.length;
    const scale = this.scale * this.zoom;

    // Only de-inert pages if resting (not dragging or flipping)
    const isInteracting = state.isDragging || (state.activeFlip && !state.activeFlip.isPeek);
    const activePages = new Set();
    if (!isInteracting) {
      if (leftPage > 0) activePages.add(leftPage);
      if (rightPage <= totalPages) activePages.add(rightPage);
    }

    if (this.isReloadingTextures) return;

    this.slides.forEach((s) => {
      if (!s.element) return;
      const isActive = activePages.has(s.pageNum);
      s.element.inert = !isActive;

      if (isActive) {
        const isLeft = (s.pageNum === leftPage);
        const bx = isLeft ? -this.pw : 0;
        const by = -this.ph / 2;
        const screenPt = this.bookToScreen(bx, by);

        if (typeof this.canvas.updateElementGeometry === 'function') {
          const matrix = new DOMMatrix()
            .translate(screenPt.x, screenPt.y)
            .scale(scale, scale);
          try {
            this.canvas.updateElementGeometry(s.element, matrix);
          } catch (e) {}
        } else {
          s.element.style.transform = `translate(${screenPt.x}px, ${screenPt.y}px) scale(${scale})`;
        }
      } else {
        if (typeof this.canvas.clearElementGeometry === 'function') {
          try {
            this.canvas.clearElementGeometry(s.element);
          } catch (e) {}
        } else {
          s.element.style.transform = `none`;
        }
      }
    });
  }

  render(state) {
    const gl = this.gl;
    if (!gl || !this.program) return;

    this.updateDOMSlides(state);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.program);

    const halfW = Math.max(50, this.viewportWidth / 2);
    const halfH = Math.max(50, this.viewportHeight / 2);
    const projMat = this.createOrthoMatrix(-halfW, halfW, halfH, -halfH, -2000, 2000);

    const mvMat = this.createIdentityMatrix();
    const effectiveScale = this.scale * this.zoom;
    this.scaleMatrix(mvMat, effectiveScale, effectiveScale, 1.0);
    this.translateMatrix(mvMat, this.panX, this.panY, 0.0);

    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'uProjection'), false, projMat);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'uModelView'), false, mvMat);
    gl.uniform2f(gl.getUniformLocation(this.program, 'uPageSize'), this.pw, this.ph);
    gl.uniform3f(gl.getUniformLocation(this.program, 'uLightDir'), 0.35, -0.45, 0.82);

    const [leftPage, rightPage] = state.currentSpread;
    const flip = state.activeFlip;

    if (!flip) {
      // Stationary double spread
      if (leftPage > 0) {
        this.drawDoubleSidedPage(leftPage, leftPage, -1.0, 0.0, null);
      }
      if (rightPage <= state.totalPages) {
        this.drawDoubleSidedPage(rightPage, rightPage, 1.0, 0.0, null);
      }
      return;
    }

    // Active 3D Flip
    if (flip.dir > 0) {
      // 1. Stationary Left Page (N-1)
      if (leftPage > 0) {
        this.drawDoubleSidedPage(leftPage, leftPage, -1.0, 0.0, null);
      }
      // 2. Underneath Page (N+2) revealed as page N turns
      if (rightPage + 2 <= state.totalPages) {
        this.drawDoubleSidedPage(rightPage + 2, rightPage + 2, 1.0, 0.0, null);
      }
      // 3. Turning Sheet (Front = N, Back = N+1)
      this.drawTurningSheet(rightPage, rightPage + 1, 1.0, flip);
    } else {
      // 1. Stationary Right Page (N)
      if (rightPage <= state.totalPages) {
        this.drawDoubleSidedPage(rightPage, rightPage, 1.0, 0.0, null);
      }
      // 2. Underneath Page (N-2) revealed as page N-1 turns back
      if (leftPage - 2 > 0) {
        this.drawDoubleSidedPage(leftPage - 2, leftPage - 2, -1.0, 0.0, null);
      }
      // 3. Turning Sheet (Front = N-1, Back = N)
      this.drawTurningSheet(leftPage, leftPage - 1, -1.0, flip);
    }
  }

  getTexture(pageNum) {
    if (pageNum <= 0 || pageNum > this.slides.length) return null;
    let tex = this.textures.get(pageNum);
    if (!tex) {
      const slide = this.slides[pageNum - 1];
      if (slide) this.rasterizeSlideToTexture(slide);
      tex = this.textures.get(pageNum);
    }
    return tex;
  }

  drawDoubleSidedPage(frontPageNum, backPageNum, pageSide, isActive, cylInfo) {
    const gl = this.gl;
    const texFront = this.getTexture(frontPageNum);
    const texBack = this.getTexture(backPageNum) || texFront;
    if (!texFront) return;

    // Unit 0 = Front texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texFront);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uSamplerFront'), 0);

    // Unit 1 = Back texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texBack);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uSamplerBack'), 1);

    gl.uniform1f(gl.getUniformLocation(this.program, 'uPageSide'), pageSide);
    gl.uniform1f(gl.getUniformLocation(this.program, 'uIsActive'), isActive);

    if (cylInfo) {
      gl.uniform1f(gl.getUniformLocation(this.program, 'uTheta'), cylInfo.theta);
      gl.uniform2f(gl.getUniformLocation(this.program, 'uCylBase'), cylInfo.B, cylInfo.A);
      gl.uniform1f(gl.getUniformLocation(this.program, 'uC'), cylInfo.C);
    } else {
      gl.uniform1f(gl.getUniformLocation(this.program, 'uTheta'), Math.PI / 2);
      gl.uniform2f(gl.getUniformLocation(this.program, 'uCylBase'), 0.0, 0.0);
      gl.uniform1f(gl.getUniformLocation(this.program, 'uC'), 24.0);
    }

    // Set winding order for mirrored left-page flips and restore
    if (pageSide < 0.0 && isActive > 0.5) {
      gl.frontFace(gl.CW);
    } else {
      gl.frontFace(gl.CCW);
    }

    const aPosLoc = gl.getAttribLocation(this.program, 'aPosition');
    gl.enableVertexAttribArray(aPosLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
    gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshBuffers.indexBuffer);
    gl.drawElements(gl.TRIANGLES, this.meshBuffers.indexCount, gl.UNSIGNED_SHORT, 0);

    // Always reset frontFace back to CCW
    gl.frontFace(gl.CCW);
  }

  drawTurningSheet(frontPageNum, backPageNum, pageSide, flip) {
    const pw = this.pw;

    // Start corner S and dragged corner P
    let sx = flip.sx;
    let sy = flip.sy;
    let px = flip.px;
    let py = flip.py;

    // Normalize for left page if turning backward
    if (pageSide < 0.0) {
      sx = -sx;
      px = -px;
    }

    const dx = px - sx;
    const dy = py - sy;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) return;

    // Chris Luke's Cylinder angle theta: perpendicular bisector of the drag vector
    const angle = Math.atan2(dy, dx);
    let theta = angle - Math.PI / 2.0;
    while (theta <= 0.05) theta += Math.PI;
    while (theta >= Math.PI - 0.05) theta -= Math.PI;
    theta = Math.max(0.15, Math.min(Math.PI - 0.15, theta));

    // Midpoint fold crease base (B, A)
    const midX = (sx + px) / 2.0;
    const midY = (sy + py) / 2.0;

    // Progress across page [0 = fully turned at spine, 1 = unturned at outer edge]
    const progress = Math.max(0.0, Math.min(1.0, midX / pw));
    // Dynamic cylinder radius C that tapers to 0 at the spine (midX = 0) and at outer edge (midX = pw)
    // with peak 3D curl in the middle of the turn
    const curlEnvelope = Math.sin(progress * Math.PI);
    const C = Math.max(0.5, curlEnvelope * 28.0);

    const cylInfo = {
      theta,
      B: midX - (C * Math.PI * 0.5) * Math.sin(theta),
      A: midY,
      C
    };

    // Draw single-pass double-sided turning sheet
    this.drawDoubleSidedPage(frontPageNum, backPageNum, pageSide, 1.0, cylInfo);
  }

  // Matrix Utilities
  createIdentityMatrix() {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]);
  }

  createOrthoMatrix(left, right, bottom, top, near, far) {
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);
    return new Float32Array([
      -2 * lr, 0, 0, 0,
      0, -2 * bt, 0, 0,
      0, 0, 2 * nf, 0,
      (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1
    ]);
  }

  translateMatrix(mat, tx, ty, tz) {
    mat[12] += tx;
    mat[13] += ty;
    mat[14] += tz;
  }

  scaleMatrix(mat, sx, sy, sz) {
    mat[0] *= sx;
    mat[5] *= sy;
    mat[10] *= sz;
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

  clearCache() {
    if (this.gl) {
      for (const tex of this.textures.values()) {
        this.gl.deleteTexture(tex);
      }
    }
    this.textures.clear();
  }

  preloadImage(pageNum, url) {
    const img = new Image();
    img.src = url;
    img.onload = () => {
      if (!this.gl) return;
      let tex = this.textures.get(pageNum);
      if (!tex) {
        tex = this.gl.createTexture();
        this.textures.set(pageNum, tex);
      }
      this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, img);
      this.gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      this.gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    };
  }
}
