/**
 * 2D PageFlip Geometry & Vector Math
 * Based on the classic Flash PageFlip engine & Xerox PARC page curl research.
 */

export const Easing = {
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
};

/**
 * Constrains dragged point P to respect paper inextensibility (rigidity) relative to spine anchors.
 * @param {number} px - Dragged point X
 * @param {number} py - Dragged point Y
 * @param {number} sx - Start corner X (W or -W)
 * @param {number} sy - Start corner Y (-H/2 to H/2)
 * @param {number} pw - Page width
 * @param {number} ph - Page height
 * @returns {{x: number, y: number}} Constrained (px, py)
 */
export function constrainPaper(px, py, sx, sy, pw, ph) {
  const topAnchorY = -ph / 2;
  const botAnchorY = ph / 2;

  // Maximum allowed distance from dragged corner to spine corners
  const maxRadiusTop = Math.hypot(pw, sy - topAnchorY);
  const maxRadiusBot = Math.hypot(pw, botAnchorY - sy);

  let x = px;
  let y = py;

  // Constraint 1: Top spine anchor (0, topAnchorY)
  const dTop = Math.hypot(x, y - topAnchorY);
  if (dTop > maxRadiusTop) {
    const scale = maxRadiusTop / dTop;
    x = x * scale;
    y = topAnchorY + (y - topAnchorY) * scale;
  }

  // Constraint 2: Bottom spine anchor (0, botAnchorY)
  const dBot = Math.hypot(x, y - botAnchorY);
  if (dBot > maxRadiusBot) {
    const scale = maxRadiusBot / dBot;
    x = x * scale;
    y = botAnchorY + (y - botAnchorY) * scale;
  }

  // Bound within horizontal travel limits
  if (sx > 0) {
    // Forward flip: cannot move further left than -pw - 20
    x = Math.max(-pw - 10, Math.min(pw, x));
  } else {
    // Backward flip: cannot move further right than pw + 20
    x = Math.min(pw + 10, Math.max(-pw, x));
  }

  return { x, y };
}

/**
 * Calculates fold crease line parameters, normal, intersections, and signed distance.
 * @param {number} px - Dragged corner X
 * @param {number} py - Dragged corner Y
 * @param {number} sx - Start corner X
 * @param {number} sy - Start corner Y
 * @param {number} pw - Page width
 * @param {number} ph - Page height
 * @returns {object|null} Fold line geometry
 */
export function calculateFold(px, py, sx, sy, pw, ph) {
  const vx = px - sx;
  const vy = py - sy;
  const len = Math.hypot(vx, vy);

  if (len < 0.5) {
    return null; // Fold is negligible / page flat
  }

  const nx = vx / len;
  const ny = vy / len;
  const cx = (sx + px) / 2;
  const cy = (sy + py) / 2;
  const foldAngle = Math.atan2(ny, nx) + Math.PI / 2;

  // Page rectangle X range: [0, pw] for right page, [-pw, 0] for left page
  const minX = sx > 0 ? 0 : -pw;
  const maxX = sx > 0 ? pw : 0;
  const minY = -ph / 2;
  const maxY = ph / 2;

  // Find intersections of line (X - cx)*nx + (Y - cy)*ny = 0 with page box edges
  const intersections = [];
  const eps = 1e-6;

  // 1. Top edge (Y = minY)
  if (Math.abs(nx) > eps) {
    const ix = cx - ((minY - cy) * ny) / nx;
    if (ix >= minX - eps && ix <= maxX + eps) {
      intersections.push({ x: Math.max(minX, Math.min(maxX, ix)), y: minY, edge: 'top' });
    }
  }

  // 2. Bottom edge (Y = maxY)
  if (Math.abs(nx) > eps) {
    const ix = cx - ((maxY - cy) * ny) / nx;
    if (ix >= minX - eps && ix <= maxX + eps) {
      intersections.push({ x: Math.max(minX, Math.min(maxX, ix)), y: maxY, edge: 'bottom' });
    }
  }

  // 3. Outer edge (X = sx)
  if (Math.abs(ny) > eps) {
    const iy = cy - ((sx - cx) * nx) / ny;
    if (iy >= minY - eps && iy <= maxY + eps) {
      intersections.push({ x: sx, y: Math.max(minY, Math.min(maxY, iy)), edge: 'outer' });
    }
  }

  // 4. Spine edge (X = 0)
  if (Math.abs(ny) > eps) {
    const iy = cy - ((0 - cx) * nx) / ny;
    if (iy >= minY - eps && iy <= maxY + eps) {
      intersections.push({ x: 0, y: Math.max(minY, Math.min(maxY, iy)), edge: 'spine' });
    }
  }

  // Remove duplicate intersection points that might happen at corners
  const uniqueIntersections = [];
  for (const pt of intersections) {
    const isDup = uniqueIntersections.some(
      (u) => Math.hypot(u.x - pt.x, u.y - pt.y) < 0.1
    );
    if (!isDup) uniqueIntersections.push(pt);
  }

  return {
    px,
    py,
    sx,
    sy,
    vx,
    vy,
    len,
    nx,
    ny,
    cx,
    cy,
    foldAngle,
    intersections: uniqueIntersections,
    minX,
    maxX,
    minY,
    maxY
  };
}

/**
 * Reflects a 2D point across the fold line.
 */
export function reflectPoint(x, y, fold) {
  const dist = (x - fold.cx) * fold.nx + (y - fold.cy) * fold.ny;
  return {
    x: x - 2 * dist * fold.nx,
    y: y - 2 * dist * fold.ny
  };
}

/**
 * Returns the signed distance from a point to the fold line.
 * Positive on start corner side S, negative on dragged corner side P.
 */
export function foldSignedDistance(x, y, fold) {
  return (x - fold.cx) * fold.nx + (y - fold.cy) * fold.ny;
}

/**
 * Clamps value between min and max.
 */
export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
