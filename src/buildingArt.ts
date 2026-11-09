/**
 * Building Art Kit — pseudo-3D residential building renderers.
 *
 * Three alternative art directions for Houses (tier 1), Apartments (tier 2)
 * and High-Rises (tier 3), plus the early "store about to go bust" warning FX.
 *
 * All draw functions expect the canvas to be translated so that (0, 0) is the
 * center of the building footprint, in world pixels (1 tile = 44px).
 * Light comes from the top-left (north-west); shadows fall to the south-east.
 */

export interface ArtPalette {
  main: string;
  roofLight: string;
  roofDark: string;
  wall: string;
  lot: string;
  shadow: string;
}

export type ArtStyle = 'diorama' | 'clay' | 'modern';

type V3 = [number, number, number];

// Oblique projection: height (z) lifts up-screen and slightly to the left,
// which exposes both the south and east facades of every building. Ground
// depth (y) is gently foreshortened to mimic a ~55° camera tilt.
const KX = -0.2;
const KY = 0.72;
const DY = 0.88;

function proj(p: V3): [number, number] {
  return [p[0] + KX * p[2], p[1] * DY - KY * p[2]];
}

// ---------------------------------------------------------------- color utils
function hexToRgb(color: string): [number, number, number] {
  if (color.startsWith('rgb')) {
    const m = color.match(/[\d.]+/g) || ['0', '0', '0'];
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  }
  const h = color.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function rgba(hex: string, a: number): string {
  const c = hexToRgb(hex);
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

// ------------------------------------------------------------ geometry utils
function poly(ctx: CanvasRenderingContext2D, pts: V3[], fill: string | CanvasGradient, stroke?: string, lw = 0.6) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = proj(p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

interface BoxColors {
  top: string | CanvasGradient;
  south: string | CanvasGradient;
  east: string | CanvasGradient;
  edge?: string;
}

/** Extruded box: footprint (x, y, w, d) from height z0 to z0 + h. */
function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, z0: number, h: number, c: BoxColors) {
  const z1 = z0 + h;
  // East facade
  poly(ctx, [[x + w, y, z0], [x + w, y + d, z0], [x + w, y + d, z1], [x + w, y, z1]], c.east, c.edge);
  // South facade
  poly(ctx, [[x, y + d, z0], [x + w, y + d, z0], [x + w, y + d, z1], [x, y + d, z1]], c.south, c.edge);
  // Roof
  poly(ctx, [[x, y, z1], [x + w, y, z1], [x + w, y + d, z1], [x, y + d, z1]], c.top, c.edge);
}

export interface BuildingEnvLighting {
  shadowDx: number;
  shadowDy: number;
  shadowAlpha: number;
  nightFactor: number;
  goldenHourFactor: number;
  snowCover: number;
  smokeIntensity: number;
  time: number;
}

const envLighting: BuildingEnvLighting = {
  shadowDx: 0.55,
  shadowDy: 0.32,
  shadowAlpha: 1.0,
  nightFactor: 0,
  goldenHourFactor: 0,
  snowCover: 0,
  smokeIntensity: 0,
  time: 0,
};

export function setBuildingEnvLighting(state: Partial<BuildingEnvLighting>) {
  Object.assign(envLighting, state);
}

/** Soft ground shadow cast along the live solar vector for a box of height h. */
function groundShadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, h: number, color: string, blur = 0) {
  const sx = h * envLighting.shadowDx;
  const sy = h * envLighting.shadowDy;
  y *= DY;
  d *= DY;
  ctx.save();
  ctx.globalAlpha *= envLighting.shadowAlpha;
  if (blur > 0) {
    ctx.filter = `blur(${blur}px)`;
  }
  ctx.beginPath();
  if (sx >= 0) {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w + sx, y + sy);
    ctx.lineTo(x + w + sx, y + d + sy);
    ctx.lineTo(x + sx, y + d + sy);
    ctx.lineTo(x, y + d);
  } else {
    // Dawn / morning sun in the East -> shadow stretches West (sx < 0)
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w, y + d);
    ctx.lineTo(x + w + sx, y + d + sy);
    ctx.lineTo(x + sx, y + d + sy);
    ctx.lineTo(x + sx, y + sy);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** Window quad on the south facade (plane y = yFace). */
function southWindow(ctx: CanvasRenderingContext2D, yFace: number, x: number, z: number, w: number, h: number, fill: string) {
  poly(ctx, [[x, yFace + 0.05, z], [x + w, yFace + 0.05, z], [x + w, yFace + 0.05, z + h], [x, yFace + 0.05, z + h]], fill);
}

/** Window quad on the east facade (plane x = xFace). */
function eastWindow(ctx: CanvasRenderingContext2D, xFace: number, y: number, z: number, d: number, h: number, fill: string) {
  poly(ctx, [[xFace + 0.05, y, z], [xFace + 0.05, y + d, z], [xFace + 0.05, y + d, z + h], [xFace + 0.05, y, z + h]], fill);
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function windowColors(night: boolean) {
  const isDuskOrNight = night || envLighting.nightFactor > 0.25;
  const gf = envLighting.goldenHourFactor;
  return {
    lit: isDuskOrNight ? '#FFE08A' : gf > 0.15 ? mix('#D6ECFF', '#FDE68A', gf * 0.7) : 'rgba(214, 236, 255, 0.95)',
    litDim: isDuskOrNight ? '#F5C35C' : gf > 0.15 ? mix('#AACDEB', '#F59E0B', gf * 0.55) : 'rgba(170, 205, 235, 0.95)',
    dark: isDuskOrNight ? 'rgba(30, 38, 60, 0.95)' : 'rgba(64, 92, 128, 0.85)',
  };
}

/** Stable per-building pseudo random so lit-window patterns don't flicker. */
function hashRand(seed: number, i: number): number {
  const s = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ============================================================================
// DESIGN A — "DIORAMA": crisp low-poly extruded geometry, real gabled roofs,
// readable facades with doors/windows, rooftop props.
// ============================================================================
function dioramaHouse(ctx: CanvasRenderingContext2D, p: ArtPalette, night: boolean, seed: number) {
  const gf = envLighting.goldenHourFactor;
  const wallTone = gf > 0.1 ? mix(mix(p.main, '#FFFFFF', 0.78), '#FED7AA', gf * 0.35) : mix(p.main, '#FFFFFF', 0.78);
  const wallSide = mix(p.main, '#B9A994', 0.62);
  const win = windowColors(night);
  const x = -10, y = -8, w = 20, d = 16, h = 10;

  groundShadow(ctx, x - 1.5, y - 1.5, w + 3, d + 3, h + 7, 'rgba(30, 25, 20, 0.22)');

  box(ctx, x, y, w, d, 0, h, { top: wallTone, south: wallTone, east: wallSide });

  // Door + windows on the south facade
  const nf = night ? 1 : envLighting.nightFactor;
  southWindow(ctx, y + d, -2, 0, 4, 6.2, p.wall);
  southWindow(ctx, y + d, -1.4, 0.4, 2.8, 5.2, mix(p.wall, '#000000', 0.25));
  southWindow(ctx, y + d, -8, 3, 4, 3.6, nf < 0.25 || hashRand(seed, 0) < nf * 0.9 ? win.lit : win.dark);
  southWindow(ctx, y + d, 4, 3, 4, 3.6, nf < 0.25 || hashRand(seed, 1) < nf * 0.75 ? win.lit : win.dark);
  eastWindow(ctx, x + w, -5, 3, 4, 3.6, win.litDim);
  eastWindow(ctx, x + w, 1.5, 3, 4, 3.6, win.litDim);

  // Gabled roof with overhang (ridge runs east-west)
  const o = 1.6;
  const ridgeZ = h + 6.5;
  const rx0 = x - o, rx1 = x + w + o, ry0 = y - o, ry1 = y + d + 0.8;
  const snow = envLighting.snowCover;
  const northRoofCol = snow > 0.2 ? mix(p.roofLight, '#F8FAFC', snow * 0.75) : p.roofLight;
  const southRoofCol = snow > 0.2 ? mix(p.main, '#E2E8F0', snow * 0.65) : p.main;
  // East gable triangle
  poly(ctx, [[x + w, y, h], [x + w, y + d, h], [x + w, 0, ridgeZ]], wallSide);
  // North slope (lit by NW sun)
  poly(ctx, [[rx0, ry0, h - 0.6], [rx1, ry0, h - 0.6], [rx1, 0, ridgeZ], [rx0, 0, ridgeZ]], northRoofCol);
  // South slope
  poly(ctx, [[rx0, 0, ridgeZ], [rx1, 0, ridgeZ], [rx1, ry1, h - 0.6], [rx0, ry1, h - 0.6]], southRoofCol);
  // Shingle courses
  ctx.save();
  ctx.strokeStyle = rgba('#000000', 0.12);
  ctx.lineWidth = 0.6;
  for (let t = 0.25; t < 1; t += 0.25) {
    const yy = ry1 * t;
    const zz = ridgeZ + (h - 0.6 - ridgeZ) * t;
    const a = proj([rx0, yy, zz]);
    const b = proj([rx1, yy, zz]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  ctx.restore();
  // Ridge cap + eave edge
  poly(ctx, [[rx0, -0.6, ridgeZ + 0.3], [rx1, -0.6, ridgeZ + 0.3], [rx1, 0.6, ridgeZ + 0.3], [rx0, 0.6, ridgeZ + 0.3]], p.roofDark);
  poly(ctx, [[rx0, ry1, h - 0.6], [rx1, ry1, h - 0.6], [rx1, ry1, h - 1.6], [rx0, ry1, h - 1.6]], p.roofDark);

  // Chimney on the north slope
  box(ctx, 4, -5.5, 3, 3, h + 2, 8.5, { top: '#5B4A3F', south: '#8C6E5D', east: '#6E5547' });
  const smokeStr = Math.max(night ? 0.8 : 0, envLighting.smokeIntensity);
  if (smokeStr > 0.12) {
    const t = envLighting.time + seed * 1.7;
    for (let k = 0; k < 3; k++) {
      const puffAge = (t * 0.65 + k * 0.33) % 1;
      const liftZ = h + 11.5 + puffAge * 9.5;
      const driftX = 5.5 + puffAge * 4.5 + Math.sin(t * 2 + k) * 0.8;
      const [sx, sy] = proj([driftX, -4, liftZ]);
      const rad = 1.4 + puffAge * 2.4;
      const alpha = (1 - puffAge) * 0.34 * smokeStr;
      ctx.fillStyle = `rgba(215, 220, 230, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function dioramaApartment(ctx: CanvasRenderingContext2D, p: ArtPalette, night: boolean, seed: number) {
  const win = windowColors(night);
  const x = -13, y = -10.5, w = 26, d = 21, floors = 4, fh = 6.0, h = floors * fh;
  const facade = night ? mix(p.main, '#E2E8F0', 0.62) : mix(p.main, '#FFFFFF', 0.65);
  const facadeSide = night ? mix(p.main, '#475569', 0.55) : mix(p.main, '#7D8794', 0.5);

  groundShadow(ctx, x, y, w, d, h, 'rgba(15, 20, 32, 0.34)');
  box(ctx, x, y, w, d, 0, h, {
    top: p.roofLight,
    south: facade,
    east: facadeSide,
    edge: night ? 'rgba(255, 255, 255, 0.14)' : 'rgba(15, 23, 42, 0.22)',
  });

  // Floor slabs (bold color-coded bands) + glowing windows
  for (let f = 0; f < floors; f++) {
    const z = f * fh;
    poly(ctx, [[x, y + d + 0.05, z + fh - 1.1], [x + w, y + d + 0.05, z + fh - 1.1], [x + w, y + d + 0.05, z + fh], [x, y + d + 0.05, z + fh]], p.main);
    poly(ctx, [[x + w + 0.05, y, z + fh - 1.1], [x + w + 0.05, y + d, z + fh - 1.1], [x + w + 0.05, y + d, z + fh], [x + w + 0.05, y, z + fh]], p.roofDark);
    for (let i = 0; i < 4; i++) {
      const lit = !night || hashRand(seed, f * 10 + i) > 0.25;
      southWindow(ctx, y + d, x + 2 + i * 6.0, z + 1.1, 3.8, 3.4, lit ? win.lit : win.dark);
    }
    for (let i = 0; i < 3; i++) {
      const lit = !night || hashRand(seed, 50 + f * 10 + i) > 0.32;
      eastWindow(ctx, x + w, y + 2.5 + i * 5.8, z + 1.1, 3.6, 3.4, lit ? win.litDim : win.dark);
    }
  }
  // Illuminated ground-floor entrance canopy
  box(ctx, -5, y + d, 10, 2.8, 4.2, 1.1, { top: p.roofLight, south: p.main, east: p.wall });

  // Balconies on upper floors
  for (let f = 1; f < floors; f++) {
    for (const bx of [x + 1.4, x + 13.6]) {
      box(ctx, bx, y + d, 9.2, 2.0, f * fh, 1.7, { top: mix(p.roofLight, '#FFFFFF', 0.35), south: p.main, east: p.roofDark });
    }
  }

  // Glowing Brand-Colored Parapet Crown + Roof Deck
  const z1 = h;
  box(ctx, x - 0.4, y - 0.4, w + 0.8, d + 0.8, z1, 1.4, {
    top: p.roofLight,
    south: p.main,
    east: p.roofDark,
  });
  poly(ctx, [[x + 1.4, y + 1.4, z1 + 1.45], [x + w - 1.4, y + 1.4, z1 + 1.45], [x + w - 1.4, y + d - 1.4, z1 + 1.45], [x + 1.4, y + d - 1.4, z1 + 1.45]], mix(p.roofDark, '#1E293B', 0.4));
  // Rooftop props: brightly accented stair core, AC units, water tank
  box(ctx, x + 3, y + 3, 7.5, 6.5, z1 + 1.4, 3.8, { top: p.roofLight, south: p.main, east: p.roofDark });
  box(ctx, x + 14, y + 4, 3.4, 3.4, z1 + 1.4, 2.0, { top: '#F8FAFC', south: '#CBD5E1', east: '#94A3B8' });
  box(ctx, x + 18.6, y + 4, 3.4, 3.4, z1 + 1.4, 2.0, { top: '#F8FAFC', south: '#CBD5E1', east: '#94A3B8' });
  // Water tank (cylinder)
  const [tx, ty] = proj([x + 17.5, y + 14, z1 + 1.4]);
  const [ttx, tty] = proj([x + 17.5, y + 14, z1 + 6.4]);
  ctx.fillStyle = '#8A6A52';
  ctx.fillRect(tx - 3, tty, 6, ty - tty);
  ctx.fillStyle = '#A9836A';
  ctx.beginPath();
  ctx.ellipse(ttx, tty, 3, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
}

function dioramaHighRise(ctx: CanvasRenderingContext2D, p: ArtPalette, night: boolean, seed: number, t: number) {
  const win = windowColors(night);
  // Wide Illuminated Plaza Podium
  const px = -14.5, py = -12, pw = 29, pd = 24, ph = 6;
  // Soaring 3D Skyscraper Tower (taller & bolder!)
  const tx = -9.5, ty = -9, tw = 19, td = 16, th = 36;

  groundShadow(ctx, tx, ty, tw, td, th + ph, 'rgba(10, 14, 26, 0.38)');
  groundShadow(ctx, px, py, pw, pd, ph, 'rgba(10, 14, 26, 0.24)');

  box(ctx, px, py, pw, pd, 0, ph, {
    top: mix(p.roofLight, '#FFFFFF', 0.45),
    south: p.main,
    east: p.roofDark,
    edge: 'rgba(255, 255, 255, 0.22)',
  });
  // Podium storefront glazing
  southWindow(ctx, py + pd, px + 2, 0.8, pw - 4, 3.6, night ? '#FFF3B0' : 'rgba(210, 235, 255, 0.95)');

  // Glass curtain wall gradients tinted with rich brand color so towers POP at day & night
  const [gsx0, gsy0] = proj([tx, ty + td, ph]);
  const [, gsy1] = proj([tx, ty + td, ph + th]);
  const southGrad = ctx.createLinearGradient(gsx0, gsy0, gsx0, gsy1);
  southGrad.addColorStop(0, night ? mix(p.wall, '#1E293B', 0.45) : mix(p.main, '#1E3A5F', 0.45));
  southGrad.addColorStop(1, night ? mix(p.main, '#334155', 0.35) : mix(p.roofLight, '#E0F2FE', 0.4));
  const eastGrad = ctx.createLinearGradient(gsx0, gsy0, gsx0, gsy1);
  eastGrad.addColorStop(0, night ? mix(p.wall, '#0F172A', 0.55) : mix(p.wall, '#13243D', 0.45));
  eastGrad.addColorStop(1, night ? mix(p.roofDark, '#1E293B', 0.45) : mix(p.wall, '#7FA6CC', 0.38));

  box(ctx, tx, ty, tw, td, ph, th, {
    top: p.roofLight,
    south: southGrad,
    east: eastGrad,
    edge: night ? rgba(p.roofLight, 0.45) : 'rgba(15, 23, 42, 0.25)',
  });

  // Vertical colored mullion fins + glowing floor bands
  const floors = 9;
  const fh = th / floors;
  for (let f = 0; f < floors; f++) {
    const z = ph + f * fh;
    for (let i = 0; i < 5; i++) {
      const lit = night ? hashRand(seed, f * 7 + i) > 0.28 : hashRand(seed, f * 7 + i) > 0.72;
      if (lit) southWindow(ctx, ty + td, tx + 0.9 + i * 3.6, z + 0.65, 2.8, fh - 1.3, night ? win.lit : 'rgba(255,255,255,0.65)');
    }
    for (let i = 0; i < 4; i++) {
      const lit = night ? hashRand(seed, 99 + f * 7 + i) > 0.35 : false;
      if (lit) eastWindow(ctx, tx + tw, ty + 0.9 + i * 3.7, z + 0.65, 2.8, fh - 1.3, win.litDim);
    }
    poly(ctx, [[tx, ty + td + 0.08, z], [tx + tw, ty + td + 0.08, z], [tx + tw, ty + td + 0.08, z + 0.5], [tx, ty + td + 0.08, z + 0.5]], night ? rgba(p.roofLight, 0.55) : rgba('#FFFFFF', 0.42));
  }
  for (let i = 0; i <= 5; i++) {
    const fx = tx + i * (tw / 5);
    poly(ctx, [[fx - 0.45, ty + td + 0.1, ph], [fx + 0.45, ty + td + 0.1, ph], [fx + 0.45, ty + td + 0.1, ph + th], [fx - 0.45, ty + td + 0.1, ph + th]], night ? p.roofLight : p.main);
  }
  // Sky reflection sheen
  if (!night) {
    poly(ctx, [[tx + 2, ty + td + 0.12, ph + th * 0.52], [tx + 6.5, ty + td + 0.12, ph + th * 0.52], [tx + 12, ty + td + 0.12, ph + th], [tx + 7.5, ty + td + 0.12, ph + th]], 'rgba(255,255,255,0.28)');
  }

  // Illuminated Neon Setback Crown + Mechanical Penthouse + Helipad Badge
  const cz = ph + th;
  box(ctx, tx - 0.6, ty - 0.6, tw + 1.2, td + 1.2, cz - 1.4, 1.6, {
    top: '#FFFFFF',
    south: p.roofLight,
    east: p.main,
  });
  box(ctx, tx + 2.2, ty + 2.2, tw - 4.4, td - 4.4, cz + 0.2, 4.2, {
    top: p.roofLight,
    south: p.main,
    east: p.roofDark,
    edge: '#FFFFFF',
  });
  box(ctx, tx + 5.2, ty + 4.2, 4.5, 4.0, cz + 4.4, 2.6, { top: '#F8FAFC', south: '#CBD5E1', east: '#94A3B8' });

  // Twin Spires with Pulsing Aviation Beacons
  const [ax, ay] = proj([tx + tw * 0.62, ty + td * 0.45, cz + 4.4]);
  const [atx, aty] = proj([tx + tw * 0.62, ty + td * 0.45, cz + 15]);
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(atx, aty);
  ctx.stroke();
  const blink = (Math.sin(t * 4.5 + seed) + 1) / 2;
  ctx.fillStyle = `rgba(255, 59, 48, ${0.45 + blink * 0.55})`;
  ctx.beginPath();
  ctx.arc(atx, aty, 2.0 + blink * 1.1, 0, Math.PI * 2);
  ctx.fill();
}

// ============================================================================
// DESIGN A — COMMERCIAL & TRANSIT DESTINATIONS:
// Commercial Superstore, Circular Hub, and Commuter Train Station
// ============================================================================

export interface DestinationArtOptions {
  isNorthEntrance?: boolean;
  criticalDanger?: boolean;
  /** Y offset in lot coordinate space. Defaults to -19 (+19 if isNorthEntrance). 0 centers on origin. */
  offsetY?: number;
  /** Visual & capacity progression tier (1 = Market, 2 = Galleria, 3 = Geodesic Hub, 4 = Mega-Tower) */
  tier?: 1 | 2 | 3 | 4;
}

function parseDestOptions(optionsOrNorth?: boolean | DestinationArtOptions, critical?: boolean) {
  if (typeof optionsOrNorth === 'object' && optionsOrNorth !== null) {
    const isNorth = !!optionsOrNorth.isNorthEntrance;
    const crit = !!optionsOrNorth.criticalDanger;
    const yOff = optionsOrNorth.offsetY !== undefined ? optionsOrNorth.offsetY : (isNorth ? 19 : -19);
    const tier = optionsOrNorth.tier || 1;
    return { isNorthEntrance: isNorth, criticalDanger: crit, offsetY: yOff, tier };
  }
  const isNorth = !!optionsOrNorth;
  const crit = !!critical;
  const yOff = isNorth ? 19 : -19;
  return { isNorthEntrance: isNorth, criticalDanger: crit, offsetY: yOff, tier: 1 as const };
}

/**
 * 3D low-poly extruded commercial superstore / factory matching Design A.
 * Features:
 * - Industrial loading bay with roll-up corrugated door, dock bumper curb, hazard stripes & cargo crates
 * - High-volume glass entrance facade with interior display illumination
 * - Cantilevered architectural canopy with angled structural tie rods & soffit downlights
 * - Illuminated brand signage fascia with backlit emblem
 * - Flat roof with perimeter parapet, dual commercial HVAC chillers, fan grilles, ducts & sawtooth skylights
 * - Penthouse stair bulkhead with flashing aviation beacon
 * - Proper oblique 3D ground shadow and facade illumination
 */
export function dioramaStore(
  ctx: CanvasRenderingContext2D,
  p: ArtPalette,
  night: boolean,
  seed = 0,
  time = 0,
  optionsOrNorth: boolean | DestinationArtOptions = false,
  criticalDanger = false
) {
  const opts = parseDestOptions(optionsOrNorth, criticalDanger);
  const win = windowColors(night);

  const dangerTint = opts.criticalDanger ? ((Math.sin(time * 9) + 1) / 2) * 0.42 : 0;
  const brandColor = dangerTint > 0 ? mix(p.main, '#FF3B30', dangerTint) : p.main;

  const wallSouth = mix(p.main, '#FFFFFF', 0.82);
  const wallEast = mix(p.main, '#9AA5B4', 0.58);
  const roofDeck = mix(p.roofDark, '#2E3846', 0.45);

  const bw = 66, bd = 26, h = 13;
  const bx = -bw / 2;
  const by = opts.offsetY - bd / 2;

  // 1. Drop shadow cast to south-east
  groundShadow(ctx, bx - 1, by - 1, bw + 2, bd + 2, h + 4, 'rgba(20, 22, 35, 0.25)');

  // 2. Main Building Box
  box(ctx, bx, by, bw, bd, 0, h, {
    top: roofDeck,
    south: wallSouth,
    east: wallEast,
  });

  // 3. Parapet rims (East & South)
  box(ctx, bx + bw - 1.4, by, 1.4, bd, h, 1.2, { top: p.roofDark, south: p.roofDark, east: wallEast });
  box(ctx, bx, by + bd - 1.4, bw, 1.4, h, 1.2, { top: brandColor, south: brandColor, east: p.roofDark });

  // 4. Industrial Loading Bay (East Wing: x from 12 to 31, w = 19)
  const lbX = 12, lbW = 19;
  // Recessed concrete loading dock curb platform
  box(ctx, lbX, by + bd - 1, lbW, 3.2, 0, 2.6, { top: '#94A3B8', south: '#64748B', east: '#475569' });
  // Dock bumper hazard stripes on south face
  ctx.save();
  ctx.fillStyle = '#F4B924';
  const dockPtA = proj([lbX + 1, by + bd + 2.2, 0.4]);
  const dockPtB = proj([lbX + lbW - 1, by + bd + 2.2, 2.2]);
  ctx.fillRect(dockPtA[0], dockPtA[1] - 2, dockPtB[0] - dockPtA[0], 2);
  ctx.restore();

  // Corrugated Roll-up Industrial Bay Door
  southWindow(ctx, by + bd, lbX + 2, 2.6, lbW - 4, 8.2, '#3E4957');
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.6;
  for (let z = 3.6; z < 10.5; z += 1.4) {
    const p1 = proj([lbX + 2, by + bd + 0.06, z]);
    const p2 = proj([lbX + lbW - 2, by + bd + 0.06, z]);
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();
  }
  ctx.restore();

  // Loading Dock Canopy overhead
  box(ctx, lbX + 0.5, by + bd, lbW - 1, 2.5, 11, 0.8, { top: p.roofDark, south: '#334155', east: '#1E293B' });

  // Loading Bay safety light fixture
  const [lx, ly] = proj([lbX + lbW / 2, by + bd + 1.2, 11.2]);
  ctx.fillStyle = night ? '#FFDD80' : '#E2E8F0';
  ctx.beginPath();
  ctx.arc(lx, ly, 1.2, 0, Math.PI * 2);
  ctx.fill();
  if (night) {
    ctx.fillStyle = 'rgba(255, 221, 128, 0.22)';
    ctx.beginPath();
    ctx.arc(lx, ly + 4, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Small delivery pallet / wooden cargo crates on dock
  box(ctx, lbX + 1.5, by + bd + 0.8, 4.5, 2.2, 2.6, 2.8, { top: '#C8A97A', south: '#A08055', east: '#7D603B' });

  // 5. Commercial Superstore Glass Entrance & Canopy (West Wing: x from -31 to 9, w = 40)
  const entX = -31, entW = 40;
  // Double-height glazed entrance curtain wall
  southWindow(ctx, by + bd, entX + 1, 0.6, entW - 2, 9, night ? '#1E2B45' : 'rgba(180, 215, 240, 0.88)');

  // Lit interior storefront display / warm windows at night
  if (night) {
    southWindow(ctx, by + bd, entX + 2.5, 1.2, entW - 5, 4.2, '#FFE28A');
    southWindow(ctx, by + bd, entX + 3.5, 5.8, entW - 7, 3.2, 'rgba(255, 240, 180, 0.7)');
    // Shopper silhouette inside
    ctx.fillStyle = 'rgba(50, 40, 30, 0.75)';
    const [silX, silY] = proj([entX + 15, by + bd + 0.1, 1.2]);
    ctx.fillRect(silX - 1.2, silY - 3, 2.4, 3);
  }

  // Dark vertical mullions dividing entrance bays
  for (let i = 1; i < 4; i++) {
    const mx = entX + 1 + i * ((entW - 2) / 4);
    poly(ctx, [[mx - 0.4, by + bd + 0.08, 0.6], [mx + 0.4, by + bd + 0.08, 0.6], [mx + 0.4, by + bd + 0.08, 9.6], [mx - 0.4, by + bd + 0.08, 9.6]], '#2C3E50');
  }

  // Double automatic sliding doors in center bays
  const doorX = entX + entW * 0.35, doorW = entW * 0.3;
  poly(ctx, [[doorX, by + bd + 0.09, 0.6], [doorX + doorW, by + bd + 0.09, 0.6], [doorX + doorW, by + bd + 0.09, 6.2], [doorX, by + bd + 0.09, 6.2]], 'rgba(255,255,255,0.18)', '#1E293B', 0.6);
  const dMid = doorX + doorW / 2;
  poly(ctx, [[dMid - 0.3, by + bd + 0.1, 0.6], [dMid + 0.3, by + bd + 0.1, 0.6], [dMid + 0.3, by + bd + 0.1, 6.2], [dMid - 0.3, by + bd + 0.1, 6.2]], '#1E293B');

  // Entrance Floor Welcome Apron
  poly(ctx, [[doorX - 2, by + bd, 0.02], [doorX + doorW + 2, by + bd, 0.02], [doorX + doorW + 2, by + bd + 3.5, 0.02], [doorX - 2, by + bd + 3.5, 0.02]], '#334155');

  // Cantilevered Architectural Canopy over entrance
  box(ctx, entX - 0.5, by + bd, entW + 1, 3.8, 9.4, 1.2, { top: brandColor, south: p.roofDark, east: p.wall });

  // Angled steel structural stay cables
  ctx.save();
  ctx.strokeStyle = '#64748B';
  ctx.lineWidth = 0.8;
  for (const cx of [entX + 2, entX + entW * 0.5, entX + entW - 2]) {
    const ptTop = proj([cx, by + bd + 0.1, 12.2]);
    const ptEdge = proj([cx, by + bd + 3.8, 9.6]);
    ctx.beginPath();
    ctx.moveTo(ptTop[0], ptTop[1]);
    ctx.lineTo(ptEdge[0], ptEdge[1]);
    ctx.stroke();
  }
  ctx.restore();

  // Underside canopy spotlight pools at night
  if (night) {
    for (let k = 0; k < 3; k++) {
      const sx = entX + 6 + k * 14;
      const [spx, spy] = proj([sx, by + bd + 1.8, 0.05]);
      ctx.fillStyle = 'rgba(255, 235, 160, 0.28)';
      ctx.beginPath();
      ctx.ellipse(spx, spy, 4.5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Illuminated Store Brand Signage Fascia above canopy
  box(ctx, entX + 3, by + bd + 0.2, entW - 6, 0.7, 10.6, 2.2, {
    top: p.roofLight,
    south: brandColor,
    east: p.roofDark,
  });
  // Illuminated store logo badge pill
  const [badgeX, badgeY] = proj([entX + entW / 2, by + bd + 0.95, 11.7]);
  ctx.fillStyle = night ? '#FFFFFF' : '#F8FAFC';
  ctx.beginPath();
  ctx.ellipse(badgeX, badgeY, 6.5, 2.0, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = brandColor;
  ctx.beginPath();
  ctx.ellipse(badgeX, badgeY, 4.8, 1.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // 6. East Facade Windows & Fire Exit
  eastWindow(ctx, bx + bw, by + 4, 7.5, 16, 3.2, win.litDim);
  eastWindow(ctx, bx + bw, by + bd - 6, 0.4, 4, 6.2, '#334155');

  // 7. Rooftop HVAC & Mechanical Equipment (z = h = 13)
  // Large HVAC Unit 1
  box(ctx, -20, by + 4, 9, 8, h, 4, { top: '#E2E8F0', south: '#94A3B8', east: '#64748B' });
  southWindow(ctx, by + 12, -19, h + 0.8, 7, 2.4, '#475569');
  const [fanX, fanY] = proj([-15.5, by + 8, h + 4.02]);
  ctx.fillStyle = '#475569';
  ctx.beginPath();
  ctx.ellipse(fanX, fanY, 2.8, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#94A3B8';
  ctx.lineWidth = 0.6;
  ctx.stroke();

  // Secondary HVAC Unit 2
  box(ctx, -9, by + 6, 7, 6, h, 3.2, { top: '#E2E8F0', south: '#94A3B8', east: '#64748B' });
  southWindow(ctx, by + 12, -8.2, h + 0.6, 5.4, 2.0, '#475569');

  // Sheet metal connecting duct
  box(ctx, -12, by + 8, 4, 2, h + 0.8, 1.6, { top: '#CBD5E1', south: '#94A3B8', east: '#64748B' });

  // Dual Sawtooth / Clerestory Skylight Monitors
  for (let s = 0; s < 2; s++) {
    const sx0 = 1 + s * 7;
    const sy0 = by + 5, sy1 = by + 13;
    poly(ctx, [[sx0, sy0, h], [sx0 + 5.5, sy0, h], [sx0 + 5.5, sy0 + 3.5, h + 3.2], [sx0, sy0 + 3.5, h + 3.2]], night ? '#1E2B45' : 'rgba(215, 238, 255, 0.9)');
    poly(ctx, [[sx0, sy0 + 3.5, h + 3.2], [sx0 + 5.5, sy0 + 3.5, h + 3.2], [sx0 + 5.5, sy1, h], [sx0, sy1, h]], p.roofDark);
    poly(ctx, [[sx0 + 5.5, sy0, h], [sx0 + 5.5, sy1, h], [sx0 + 5.5, sy0 + 3.5, h + 3.2]], wallEast);
  }

  // Elevator / Stair Bulkhead Penthouse
  box(ctx, 16, by + 4, 11, 9, h, 4.6, { top: wallSouth, south: wallSouth, east: wallEast });
  poly(ctx, [[15.5, by + 3.5, h + 4.61], [27.5, by + 3.5, h + 4.61], [27.5, by + 13.5, h + 4.61], [15.5, by + 13.5, h + 4.61]], p.roofLight);
  southWindow(ctx, by + 13, 18, h + 0.4, 3.5, 3.8, '#475569');

  // Red rooftop aviation warning beacon
  const [bxA, byA] = proj([26, by + 4.5, h + 4.6]);
  const [bxB, byB] = proj([26, by + 4.5, h + 8]);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(bxA, byA);
  ctx.lineTo(bxB, byB);
  ctx.stroke();
  const blink = (Math.sin(time * 4 + seed) + 1) / 2;
  ctx.fillStyle = `rgba(255, 59, 48, ${night ? 0.4 + blink * 0.6 : 0.25})`;
  ctx.beginPath();
  ctx.arc(bxB, byB, 1.4 + (night ? blink * 0.8 : 0), 0, Math.PI * 2);
  ctx.fill();
}

/**
 * TIER 2 STORE: 3D Multi-Story Department Emporium / Galleria matching Design A.
 * Features:
 * - Full-width ground retail concourse + setback 2nd-story glass atrium mezzanine (h = 22)
 * - Rooftop garden terrace on East wing with trees, planters & illuminated pergola
 * - Panoramic brand-tinted upper glass curtain wall with vertical neon mullions
 * - Twin illuminated entrance pylons + cantilevered double-deck canopy & glowing rooftop billboard
 */
export function dioramaDepartmentGalleria(
  ctx: CanvasRenderingContext2D,
  p: ArtPalette,
  night: boolean,
  seed = 0,
  time = 0,
  optionsOrNorth: boolean | DestinationArtOptions = false,
  criticalDanger = false
) {
  const opts = parseDestOptions(optionsOrNorth, criticalDanger);

  const dangerTint = opts.criticalDanger ? ((Math.sin(time * 9) + 1) / 2) * 0.42 : 0;
  const brandColor = dangerTint > 0 ? mix(p.main, '#FF3B30', dangerTint) : p.main;

  const wallSouth = mix(p.main, '#FFFFFF', 0.72);
  const wallEast = mix(p.main, '#9AA5B4', 0.48);
  const roofDeck = mix(p.roofDark, '#2E3846', 0.35);

  const bw = 68, bd = 27, h1 = 11.5;
  const bx = -bw / 2;
  const by = opts.offsetY - bd / 2;

  // 1. Deep 3D Drop Shadow
  groundShadow(ctx, bx - 1, by - 1, bw + 3, bd + 3, 24, 'rgba(14, 18, 30, 0.32)');

  // 2. Ground Floor Concourse Volume (z = 0..h1)
  box(ctx, bx, by, bw, bd, 0, h1, {
    top: roofDeck,
    south: wallSouth,
    east: wallEast,
    edge: 'rgba(15, 23, 42, 0.25)',
  });

  // Glowing 1st-floor cornice trim band
  box(ctx, bx - 0.5, by - 0.5, bw + 1, bd + 1, h1, 1.3, {
    top: p.roofLight,
    south: brandColor,
    east: p.roofDark,
  });

  // 3. East Wing Rooftop Terrace Garden (on top of Ground Floor at x = 10..32, z = h1 + 1.3)
  const terZ = h1 + 1.3;
  poly(ctx, [[10, by + 3, terZ + 0.05], [31, by + 3, terZ + 0.05], [31, by + bd - 3, terZ + 0.05], [10, by + bd - 3, terZ + 0.05]], '#34D399');
  for (const tx of [15, 25]) {
    const [treeX, treeY] = proj([tx, by + bd * 0.5, terZ + 2.5]);
    ctx.fillStyle = '#059669';
    ctx.beginPath();
    ctx.arc(treeX, treeY, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6EE7B7';
    ctx.beginPath();
    ctx.arc(treeX - 0.9, treeY - 0.9, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Second-Story Setback Galleria Atrium (x = -31..10, w = 41, z = terZ..terZ + 9.5)
  const h2 = 9.5;
  const z2Top = terZ + h2;
  const g2South = mix(p.main, '#FFFFFF', 0.56);
  const g2East = mix(p.main, '#64748B', 0.42);
  box(ctx, -31, by + 1.5, 42, bd - 3, terZ, h2, {
    top: mix(p.roofDark, p.main, 0.4),
    south: g2South,
    east: g2East,
    edge: 'rgba(255, 255, 255, 0.28)',
  });

  // Panoramic 2nd-story brand-illuminated glass curtain ribbon
  const upperGlass = night ? mix('#FFE28A', p.roofLight, 0.45) : mix(p.roofLight, '#E0F2FE', 0.65);
  southWindow(ctx, by + bd - 1.5, -28.5, terZ + 1.4, 37, h2 - 3.0, upperGlass);
  eastWindow(ctx, 11, by + 4, terZ + 1.4, bd - 8, h2 - 3.0, upperGlass);

  // Vertical neon structural fins across the 2nd floor atrium
  for (let k = 0; k < 5; k++) {
    const fx = -25 + k * 7.5;
    poly(ctx, [[fx - 0.35, by + bd - 1.42, terZ + 1.0], [fx + 0.35, by + bd - 1.42, terZ + 1.0], [fx + 0.35, by + bd - 1.42, z2Top - 0.8], [fx - 0.35, by + bd - 1.42, z2Top - 0.8]], p.roofLight);
  }

  // Glowing 2nd-Story Crown Parapet + Rooftop Skylight Dome
  box(ctx, -31.6, by + 1.0, 43.2, bd - 2, z2Top, 1.5, {
    top: p.roofLight,
    south: brandColor,
    east: p.roofDark,
    edge: '#FFFFFF',
  });
  box(ctx, -20, by + 6, 20, 11, z2Top + 1.5, 2.8, {
    top: night ? '#FFE9A8' : '#E0F2FE',
    south: brandColor,
    east: p.roofDark,
  });

  // 5. Ground Floor Grand Galleria Entrance & Twin Neon Pylons
  const entX = -30, entW = 40;
  southWindow(ctx, by + bd, entX + 1.5, 0.6, entW - 3, h1 - 2.0, night ? '#FFE28A' : 'rgba(185, 225, 250, 0.92)');
  // Twin vertical brand pylons framing entrance
  for (const px of [entX + 1, entX + entW - 3.5]) {
    box(ctx, px, by + bd - 0.4, 2.6, 2.6, 0, h1 + 3.5, {
      top: '#FFFFFF',
      south: brandColor,
      east: p.roofDark,
    });
  }
  // Cantilevered Grand Canopy
  box(ctx, entX - 1, by + bd, entW + 2, 4.2, 8.8, 1.4, {
    top: p.roofLight,
    south: brandColor,
    east: p.roofDark,
  });

  // East wing Express Delivery Bay
  southWindow(ctx, by + bd, 14, 1.5, 14, 7.2, '#334155');
  box(ctx, 13, by + bd, 16, 2.5, 9.2, 0.9, { top: brandColor, south: p.roofDark, east: '#1E293B' });

  // Pulsing rooftop beacon
  const [bxA, byA] = proj([6, by + 5, z2Top + 1.5]);
  const [bxB, byB] = proj([6, by + 5, z2Top + 6.5]);
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(bxA, byA);
  ctx.lineTo(bxB, byB);
  ctx.stroke();
  const blink = (Math.sin(time * 4.5 + seed) + 1) / 2;
  ctx.fillStyle = `rgba(255, 59, 48, ${night ? 0.45 + blink * 0.55 : 0.3})`;
  ctx.beginPath();
  ctx.arc(bxB, byB, 1.6 + (night ? blink * 0.9 : 0), 0, Math.PI * 2);
  ctx.fill();
}

/**
 * TIER 3 STORE: 3D Cylindrical / Geodesic Rotunda High-Demand Hub matching Design A.
 * Features:
 * - Faceted cylindrical base rotunda with brand-tinted architectural colonnade
 * - Annular neon-rimmed sky-promenade deck
 * - Brand-illuminated clerestory drum & color-keyed geodesic glass dome (so each color hub glows in its own signature hue!)
 * - Grand projecting entrance portico & tall apex spire
 */
export function dioramaCircularHub(
  ctx: CanvasRenderingContext2D,
  p: ArtPalette,
  night: boolean,
  seed = 0,
  time = 0,
  optionsOrNorth: boolean | DestinationArtOptions = false,
  criticalDanger = false
) {
  const opts = parseDestOptions(optionsOrNorth, criticalDanger);
  const win = windowColors(night);

  const dangerTint = opts.criticalDanger ? ((Math.sin(time * 9) + 1) / 2) * 0.42 : 0;
  const brandColor = dangerTint > 0 ? mix(p.main, '#FF3B30', dangerTint) : p.main;

  const cx = 0;
  const cy = opts.offsetY;

  const R1 = 29;
  const H1 = 9.0;
  const R2 = 19.5;
  const H2 = 7.2;
  const domePeakZ = 24.5;

  // 1. Soft elliptical ground shadow cast to SE
  const [shCx, shCy] = proj([cx + 7, cy + 5, 0]);
  ctx.save();
  ctx.fillStyle = 'rgba(14, 18, 30, 0.32)';
  ctx.beginPath();
  ctx.ellipse(shCx, shCy, R1 * 1.12, R1 * DY * 1.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 2. Base Rotunda Tier (Cylindrical Faceted Wall: z = 0 to H1)
  const N1 = 20;
  for (let i = 0; i < N1; i++) {
    const th0 = (i / N1) * Math.PI * 2;
    const th1 = ((i + 1) / N1) * Math.PI * 2;
    const midTh = (th0 + th1) / 2;

    if (Math.sin(midTh) < -0.25) continue;

    const x0 = cx + R1 * Math.cos(th0), y0 = cy + R1 * Math.sin(th0);
    const x1 = cx + R1 * Math.cos(th1), y1 = cy + R1 * Math.sin(th1);

    const nx = Math.cos(midTh), ny = Math.sin(midTh);
    const sunDot = nx * -0.707 + ny * -0.707;
    const shade = Math.max(0, Math.min(1, (sunDot + 1) / 2));
    const facetWall = mix(p.roofDark, mix(p.main, '#FFFFFF', 0.65), shade * 0.85 + 0.15);

    poly(ctx, [[x0, y0, 0], [x1, y1, 0], [x1, y1, H1], [x0, y0, H1]], facetWall);

    if (Math.sin(midTh) > 0.15) {
      const wPad = 0.22;
      const wx0 = cx + R1 * Math.cos(th0 + (th1 - th0) * wPad);
      const wy0 = cy + R1 * Math.sin(th0 + (th1 - th0) * wPad);
      const wx1 = cx + R1 * Math.cos(th1 - (th1 - th0) * wPad);
      const wy1 = cy + R1 * Math.sin(th1 - (th1 - th0) * wPad);
      const lit = !night || hashRand(seed, i * 7) > 0.25;
      const colWin = lit ? (night ? mix('#FFE28A', p.roofLight, 0.38) : mix(p.roofLight, '#FFFFFF', 0.55)) : win.dark;
      poly(ctx, [[wx0, wy0, 1.2], [wx1, wy1, 1.2], [wx1, wy1, H1 - 1.5], [wx0, wy0, H1 - 1.5]], colWin);
    }
  }

  // Promenade Deck (Annular roof deck of Tier 1 at z = H1) with Brand Neon Ring
  const [d1x, d1y] = proj([cx, cy, H1]);
  ctx.fillStyle = mix(p.roofDark, p.main, 0.45);
  ctx.beginPath();
  ctx.ellipse(d1x, d1y, R1 + 0.5, (R1 + 0.5) * DY, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = night ? p.roofLight : brandColor;
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // 3. Upper Clerestory Drum Tier (z = H1 to H1 + H2 = 16.2)
  const zClere = H1 + H2;
  const N2 = 16;
  for (let i = 0; i < N2; i++) {
    const th0 = (i / N2) * Math.PI * 2;
    const th1 = ((i + 1) / N2) * Math.PI * 2;
    const midTh = (th0 + th1) / 2;

    if (Math.sin(midTh) < -0.25) continue;

    const x0 = cx + R2 * Math.cos(th0), y0 = cy + R2 * Math.sin(th0);
    const x1 = cx + R2 * Math.cos(th1), y1 = cy + R2 * Math.sin(th1);

    const winFill = night ? mix(p.roofLight, '#FFF3B0', 0.42) : mix(p.roofLight, '#E0F2FE', 0.55);
    poly(ctx, [[x0, y0, H1], [x1, y1, H1], [x1, y1, zClere], [x0, y0, zClere]], winFill);

    poly(ctx, [[x0 - 0.45, y0, H1], [x0 + 0.45, y0, H1], [x0 + 0.45, y0, zClere], [x0 - 0.45, y0, zClere]], brandColor);
  }

  // Cornice band at top of clerestory drum (z = zClere)
  const [d2x, d2y] = proj([cx, cy, zClere]);
  ctx.fillStyle = brandColor;
  ctx.beginPath();
  ctx.ellipse(d2x, d2y, R2 + 0.8, (R2 + 0.8) * DY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 4. Brand-Keyed Geodesic Segmented Glass Dome (z = zClere to domePeakZ)
  const NDome = 16;
  const zMidDome = zClere + 4.8;
  const RMidDome = R2 * 0.62;

  for (let i = 0; i < NDome; i++) {
    const th0 = (i / NDome) * Math.PI * 2;
    const th1 = ((i + 1) / NDome) * Math.PI * 2;
    const midTh = (th0 + th1) / 2;
    if (Math.sin(midTh) < -0.25) continue;

    const x0 = cx + R2 * Math.cos(th0), y0 = cy + R2 * Math.sin(th0);
    const x1 = cx + R2 * Math.cos(th1), y1 = cy + R2 * Math.sin(th1);
    const mx0 = cx + RMidDome * Math.cos(th0), my0 = cy + RMidDome * Math.sin(th0);
    const mx1 = cx + RMidDome * Math.cos(th1), my1 = cy + RMidDome * Math.sin(th1);

    const nx = Math.cos(midTh), ny = Math.sin(midTh);
    const sunDot = nx * -0.707 + ny * -0.707;
    const glassShade = Math.max(0, Math.min(1, (sunDot + 1) / 2));
    const glassColor = night
      ? mix(brandColor, mix(p.roofLight, '#FFFFFF', 0.55), 0.35 + glassShade * 0.5)
      : mix(p.main, mix(p.roofLight, '#FFFFFF', 0.75), 0.4 + glassShade * 0.5);

    poly(ctx, [[x0, y0, zClere], [x1, y1, zClere], [mx1, my1, zMidDome], [mx0, my0, zMidDome]], glassColor, 'rgba(255, 255, 255, 0.55)', 0.6);
  }

  for (let i = 0; i < NDome; i++) {
    const th0 = (i / NDome) * Math.PI * 2;
    const th1 = ((i + 1) / NDome) * Math.PI * 2;
    const midTh = (th0 + th1) / 2;
    if (Math.sin(midTh) < -0.25) continue;

    const mx0 = cx + RMidDome * Math.cos(th0), my0 = cy + RMidDome * Math.sin(th0);
    const mx1 = cx + RMidDome * Math.cos(th1), my1 = cy + RMidDome * Math.sin(th1);

    const glassColor = night ? mix(p.roofLight, '#FFFFFF', 0.65) : mix(p.roofLight, '#FFFFFF', 0.78);
    poly(ctx, [[mx0, my0, zMidDome], [mx1, my1, zMidDome], [cx, cy, domePeakZ]], glassColor, 'rgba(255, 255, 255, 0.65)', 0.6);
  }

  // Specular sky reflection streak on the dome
  const [glx0, gly0] = proj([cx - R2 * 0.45, cy - R2 * 0.2, zClere + 2]);
  const [glx1, gly1] = proj([cx - R2 * 0.1, cy - R2 * 0.05, domePeakZ - 0.5]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(glx0, gly0);
  ctx.lineTo(glx1, gly1);
  ctx.stroke();

  // 5. Grand Entrance Portal / Portico (Front South face: y = cy + R1)
  const portW = 20, portD = 6.0, portH = 6.5;
  const portX = cx - portW / 2;
  const portY = cy + R1 - 3;
  southWindow(ctx, portY + portD, portX + 1.5, 0.5, portW - 3, portH - 1, night ? '#FFE9A8' : 'rgba(190, 225, 250, 0.95)');
  box(ctx, portX, portY, portW, portD, portH, 1.4, {
    top: p.roofLight,
    south: brandColor,
    east: p.roofDark,
  });
  for (const colX of [portX + 2.5, portX + portW - 2.5]) {
    const [cBotX, cBotY] = proj([colX, portY + portD - 0.5, 0]);
    const [cTopX, cTopY] = proj([colX, portY + portD - 0.5, portH]);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cBotX, cBotY);
    ctx.lineTo(cTopX, cTopY);
    ctx.stroke();
  }
  if (night) {
    const [wlX, wlY] = proj([cx, portY + portD + 2, 0.05]);
    ctx.fillStyle = 'rgba(255, 235, 170, 0.38)';
    ctx.beginPath();
    ctx.ellipse(wlX, wlY, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 6. Apex Spire & Blinking Brand Beacon Orb
  const [spBaseX, spBaseY] = proj([cx, cy, domePeakZ]);
  const [spTopX, spTopY] = proj([cx, cy, domePeakZ + 7.5]);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(spBaseX, spBaseY);
  ctx.lineTo(spTopX, spTopY);
  ctx.stroke();

  const orbBlink = (Math.sin(time * 5 + seed) + 1) / 2;
  ctx.fillStyle = night ? p.roofLight : brandColor;
  ctx.beginPath();
  ctx.arc(spTopX, spTopY, 2.4 + orbBlink * 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(spTopX, spTopY, 1.1, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * TIER 4 STORE: 3D Mega-Commerce Arcology Tower & Helipad Plaza matching Design A.
 * Features:
 * - 2-story commercial galleria podium spanning the 2x2 lot
 * - East Wing elevated VIP Helipad deck with illuminated "H" landing circle & perimeter beacon lights
 * - West/Center Wing soaring 8-story (h = 44) brand-tinted diagrid corporate skyscraper
 * - Illuminated neon vertical fins, holographic sky-crown, and twin pulsing aviation beacons
 */
export function dioramaMegaCommerceTower(
  ctx: CanvasRenderingContext2D,
  p: ArtPalette,
  night: boolean,
  seed = 0,
  time = 0,
  optionsOrNorth: boolean | DestinationArtOptions = false,
  criticalDanger = false
) {
  const opts = parseDestOptions(optionsOrNorth, criticalDanger);
  const win = windowColors(night);

  const dangerTint = opts.criticalDanger ? ((Math.sin(time * 9) + 1) / 2) * 0.42 : 0;
  const brandColor = dangerTint > 0 ? mix(p.main, '#FF3B30', dangerTint) : p.main;

  const bw = 68, bd = 28, podH = 12.5;
  const bx = -bw / 2;
  const by = opts.offsetY - bd / 2;

  // 1. Dramatic Skyscraper Ground Shadow
  groundShadow(ctx, bx - 2, by - 2, bw + 4, bd + 4, 42, 'rgba(10, 14, 26, 0.38)');

  // 2. Commercial Galleria Podium (z = 0..podH)
  const podSouth = mix(p.main, '#FFFFFF', 0.65);
  const podEast = mix(p.main, '#64748B', 0.45);
  box(ctx, bx, by, bw, bd, 0, podH, {
    top: mix(p.roofDark, '#1E293B', 0.4),
    south: podSouth,
    east: podEast,
    edge: 'rgba(255, 255, 255, 0.25)',
  });

  // Glowing podium cornice belt
  box(ctx, bx - 0.8, by - 0.8, bw + 1.6, bd + 1.6, podH, 1.5, {
    top: p.roofLight,
    south: brandColor,
    east: p.roofDark,
    edge: '#FFFFFF',
  });

  // Podium ground-floor grand glass atrium
  southWindow(ctx, by + bd, bx + 3, 0.8, bw - 6, podH - 2.2, night ? '#FFE28A' : 'rgba(190, 230, 255, 0.92)');
  box(ctx, bx + 4, by + bd, bw - 8, 4.2, 9.2, 1.4, {
    top: p.roofLight,
    south: brandColor,
    east: p.roofDark,
  });

  // 3. East Wing Rooftop VIP Helipad Deck (x = 7..31, z = podH + 1.5)
  const heliZ = podH + 1.55;
  const [hx, hy] = proj([19, by + bd * 0.5, heliZ]);
  ctx.save();
  ctx.fillStyle = '#1E293B';
  ctx.beginPath();
  ctx.ellipse(hx, hy, 10.5, 10.5 * DY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = night ? p.roofLight : '#FACC15';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // "H" marking on helipad
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 7px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', hx, hy + 0.5);
  ctx.restore();

  // 4. West/Center Wing Soaring 8-Story Corporate Arcology Skyscraper (x = -30..6, w = 36, d = 22)
  const tx = -30, tw = 36;
  const ty = by + 3, td = 22;
  const tz0 = podH + 1.5;
  const th = 27.5; // Reaches z = 41.5!

  const glassSouth = night ? mix(brandColor, '#253858', 0.45) : mix(brandColor, '#E0F2FE', 0.42);
  const glassEast = night ? mix(p.roofDark, '#17233B', 0.52) : mix(p.roofDark, '#94A3B8', 0.35);
  box(ctx, tx, ty, tw, td, tz0, th, {
    top: p.roofLight,
    south: glassSouth,
    east: glassEast,
    edge: p.roofLight,
  });

  // 6 Floors of Illuminated Curtain-Wall Ribbon Windows
  const floors = 6;
  for (let f = 0; f < floors; f++) {
    const fz = tz0 + 1.2 + f * 4.2;
    for (let c = 0; c < 4; c++) {
      const lit = !night || hashRand(seed, f * 13 + c * 5) > 0.18;
      const winCol = lit ? (night ? '#FFE694' : 'rgba(235, 250, 255, 0.94)') : win.dark;
      southWindow(ctx, ty + td, tx + 2.2 + c * 8.2, fz, 6.8, 2.8, winCol);
    }
    for (let c = 0; c < 2; c++) {
      const lit = !night || hashRand(seed, f * 17 + c * 9 + 3) > 0.22;
      const winCol = lit ? (night ? win.litDim : 'rgba(205, 232, 250, 0.88)') : win.dark;
      eastWindow(ctx, tx + tw, ty + 2.5 + c * 9.0, fz, 7.2, 2.8, winCol);
    }
  }

  // Exterior Diagrid Structural Bracing & Neon Vertical Mullions
  ctx.save();
  ctx.strokeStyle = night ? p.roofLight : '#FFFFFF';
  ctx.lineWidth = 1.2;
  const [dA0x, dA0y] = proj([tx + 1, ty + td + 0.12, tz0]);
  const [dA1x, dA1y] = proj([tx + tw * 0.5, ty + td + 0.12, tz0 + th * 0.5]);
  const [dA2x, dA2y] = proj([tx + tw - 1, ty + td + 0.12, tz0]);
  const [dA3x, dA3y] = proj([tx + 1, ty + td + 0.12, tz0 + th]);
  const [dA4x, dA4y] = proj([tx + tw - 1, ty + td + 0.12, tz0 + th]);
  ctx.beginPath();
  ctx.moveTo(dA0x, dA0y);
  ctx.lineTo(dA1x, dA1y);
  ctx.lineTo(dA4x, dA4y);
  ctx.moveTo(dA2x, dA2y);
  ctx.lineTo(dA1x, dA1y);
  ctx.lineTo(dA3x, dA3y);
  ctx.stroke();
  ctx.restore();

  // 5. Illuminated Sky-Crown Penthouse & Twin Spires (z = 41.5..48)
  const cz = tz0 + th;
  box(ctx, tx - 0.8, ty - 0.8, tw + 1.6, td + 1.6, cz, 1.8, {
    top: '#FFFFFF',
    south: p.roofLight,
    east: brandColor,
  });
  box(ctx, tx + 5, ty + 4, tw - 10, td - 8, cz + 1.8, 5.2, {
    top: '#FFFFFF',
    south: brandColor,
    east: p.roofDark,
    edge: '#FFFFFF',
  });

  // Twin Sky-Spires with Synchronized Blinking Beacons
  const blink = (Math.sin(time * 5 + seed) + 1) / 2;
  for (const spX of [tx + 10, tx + tw - 10]) {
    const [sbX, sbY] = proj([spX, ty + td * 0.5, cz + 7.0]);
    const [stX, stY] = proj([spX, ty + td * 0.5, cz + 16.5]);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(sbX, sbY);
    ctx.lineTo(stX, stY);
    ctx.stroke();

    ctx.fillStyle = `rgba(255, 59, 48, ${0.5 + blink * 0.5})`;
    ctx.beginPath();
    ctx.arc(stX, stY, 2.2 + blink * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 3D passenger train terminal matching Design A.
 * Features:
 * - Elevated trackside concrete passenger platform with tactile yellow warning stripe, shelter canopy & lamps
 * - Grand arched barrel-vault train shed roof with curved longitudinal panels & end gable arch
 * - Transverse glass skylight ribs cutting across the barrel vault, illuminated at night
 * - Multi-bay Roman arched passenger concourse entrance with cantilevered iron canopy & "RAIL" transit badge
 * - Prominent multi-tier railway clock tower with dual backlit clock faces & copper spire with weather vane
 */
export function dioramaTrainStation(
  ctx: CanvasRenderingContext2D,
  p: ArtPalette,
  night: boolean,
  seed = 0,
  time = 0,
  optionsOrNorth: boolean | DestinationArtOptions = false
) {
  const opts = parseDestOptions(optionsOrNorth, false);
  const win = windowColors(night);

  const cy = opts.offsetY;

  // 1. Concrete Trackside Passenger Platform along North edge
  const platX = -36, platW = 72;
  const platY = cy - 20, platD = 7.5;
  const platH = 2.4;

  groundShadow(ctx, platX, platY, platW, platD, platH + 1, 'rgba(20, 22, 35, 0.2)');

  box(ctx, platX, platY, platW, platD, 0, platH, {
    top: '#94A3B8',
    south: '#64748B',
    east: '#475569',
  });

  ctx.save();
  ctx.strokeStyle = '#F4B924';
  ctx.lineWidth = 1.8;
  ctx.setLineDash([4, 3]);
  const [tPt0x, tPt0y] = proj([platX + 2, platY + 0.8, platH + 0.05]);
  const [tPt1x, tPt1y] = proj([platX + platW - 2, platY + 0.8, platH + 0.05]);
  ctx.beginPath();
  ctx.moveTo(tPt0x, tPt0y);
  ctx.lineTo(tPt1x, tPt1y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Platform Shelters & Posts
  for (const sx of [-22, 18]) {
    box(ctx, sx, platY + 1.2, 10, 4.5, platH + 3.2, 0.6, {
      top: '#334155',
      south: '#1E293B',
      east: '#0F172A',
    });
    for (const px of [sx + 1.2, sx + 8.8]) {
      const [pbX, pbY] = proj([px, platY + 3.5, platH]);
      const [ptX, ptY] = proj([px, platY + 3.5, platH + 3.2]);
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(pbX, pbY);
      ctx.lineTo(ptX, ptY);
      ctx.stroke();
    }
  }

  // 2. Main Train Shed & Concourse Hall
  const shedX = -26, shedW = 60;
  const shedY = cy - 12.5, shedD = 24;
  const shedWallH = 10.5;

  groundShadow(ctx, shedX - 1, shedY, shedW + 2, shedD, shedWallH + 6, 'rgba(20, 22, 35, 0.25)');

  const wallTone = mix(p.main, '#FFFFFF', 0.8);
  const wallEast = mix(p.main, '#8892A0', 0.52);
  box(ctx, shedX, shedY, shedW, shedD, 0, shedWallH, {
    top: '#334155',
    south: wallTone,
    east: wallEast,
  });

  // 3. Arched Barrel Vault Roof
  const archSteps = 7;
  const archRise = 7.5;
  const ym = shedY + shedD / 2;
  const halfD = shedD / 2;

  const getArchZ = (yVal: number) => {
    const ny = (yVal - ym) / halfD;
    return shedWallH + archRise * (1 - ny * ny);
  };

  for (let s = 0; s < archSteps; s++) {
    const y0 = shedY + (s / archSteps) * shedD;
    const y1 = shedY + ((s + 1) / archSteps) * shedD;
    const z0 = getArchZ(y0);
    const z1 = getArchZ(y1);

    const midY = (y0 + y1) / 2;
    const ny = (midY - ym) / halfD;
    const shade = Math.max(0, Math.min(1, 0.6 - ny * 0.45));
    const panelColor = mix(p.roofDark, p.roofLight, shade);

    poly(ctx, [
      [shedX, y0, z0],
      [shedX + shedW, y0, z0],
      [shedX + shedW, y1, z1],
      [shedX, y1, z1],
    ], panelColor);
  }

  // East Arch End Gable
  const gablePts: V3[] = [[shedX + shedW, shedY, shedWallH]];
  for (let s = 0; s <= archSteps; s++) {
    const yVal = shedY + (s / archSteps) * shedD;
    gablePts.push([shedX + shedW, yVal, getArchZ(yVal)]);
  }
  gablePts.push([shedX + shedW, shedY + shedD, shedWallH]);
  poly(ctx, gablePts, wallEast);

  // Large arched window in East gable
  const eastWinPts: V3[] = [[shedX + shedW + 0.05, shedY + 3, shedWallH + 1]];
  for (let s = 1; s < archSteps; s++) {
    const yVal = shedY + (s / archSteps) * shedD;
    eastWinPts.push([shedX + shedW + 0.05, yVal, getArchZ(yVal) - 1.2]);
  }
  eastWinPts.push([shedX + shedW + 0.05, shedY + shedD - 3, shedWallH + 1]);
  poly(ctx, eastWinPts, night ? '#FFE9A8' : 'rgba(210, 235, 255, 0.9)');

  // 4. Transverse Glass Skylight Ribs across the arched roof
  const skylightWidth = 4.2;
  const skylightXs = [shedX + 11, shedX + 28, shedX + 45];

  for (const skX of skylightXs) {
    for (let s = 0; s < archSteps; s++) {
      const y0 = shedY + (s / archSteps) * shedD;
      const y1 = shedY + ((s + 1) / archSteps) * shedD;
      const z0 = getArchZ(y0) + 0.05;
      const z1 = getArchZ(y1) + 0.05;

      const glassRib = night ? '#FFE28A' : 'rgba(230, 245, 255, 0.95)';
      poly(ctx, [
        [skX, y0, z0],
        [skX + skylightWidth, y0, z0],
        [skX + skylightWidth, y1, z1],
        [skX, y1, z1],
      ], glassRib, 'rgba(255, 255, 255, 0.4)', 0.5);
    }
  }

  // 5. South Concourse Facade & Passenger Entrance Portals
  const entY = shedY + shedD;
  for (let i = 0; i < 3; i++) {
    const ax = shedX + 8 + i * 16;
    const lit = !night || hashRand(seed, i * 7) > 0.25;
    southWindow(ctx, entY, ax, 0.6, 10, 7.2, lit ? (night ? '#FFE28A' : 'rgba(185, 220, 245, 0.9)') : win.dark);
    poly(ctx, [[ax - 0.5, entY + 0.08, 7.2], [ax + 10.5, entY + 0.08, 7.2], [ax + 10.5, entY + 0.08, 8.2], [ax - 0.5, entY + 0.08, 8.2]], p.main);
  }

  // Cantilevered Iron Passenger Entrance Canopy
  box(ctx, shedX + 4, entY, shedW - 8, 3.5, 7.8, 1.0, {
    top: p.main,
    south: p.roofDark,
    east: p.wall,
  });

  // Illuminated "RAIL" Transit Badge
  box(ctx, shedX + shedW / 2 - 11, entY + 0.3, 22, 0.8, 9.4, 2.5, {
    top: '#1E293B',
    south: '#0F172A',
    east: '#000000',
  });
  const [badgeX, badgeY] = proj([shedX + shedW / 2, entY + 1.1, 10.6]);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 6px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('RAIL', badgeX, badgeY);

  // 6. Integrated Multi-Tier Clock Tower (West Wing)
  const twX = -35, twW = 9;
  const twY = cy - 1, twD = 9;
  const twShaftH = 17;
  const twChamberH = 6.5;
  const twSpireH = 5.5;

  groundShadow(ctx, twX - 1, twY - 1, twW + 2, twD + 2, twShaftH + twChamberH + twSpireH, 'rgba(20, 22, 35, 0.28)');

  const twWallSouth = mix(p.main, '#FFFFFF', 0.75);
  const twWallEast = mix(p.main, '#828C9A', 0.5);
  box(ctx, twX, twY, twW, twD, 0, twShaftH, {
    top: p.roofDark,
    south: twWallSouth,
    east: twWallEast,
  });
  southWindow(ctx, twY + twD, twX + 3.5, 4, 2, 7, win.litDim);
  eastWindow(ctx, twX + twW, twY + 3.5, 4, 2, 7, win.litDim);

  // Corbelled Cornice Ledge below clock chamber
  box(ctx, twX - 0.6, twY - 0.6, twW + 1.2, twD + 1.2, twShaftH, 1.0, {
    top: p.roofLight,
    south: p.main,
    east: p.roofDark,
  });

  // Clock Chamber
  const cz0 = twShaftH + 1.0;
  box(ctx, twX, twY, twW, twD, cz0, twChamberH, {
    top: p.roofDark,
    south: twWallSouth,
    east: twWallEast,
  });

  // Illuminated Railway Clock Face on South Facade
  const [clockSx, clockSy] = proj([twX + twW / 2, twY + twD + 0.08, cz0 + twChamberH / 2]);
  ctx.fillStyle = '#1E293B';
  ctx.beginPath();
  ctx.arc(clockSx, clockSy, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = night ? '#FFFBE6' : '#FFFFFF';
  ctx.beginPath();
  ctx.arc(clockSx, clockSy, 2.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(clockSx, clockSy);
  const minAng = time * 0.5;
  const hrAng = time * 0.04 + 1.2;
  ctx.lineTo(clockSx + Math.cos(minAng) * 2.0, clockSy + Math.sin(minAng) * 2.0);
  ctx.moveTo(clockSx, clockSy);
  ctx.lineTo(clockSx + Math.cos(hrAng) * 1.4, clockSy + Math.sin(hrAng) * 1.4);
  ctx.stroke();

  // Second Clock Face on East Facade
  const [clockEx, clockEy] = proj([twX + twW + 0.08, twY + twD / 2, cz0 + twChamberH / 2]);
  ctx.fillStyle = '#1E293B';
  ctx.beginPath();
  ctx.ellipse(clockEx, clockEy, 2.0, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = night ? '#FFFBE6' : '#FFFFFF';
  ctx.beginPath();
  ctx.ellipse(clockEx, clockEy, 1.5, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Pyramidal Copper/Slate Roof Spire
  const spZ0 = cz0 + twChamberH;
  const spPeakZ = spZ0 + twSpireH;
  const spMidX = twX + twW / 2;
  const spMidY = twY + twD / 2;

  poly(ctx, [[twX, twY + twD, spZ0], [twX + twW, twY + twD, spZ0], [spMidX, spMidY, spPeakZ]], p.main);
  poly(ctx, [[twX + twW, twY, spZ0], [twX + twW, twY + twD, spZ0], [spMidX, spMidY, spPeakZ]], p.roofDark);
  poly(ctx, [[twX, twY, spZ0], [twX + twW, twY, spZ0], [spMidX, spMidY, spPeakZ]], p.roofLight);

  // Weather Vane / Finial Spire
  const [finBotX, finBotY] = proj([spMidX, spMidY, spPeakZ]);
  const [finTopX, finTopY] = proj([spMidX, spMidY, spPeakZ + 3.8]);
  ctx.strokeStyle = '#F4B924';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(finBotX, finBotY);
  ctx.lineTo(finTopX, finTopY);
  ctx.stroke();
  ctx.fillStyle = '#F4B924';
  ctx.beginPath();
  ctx.moveTo(finTopX, finTopY);
  ctx.lineTo(finTopX + 3.5, finTopY + 1.2);
  ctx.lineTo(finTopX, finTopY + 2.4);
  ctx.closePath();
  ctx.fill();
}

/**
 * Public entry point for rendering Design A commercial and transit destinations.
 * Supports 4-stage visual progression for commercial stores:
 * Tier 1 = Corner Market / Superstore
 * Tier 2 = Multi-Story Department Galleria
 * Tier 3 = Geodesic Rotunda Exchange Hub
 * Tier 4 = Mega-Commerce Arcology Skyscraper & Helipad Plaza
 */
export function drawDestination(
  ctx: CanvasRenderingContext2D,
  type: 'store' | 'galleria' | 'circular' | 'megatower' | 'station',
  palette: ArtPalette,
  night: boolean,
  seed = 0,
  time = 0,
  options?: boolean | DestinationArtOptions,
  critical?: boolean
) {
  ctx.save();
  ctx.lineJoin = 'round';
  const parsed = parseDestOptions(options, critical);
  if (type === 'station') {
    dioramaTrainStation(ctx, palette, night, seed, time, options);
  } else if (type === 'megatower' || parsed.tier === 4) {
    dioramaMegaCommerceTower(ctx, palette, night, seed, time, options, critical);
  } else if (type === 'circular' || parsed.tier === 3) {
    dioramaCircularHub(ctx, palette, night, seed, time, options, critical);
  } else if (type === 'galleria' || parsed.tier === 2) {
    dioramaDepartmentGalleria(ctx, palette, night, seed, time, options, critical);
  } else {
    dioramaStore(ctx, palette, night, seed, time, options, critical);
  }
  ctx.restore();
}

// ============================================================================
// DESIGN B — "CLAY TOY": soft rounded volumes, gradient shading, ambient
// occlusion, pillowy roofs, cylindrical tower. Feels like a tilt-shift toy.
// ============================================================================
function clayExtrude(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, z0: number, h: number, r: number, top: string, side: string) {
  const lift = KY;
  const yb = y - z0 * lift;
  const yt = y - (z0 + h) * lift;
  // Side body: union of ground and top rounded rects + fill between
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, mix(side, '#FFFFFF', 0.12));
  grad.addColorStop(0.55, side);
  grad.addColorStop(1, mix(side, '#000000', 0.22));
  ctx.fillStyle = grad;
  roundRectPath(ctx, x, yb, w, d, r);
  ctx.fill();
  ctx.fillRect(x, yt + d / 2, w, yb - yt);
  // Top
  const tg = ctx.createLinearGradient(x, yt, x + w, yt + d);
  tg.addColorStop(0, mix(top, '#FFFFFF', 0.28));
  tg.addColorStop(1, top);
  ctx.fillStyle = tg;
  roundRectPath(ctx, x, yt, w, d, r);
  ctx.fill();
  // Rim highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

function clayAO(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, h: number) {
  ctx.save();
  ctx.filter = 'blur(2.5px)';
  ctx.fillStyle = 'rgba(30, 25, 40, 0.28)';
  roundRectPath(ctx, x + h * 0.25, y + h * 0.2, w + h * 0.15, d, 8);
  ctx.fill();
  ctx.restore();
}

function clayHouse(ctx: CanvasRenderingContext2D, p: ArtPalette, night: boolean) {
  const win = windowColors(night);
  clayAO(ctx, -11, -9, 22, 18, 10);
  const wall = mix(p.main, '#FFF6EA', 0.8);
  clayExtrude(ctx, -10, -8, 20, 16, 0, 8, 5, wall, mix(wall, '#C9B79E', 0.45));
  // Round windows + arched door on the front face
  const fy = 8 - 3.5 * KY;
  ctx.fillStyle = win.lit;
  for (const wx of [-6, 6]) {
    ctx.beginPath();
    ctx.arc(wx, fy, 1.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = p.wall;
  roundRectPath(ctx, -1.8, 8 - 5.5 * KY, 3.6, 5.5 * KY, 1.8);
  ctx.fill();

  // Pillowy hip roof
  const ry = -8 - 8 * KY - 1.5;
  const rg = ctx.createRadialGradient(-4, ry + 2, 1, 0, ry + 8, 18);
  rg.addColorStop(0, mix(p.roofLight, '#FFFFFF', 0.35));
  rg.addColorStop(0.6, p.main);
  rg.addColorStop(1, p.roofDark);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  roundRectPath(ctx, -11.5, ry + 2.5, 23, 18, 8);
  ctx.fill();
  ctx.fillStyle = rg;
  roundRectPath(ctx, -12, ry, 24, 18, 8);
  ctx.fill();
  // Ridge crease
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-5, ry + 8);
  ctx.lineTo(5, ry + 8);
  ctx.stroke();
  // Bush
  const bg = ctx.createRadialGradient(13, 5, 0.5, 13.5, 6, 5);
  bg.addColorStop(0, '#7FD48E');
  bg.addColorStop(1, '#2E8A57');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(13.5, 6, 4, 0, Math.PI * 2);
  ctx.fill();
}

function clayApartment(ctx: CanvasRenderingContext2D, p: ArtPalette, night: boolean, seed: number) {
  const win = windowColors(night);
  clayAO(ctx, -13, -11, 26, 22, 18);
  const tiers = [
    { x: -12.5, y: -10, w: 25, d: 20, h: 6.5 },
    { x: -11, y: -10, w: 22, d: 17, h: 6.5 },
    { x: -9.5, y: -10, w: 19, d: 14, h: 6.5 },
  ];
  let z = 0;
  tiers.forEach((tr, i) => {
    const body = mix(p.main, '#FFFFFF', 0.62 - i * 0.08);
    clayExtrude(ctx, tr.x, tr.y, tr.w, tr.d, z, tr.h, 6, i === tiers.length - 1 ? p.main : mix(p.roofLight, '#FFFFFF', 0.3), mix(body, '#9AA3AE', 0.35));
    // Window strip on front face
    const fy = tr.y + tr.d - (z + tr.h * 0.55) * KY;
    for (let k = 0; k < 5 - i; k++) {
      const lit = !night || hashRand(seed, i * 10 + k) > 0.3;
      ctx.fillStyle = lit ? win.lit : win.dark;
      roundRectPath(ctx, tr.x + 2.5 + k * ((tr.w - 5) / (5 - i)), fy - 1.6, (tr.w - 5) / (5 - i) - 1.4, 3.2, 1.4);
      ctx.fill();
    }
    // Terrace planters on the step
    if (i > 0) {
      const ty = tiers[i - 1].y + tiers[i - 1].d - z * KY - 1.5;
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = k % 2 ? '#3FAE6A' : '#5BC47D';
        ctx.beginPath();
        ctx.arc(tr.x + 3 + k * (tr.w - 6) / 3, ty, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    z += tr.h;
  });
  // Rooftop dome skylight
  const topY = -10 - z * KY + 7;
  const sg = ctx.createRadialGradient(-1.5, topY - 1.5, 0.3, 0, topY, 4.5);
  sg.addColorStop(0, '#FFFFFF');
  sg.addColorStop(1, mix(p.roofLight, '#BFE0FF', 0.5));
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(0, topY, 4, 0, Math.PI * 2);
  ctx.fill();
}

function clayHighRise(ctx: CanvasRenderingContext2D, p: ArtPalette, night: boolean, seed: number, t: number) {
  const win = windowColors(night);
  const r = 10;
  const ry = r * 0.55;
  const segs = 7;
  const segH = 5.2;
  // Long soft shadow
  ctx.save();
  ctx.filter = 'blur(3px)';
  ctx.fillStyle = 'rgba(25, 20, 45, 0.26)';
  ctx.beginPath();
  ctx.ellipse(10, 6, r + 8, ry + 3, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Base plinth
  clayExtrude(ctx, -13, -11, 26, 22, 0, 3.5, 8, mix(p.main, '#FFFFFF', 0.55), p.roofDark);

  const baseY = 0 - 3.5 * KY;
  for (let s = 0; s < segs; s++) {
    const yb = baseY - s * segH * KY;
    const yt = yb - segH * KY;
    const rr = r - s * 0.35;
    const g = ctx.createLinearGradient(-rr, 0, rr, 0);
    const band = s % 2 === 0 ? mix(p.main, '#FFFFFF', 0.55) : mix(p.main, '#FFFFFF', 0.35);
    g.addColorStop(0, mix(band, '#FFFFFF', 0.35));
    g.addColorStop(0.45, band);
    g.addColorStop(1, mix(band, '#000000', 0.32));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, yb, rr, ry, 0, 0, Math.PI);
    ctx.lineTo(-rr, yt);
    ctx.ellipse(0, yt, rr, ry, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    // Ribbon windows following the curve
    for (let k = 0; k < 6; k++) {
      const a0 = 0.25 + k * 0.45;
      const lit = night ? hashRand(seed, s * 9 + k) > 0.35 : true;
      ctx.strokeStyle = lit ? (night ? win.lit : 'rgba(205, 230, 250, 0.9)') : win.dark;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(0, (yb + yt) / 2 + 0.6, rr + 0.1, ry, 0, a0, a0 + 0.3);
      ctx.stroke();
    }
  }
  // Dome cap
  const capY = baseY - segs * segH * KY;
  const rr = r - segs * 0.35;
  const dg = ctx.createRadialGradient(-rr * 0.4, capY - 4, 1, 0, capY, rr * 1.3);
  dg.addColorStop(0, mix(p.roofLight, '#FFFFFF', 0.5));
  dg.addColorStop(0.7, p.main);
  dg.addColorStop(1, p.roofDark);
  ctx.fillStyle = dg;
  ctx.beginPath();
  ctx.ellipse(0, capY, rr, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, capY - 1.5, rr * 0.75, ry * 0.75 + 2.5, 0, Math.PI, 0);
  ctx.fill();
  // Beacon
  const blink = (Math.sin(t * 4 + seed) + 1) / 2;
  ctx.fillStyle = `rgba(255, 80, 70, ${0.4 + blink * 0.6})`;
  ctx.beginPath();
  ctx.arc(0, capY - ry - 5, 1.6 + blink, 0, Math.PI * 2);
  ctx.fill();
}

// ============================================================================
// DESIGN C — "MODERN": contemporary architecture — flat roofs, timber +
// white volumes, glass, rooftop gardens & solar, glass skyscraper w/ LED crown.
// ============================================================================
function modernHouse(ctx: CanvasRenderingContext2D, p: ArtPalette, night: boolean) {
  const win = windowColors(night);
  groundShadow(ctx, -11, -9, 22, 18, 12, 'rgba(25, 25, 30, 0.22)');
  // Pool on lot
  ctx.fillStyle = '#E9EEF2';
  roundRectPath(ctx, 5.5, 3.5, 9, 7.5, 1.5);
  ctx.fill();
  const pg = ctx.createLinearGradient(6, 4, 14, 10.5);
  pg.addColorStop(0, '#7FE3F5');
  pg.addColorStop(1, '#2BA8D8');
  ctx.fillStyle = pg;
  roundRectPath(ctx, 6.5, 4.5, 7, 5.5, 1);
  ctx.fill();

  // Ground floor: white volume
  box(ctx, -11, -8, 16, 15, 0, 6, { top: '#F4F5F7', south: '#E6E8EC', east: '#C9CDD4' });
  // Glass sliding wall
  southWindow(ctx, 7, -9.5, 0.6, 9, 4.6, night ? win.lit : 'rgba(120, 165, 205, 0.9)');
  // Upper floor: colored cantilever volume offset east
  box(ctx, -7, -9, 15, 10, 6, 5.5, { top: mix(p.main, '#FFFFFF', 0.2), south: p.main, east: p.roofDark });
  southWindow(ctx, 1, -5, 7.2, 10.5, 2.8, night ? win.lit : 'rgba(200, 228, 250, 0.95)');
  eastWindow(ctx, 8, -7, 7.2, 5, 2.8, night ? win.litDim : 'rgba(160, 195, 225, 0.95)');
  // Solar panels on top
  for (let i = 0; i < 3; i++) {
    poly(ctx, [[-5.5 + i * 4.3, -7.8, 11.55], [-2 + i * 4.3, -7.8, 11.55], [-2 + i * 4.3, -2.8, 11.55], [-5.5 + i * 4.3, -2.8, 11.55]], '#2A3B5C', 'rgba(255,255,255,0.35)', 0.4);
  }
  // Timber deck strip
  poly(ctx, [[-11, 7, 0.05], [5, 7, 0.05], [5, 9.5, 0.05], [-11, 9.5, 0.05]], '#C8935E');
}

function modernApartment(ctx: CanvasRenderingContext2D, p: ArtPalette, night: boolean, seed: number) {
  const win = windowColors(night);
  const h = 20;
  groundShadow(ctx, -12, -10, 24, 20, h, 'rgba(20, 22, 30, 0.24)');
  // L-shaped plan: west wing + north wing
  const facade = '#EEF0F3';
  const side = '#C6CBD3';
  box(ctx, -12, -10, 24, 9, 0, h, { top: '#DADFE5', south: facade, east: side }); // north wing
  box(ctx, -12, -1, 10, 11, 0, h - 6.5, { top: '#DADFE5', south: facade, east: side }); // west wing (lower)

  // North wing facade: full-height glass strip with colored frames
  const floorsN = 3;
  const fh = h / floorsN;
  for (let f = 0; f < floorsN; f++) {
    const z = f * fh;
    for (let i = 0; i < 2; i++) {
      const lit = !night || hashRand(seed, f * 5 + i) > 0.3;
      southWindow(ctx, -1, -1.5 + i * 6.8, z + 1, 5.6, fh - 2, lit ? (night ? win.lit : 'rgba(130, 175, 215, 0.95)') : win.dark);
    }
    // Glass balcony rail in brand color
    poly(ctx, [[-1.8, -0.5, z + 0.2], [12, -0.5, z + 0.2], [12, -0.5, z + 1.8], [-1.8, -0.5, z + 1.8]], rgba(p.main, 0.85));
    for (let i = 0; i < 3; i++) {
      const lit = !night || hashRand(seed, 30 + f * 5 + i) > 0.4;
      eastWindow(ctx, 12, -9 + i * 2.6, z + 1.2, 2, fh - 2.4, lit ? (night ? win.litDim : 'rgba(110, 150, 190, 0.95)') : win.dark);
    }
  }
  // West wing facade
  const floorsW = 2;
  for (let f = 0; f < floorsW; f++) {
    const z = f * fh;
    southWindow(ctx, 10, -11, z + 1, 8, fh - 2.2, night && hashRand(seed, 70 + f) < 0.3 ? win.dark : night ? win.lit : 'rgba(130, 175, 215, 0.95)');
    poly(ctx, [[-12, 10.05, z + fh - 0.8], [-2, 10.05, z + fh - 0.8], [-2, 10.05, z + fh], [-12, 10.05, z + fh]], p.main);
  }
  // Green roof garden on west wing
  poly(ctx, [[-11, 0, h - 6.45], [-3, 0, h - 6.45], [-3, 9, h - 6.45], [-11, 9, h - 6.45]], '#6CC685');
  for (let i = 0; i < 4; i++) {
    const [bx, by] = proj([-9.5 + (i % 2) * 4.5, 2 + Math.floor(i / 2) * 4, h - 6.4]);
    ctx.fillStyle = i % 2 ? '#2F9C5A' : '#3FB46B';
    ctx.beginPath();
    ctx.arc(bx, by, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // North-wing roof: brand-color accent band + solar
  poly(ctx, [[-12, -10, h + 0.02], [12, -10, h + 0.02], [12, -8.5, h + 0.02], [-12, -8.5, h + 0.02]], p.main);
  for (let i = 0; i < 4; i++) {
    poly(ctx, [[-8 + i * 5, -7.5, h + 0.05], [-4.5 + i * 5, -7.5, h + 0.05], [-4.5 + i * 5, -2.5, h + 0.05], [-8 + i * 5, -2.5, h + 0.05]], '#2A3B5C', 'rgba(255,255,255,0.3)', 0.4);
  }
}

function modernHighRise(ctx: CanvasRenderingContext2D, p: ArtPalette, night: boolean, seed: number, t: number) {
  const win = windowColors(night);
  const ph = 4;
  const tx = -9, ty = -8, tw = 18, td = 15, th = 36;
  groundShadow(ctx, tx, ty, tw, td, th + ph, 'rgba(15, 20, 35, 0.27)');
  // Landscaped plaza podium
  box(ctx, -13.5, -11, 27, 22, 0, ph, { top: '#E5E9EE', south: '#B9C0CA', east: '#9DA6B2' });
  poly(ctx, [[-12.5, 7.5, ph + 0.02], [-6, 7.5, ph + 0.02], [-6, 10, ph + 0.02], [-12.5, 10, ph + 0.02]], '#6CC685');
  poly(ctx, [[6, 7.5, ph + 0.02], [12.5, 7.5, ph + 0.02], [12.5, 10, ph + 0.02], [6, 10, ph + 0.02]], '#6CC685');

  // Tapered glass shaft drawn as 3 stacked volumes with slight setbacks
  const sections = [
    { inset: 0, h: 13 },
    { inset: 1.2, h: 9 },
    { inset: 2.4, h: 6 },
  ];
  let z = ph;
  sections.forEach((s, si) => {
    const x = tx + s.inset, y = ty + s.inset, w = tw - s.inset * 2, d = td - s.inset * 2;
    const [g0x, g0y] = proj([x, y + d, z]);
    const [, g1y] = proj([x, y + d, z + s.h]);
    const sg = ctx.createLinearGradient(g0x, g0y, g0x + w * 0.6, g1y);
    if (night) {
      sg.addColorStop(0, '#16213A');
      sg.addColorStop(1, '#2A3A60');
    } else {
      sg.addColorStop(0, '#5E86B5');
      sg.addColorStop(0.5, '#A9CBEA');
      sg.addColorStop(1, '#E6F3FF');
    }
    const eg = ctx.createLinearGradient(g0x, g0y, g0x, g1y);
    eg.addColorStop(0, night ? '#0F1729' : '#3E5F86');
    eg.addColorStop(1, night ? '#1A2541' : '#7FA3C9');
    box(ctx, x, y, w, d, z, s.h, { top: '#D8DEE6', south: sg, east: eg });
    // Floor lines + lit offices
    const floors = Math.round(s.h / 2.6);
    const fh = s.h / floors;
    for (let f = 0; f < floors; f++) {
      const fz = z + f * fh;
      poly(ctx, [[x, y + d + 0.06, fz], [x + w, y + d + 0.06, fz], [x + w, y + d + 0.06, fz + 0.3], [x, y + d + 0.06, fz + 0.3]], 'rgba(255,255,255,0.28)');
      if (night) {
        for (let i = 0; i < 4; i++) {
          if (hashRand(seed, si * 100 + f * 6 + i) > 0.5) {
            southWindow(ctx, y + d, x + 0.6 + i * (w / 4), fz + 0.5, w / 4 - 1.2, fh - 0.9, win.lit);
          }
          if (hashRand(seed, 500 + si * 100 + f * 6 + i) > 0.6) {
            eastWindow(ctx, x + w, y + 0.6 + i * (d / 4), fz + 0.5, d / 4 - 1.2, fh - 0.9, win.litDim);
          }
        }
      }
    }
    // Brand-color LED band at each setback
    poly(ctx, [[x, y + d + 0.1, z + s.h - 0.8], [x + w, y + d + 0.1, z + s.h - 0.8], [x + w, y + d + 0.1, z + s.h], [x, y + d + 0.1, z + s.h]], p.main);
    poly(ctx, [[x + w + 0.1, y, z + s.h - 0.8], [x + w + 0.1, y + d, z + s.h - 0.8], [x + w + 0.1, y + d, z + s.h], [x + w + 0.1, y, z + s.h]], p.roofDark);
    z += s.h;
  });
  // Diagonal sky reflection streak across the shaft (day only)
  if (!night) {
    poly(ctx, [[tx + 3, ty + td + 0.15, ph + 4], [tx + 6, ty + td + 0.15, ph + 4], [tx + 12, ty + td + 0.15, ph + 16], [tx + 9, ty + td + 0.15, ph + 16]], 'rgba(255,255,255,0.28)');
  }
  // Helipad roof
  const top = sections[2];
  const cx = 0, cy = ty + top.inset + (td - top.inset * 2) / 2;
  const [hx, hy] = proj([cx, cy, z + 0.05]);
  ctx.fillStyle = '#3A4252';
  ctx.beginPath();
  ctx.ellipse(hx, hy, 5.2, 4.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = p.main;
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 5px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', hx, hy + 0.3);
  // Corner beacons
  const blink = (Math.sin(t * 4 + seed) + 1) / 2;
  ctx.fillStyle = `rgba(255, 70, 60, ${0.35 + blink * 0.65})`;
  for (const [bx, by] of [[tx + top.inset, ty + top.inset], [tx + tw - top.inset, ty + td - top.inset]]) {
    const [px, py] = proj([bx, by, z]);
    ctx.beginPath();
    ctx.arc(px, py, 1.2 + blink * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ============================================================================
// Public entry point
// ============================================================================
export function drawResidential(
  ctx: CanvasRenderingContext2D,
  style: ArtStyle,
  tier: 1 | 2 | 3,
  palette: ArtPalette,
  night: boolean,
  seed: number,
  time: number
) {
  ctx.save();
  ctx.lineJoin = 'round';
  if (style === 'diorama') {
    if (tier === 1) dioramaHouse(ctx, palette, night, seed);
    else if (tier === 2) dioramaApartment(ctx, palette, night, seed);
    else dioramaHighRise(ctx, palette, night, seed, time);
  } else if (style === 'clay') {
    if (tier === 1) clayHouse(ctx, palette, night);
    else if (tier === 2) clayApartment(ctx, palette, night, seed);
    else clayHighRise(ctx, palette, night, seed, time);
  } else {
    if (tier === 1) modernHouse(ctx, palette, night);
    else if (tier === 2) modernApartment(ctx, palette, night, seed);
    else modernHighRise(ctx, palette, night, seed, time);
  }
  ctx.restore();
}

// ============================================================================
// EARLY "STORE ABOUT TO GO BUST" WARNING FX
// ============================================================================
export type StoreAlertStage = 'calm' | 'heads-up' | 'overflowing' | 'critical';

/**
 * stage:
 *  - heads-up    : pins are 1 away from starting the overflow clock
 *  - overflowing : overflow clock running (< 65%)
 *  - critical    : overflow clock > 65%
 * progress: overflow clock 0..1
 * (cx, cy, halfW, halfH): the store's lot rectangle (world px, centered)
 */
export function drawStoreAlert(
  ctx: CanvasRenderingContext2D,
  stage: StoreAlertStage,
  progress: number,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  time: number,
  layer: 'under' | 'over' | 'both' = 'both'
) {
  if (stage === 'calm') return;
  ctx.save();
  const drawUnder = layer !== 'over';
  const drawOver = layer !== 'under';

  const amber = '#F5A623';
  const red = '#FF3B30';
  const color = stage === 'critical' ? red : amber;
  const pulseSpeed = stage === 'critical' ? 9 : stage === 'overflowing' ? 5 : 2.6;
  const pulse = (Math.sin(time * pulseSpeed) + 1) / 2;

  // 1. Ground glow under the lot
  if (drawUnder) {
  const glowR = Math.max(halfW, halfH) * (1.25 + pulse * 0.12);
  const glow = ctx.createRadialGradient(cx, cy, Math.max(halfW, halfH) * 0.5, cx, cy, glowR);
  glow.addColorStop(0, rgba(color === red ? '#FF3B30' : '#F5A623', stage === 'heads-up' ? 0.16 : 0.32));
  glow.addColorStop(1, rgba(color === red ? '#FF3B30' : '#F5A623', 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
  ctx.fill();

  // 2. Sonar ripples (critical only)
  if (stage === 'critical') {
    for (let k = 0; k < 2; k++) {
      const ph = ((time * 1.4 + k * 0.5) % 1);
      ctx.strokeStyle = rgba('#FF3B30', (1 - ph) * 0.7);
      ctx.lineWidth = 3 * (1 - ph) + 0.5;
      roundRectPath(ctx, cx - halfW - ph * 22, cy - halfH - ph * 22, (halfW + ph * 22) * 2, (halfH + ph * 22) * 2, 14 + ph * 10);
      ctx.stroke();
    }
  }
  }

  if (!drawOver) {
    ctx.restore();
    return;
  }

  // 3. Perimeter countdown ring tracing the lot outline
  const pad = 5;
  const rx = cx - halfW - pad, ry = cy - halfH - pad, rw = (halfW + pad) * 2, rh = (halfH + pad) * 2;
  const r = 14;
  const perim = 2 * (rw + rh) - (8 - 2 * Math.PI) * r;
  if (stage === 'heads-up') {
    ctx.strokeStyle = rgba('#F5A623', 0.55 + pulse * 0.35);
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 6]);
    ctx.lineDashOffset = -time * 14;
    roundRectPath(ctx, rx, ry, rw, rh, r);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // track
    ctx.strokeStyle = 'rgba(40, 44, 52, 0.35)';
    ctx.lineWidth = 5;
    roundRectPath(ctx, rx, ry, rw, rh, r);
    ctx.stroke();
    // fill (remaining time drains)
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.setLineDash([perim * progress, perim]);
    ctx.lineDashOffset = 0;
    ctx.beginPath();
    // start at top-center, clockwise
    ctx.moveTo(cx, ry);
    ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, r);
    ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, r);
    ctx.arcTo(rx, ry + rh, rx, ry, r);
    ctx.arcTo(rx, ry, rx + rw, ry, r);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 4. Floating alert bubble above the store
  const bob = Math.sin(time * (stage === 'critical' ? 10 : 4)) * (stage === 'critical' ? 2.5 : 1.8);
  const bx = cx;
  const by = ry - 18 + bob;
  const s = stage === 'critical' ? 1 + pulse * 0.15 : 1;
  ctx.save();
  ctx.translate(bx, by);
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.arc(1, 2, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.moveTo(-5, 8);
  ctx.lineTo(0, 15);
  ctx.lineTo(5, 8);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 12px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(stage === 'heads-up' ? '!' : stage === 'overflowing' ? '!!' : '!!!', 0, 0.5);
  ctx.restore();

  ctx.restore();
}

/** Screen-edge arrow that points to an off-screen store in trouble. */
export function drawOffscreenArrow(
  ctx: CanvasRenderingContext2D,
  screenW: number,
  screenH: number,
  targetX: number,
  targetY: number,
  critical: boolean,
  time: number
) {
  const margin = 28;
  const cx = screenW / 2, cy = screenH / 2;
  const dx = targetX - cx, dy = targetY - cy;
  const scale = Math.min((cx - margin) / Math.abs(dx || 1e-6), (cy - margin) / Math.abs(dy || 1e-6));
  const ax = cx + dx * scale;
  const ay = cy + dy * scale;
  const ang = Math.atan2(dy, dx);
  const pulse = 1 + Math.sin(time * (critical ? 10 : 5)) * 0.12;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.scale(pulse, pulse);
  ctx.fillStyle = critical ? '#FF3B30' : '#F5A623';
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(19, 0);
  ctx.lineTo(10, -7);
  ctx.lineTo(10, 7);
  ctx.closePath();
  ctx.fill();
  ctx.rotate(-ang);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 13px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', 0, 1);
  ctx.restore();
}

// ============================================================================
// 4. SURFACE COMMUTER TRAIN — 3D LOW-POLY DIORAMA MODEL
// ============================================================================

/**
 * 3D Low-Poly Surface Commuter Train Coach / Locomotive matching Design A (Diorama).
 *
 * Coordinates are centered at (0, 0) for the car body.
 * Moving in +x direction (Eastbound).
 * - Car 0: Lead aerodynamic locomotive with raked nose, cockpit windshield, twin headlights (+ night cone), pantograph.
 * - Cars 1..(totalCars-2): Intermediate passenger coaches with steel bogies, panoramic window bays with commuter silhouettes.
 * - Car (totalCars-1): Trailing passenger coach with rear red marker taillights.
 * - Inter-car accordion rubber gangways connecting adjacent coaches.
 */
export function drawDioramaTrainCar(
  ctx: CanvasRenderingContext2D,
  carIndex: number,
  totalCars: number,
  night: boolean,
  _time = 0,
  accentColor = '#E84855'
) {
  const isLead = carIndex === 0;
  const isTail = carIndex === totalCars - 1;
  const hasCarBehind = !isTail;

  const carW = 34; // body length (x: -17 to +17)
  const carD = 13; // body depth (y: -6.5 to +6.5)
  const halfW = carW / 2;
  const halfD = carD / 2;

  // 1. Soft Ground Drop Shadow (projected SE)
  const shadowX = -halfW;
  const shadowW = isLead ? carW + 4.5 : carW;
  const shadowColor = night ? 'rgba(5, 8, 16, 0.45)' : 'rgba(15, 23, 42, 0.28)';
  groundShadow(ctx, shadowX, -halfD, shadowW, carD, 9.5, shadowColor);

  // 2. Inter-car Accordion Gangway (Bellows) to the car behind (-x direction)
  if (hasCarBehind) {
    const gwX = -halfW - 4; // spans from -21 to -17
    const gwW = 4;
    const gwD = 9;
    const gwH = 6.2;
    const gwZ = 2.4;
    // Bellows box
    box(ctx, gwX, -gwD / 2, gwW, gwD, gwZ, gwH, {
      top: '#1E293B',
      south: '#0F172A',
      east: '#1E293B',
    });
    // Pleat ribs on south face
    for (let px = gwX + 1.2; px < -halfW; px += 1.4) {
      poly(
        ctx,
        [
          [px, gwD / 2 + 0.1, gwZ],
          [px + 0.5, gwD / 2 + 0.1, gwZ],
          [px + 0.5, gwD / 2 + 0.1, gwZ + gwH],
          [px, gwD / 2 + 0.1, gwZ + gwH],
        ],
        '#334155'
      );
    }
  }

  // 3. Steel Bogies & Flanged Wheels (z = 0 to 2.2)
  const bogieCenters = isLead ? [-9, 8] : [-9, 9];
  for (const bx of bogieCenters) {
    // Bogie truck frame
    box(ctx, bx - 5, -5, 10, 10, 0.4, 1.4, {
      top: '#1E293B',
      south: '#0F172A',
      east: '#1E293B',
    });

    // Flanged steel wheels on South track rail (y = 4.2)
    for (const wx of [bx - 3.2, bx + 3.2]) {
      const [wpX, wpY] = proj([wx, 4.6, 1.1]);
      ctx.save();
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.arc(wpX, wpY, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#64748B';
      ctx.beginPath();
      ctx.arc(wpX, wpY, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#CBD5E1';
      ctx.beginPath();
      ctx.arc(wpX, wpY, 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Undercarriage machinery / battery crate enclosure between bogies
  box(ctx, -4.5, -4.5, 9, 9, 0.2, 1.8, {
    top: '#0F172A',
    south: '#0F172A',
    east: '#1E293B',
  });
  // Cooling louver slits on battery crate
  for (let lz = 0.5; lz <= 1.5; lz += 0.5) {
    const [p0x, p0y] = proj([-3.5, 4.55, lz]);
    const [p1x, p1y] = proj([3.5, 4.55, lz]);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(p0x, p0y);
    ctx.lineTo(p1x, p1y);
    ctx.stroke();
  }

  // 4. Main Carriage Body (z = 2.2 to 9.2)
  const bodyH = 7.0;
  const bodyZ = 2.2;
  const topColor = night ? '#64748B' : '#E2E8F0';
  const southColor = night ? '#334155' : '#F8FAFC';
  const eastColor = night ? '#1E293B' : '#CBD5E1';
  const westColor = night ? '#0F172A' : '#94A3B8';

  if (!isLead) {
    // Standard Coach Main Box
    box(ctx, -halfW, -halfD, carW, carD, bodyZ, bodyH, {
      top: topColor,
      south: southColor,
      east: eastColor,
      edge: night ? '#1E293B' : '#CBD5E1',
    });

    // If rear car, draw flat back wall at x = -halfW
    if (isTail) {
      poly(
        ctx,
        [
          [-halfW, -halfD, bodyZ],
          [-halfW, halfD, bodyZ],
          [-halfW, halfD, bodyZ + bodyH],
          [-halfW, -halfD, bodyZ + bodyH],
        ],
        westColor
      );
    }
  } else {
    // Lead Locomotive: Main Cabin Box (x from -halfW to halfW - 3)
    const cabBackW = carW - 3;
    box(ctx, -halfW, -halfD, cabBackW, carD, bodyZ, bodyH, {
      top: topColor,
      south: southColor,
      east: eastColor,
      edge: night ? '#1E293B' : '#CBD5E1',
    });

    // Aerodynamic Sloped Nose Wedge from x = halfW - 3 (= 14) to x = halfW + 4.5 (= 21.5)
    const noseX0 = halfW - 3;
    const noseX1 = halfW + 4.5;
    const noseLowZ = 3.6;
    const noseHighZ = bodyZ + bodyH; // 9.2

    // Sloping Hood Roof: [noseX0, -halfD, 9.2] to [noseX1, -halfD, 3.6] to [noseX1, halfD, 3.6] to [noseX0, halfD, 9.2]
    poly(
      ctx,
      [
        [noseX0, -halfD, noseHighZ],
        [noseX1, -halfD, noseLowZ],
        [noseX1, halfD, noseLowZ],
        [noseX0, halfD, noseHighZ],
      ],
      topColor,
      night ? '#1E293B' : '#CBD5E1'
    );

    // South Facade of Nose: [noseX0, halfD, 2.2] to [noseX1, halfD, 2.2] to [noseX1, halfD, 3.6] to [noseX0, halfD, 9.2]
    poly(
      ctx,
      [
        [noseX0, halfD, bodyZ],
        [noseX1, halfD, bodyZ],
        [noseX1, halfD, noseLowZ],
        [noseX0, halfD, noseHighZ],
      ],
      southColor,
      night ? '#1E293B' : '#CBD5E1'
    );

    // Front Bumper Face (at noseX1)
    poly(
      ctx,
      [
        [noseX1, -halfD, bodyZ],
        [noseX1, halfD, bodyZ],
        [noseX1, halfD, noseLowZ],
        [noseX1, -halfD, noseLowZ],
      ],
      night ? '#0F172A' : '#1E293B'
    );
  }

  // 5. Lower Skirt & Bold Livery Accent Stripe
  // Lower dark skirt (z = 2.2 to 3.4)
  const skirtW = isLead ? carW + 4.5 : carW;
  southWindow(ctx, halfD, -halfW, bodyZ, skirtW, 1.2, night ? '#0F172A' : '#334155');

  // Bold Express Transit Stripe (z = 4.0 to 5.2)
  const stripeW = isLead ? carW + 3.5 : carW;
  southWindow(ctx, halfD, -halfW, 4.0, stripeW, 1.2, accentColor);
  // Crisp pinstripes
  southWindow(ctx, halfD, -halfW, 3.9, stripeW, 0.25, '#1E293B');
  southWindow(ctx, halfD, -halfW, 5.2, stripeW, 0.25, '#1E293B');

  // 6. Windows & Interior Commuters
  if (!isLead) {
    // 4 Panoramic Passenger Window Bays on South Facade (z = 5.6 to 8.2)
    const winW = 5.2;
    const winH = 2.6;
    const winZ = 5.6;
    const windowXPositions = [-12, -5, 2, 9];

    for (let i = 0; i < windowXPositions.length; i++) {
      const wx = windowXPositions[i];

      if (night) {
        // Warm glowing golden passenger window
        southWindow(ctx, halfD, wx, winZ, winW, winH, '#FFEAA7');
        // Inner warm halo
        southWindow(ctx, halfD, wx + 0.5, winZ + 0.4, winW - 1.0, winH - 0.8, '#FDE047');

        // Commuter silhouettes inside!
        ctx.save();
        ctx.fillStyle = '#1E293B';
        const [cHeadX, cHeadY] = proj([wx + 2.6, halfD + 0.08, winZ + 1.7]);
        if (i === 0) {
          // Seated commuter reading
          ctx.beginPath();
          ctx.arc(cHeadX - 0.7, cHeadY, 1.0, 0, Math.PI * 2);
          ctx.fill();
          // Torso
          const [t0x, t0y] = proj([wx + 1.0, halfD + 0.08, winZ]);
          const [t1x, t1y] = proj([wx + 3.0, halfD + 0.08, winZ + 1.1]);
          ctx.fillRect(Math.min(t0x, t1x), t1y, Math.abs(t1x - t0x) + 1.2, Math.abs(t0y - t1y));
        } else if (i === 1) {
          // Standing commuter holding strap
          ctx.beginPath();
          ctx.arc(cHeadX, cHeadY - 0.5, 0.95, 0, Math.PI * 2);
          ctx.fill();
          const [s0x, s0y] = proj([wx + 1.8, halfD + 0.08, winZ]);
          const [s1x, s1y] = proj([wx + 3.4, halfD + 0.08, winZ + 1.3]);
          ctx.fillRect(Math.min(s0x, s1x), s1y, Math.abs(s1x - s0x) + 0.8, Math.abs(s0y - s1y));
        } else if (i === 2) {
          // Pair of commuters chatting
          ctx.beginPath();
          ctx.arc(cHeadX - 1.2, cHeadY, 0.85, 0, Math.PI * 2);
          ctx.arc(cHeadX + 1.2, cHeadY - 0.2, 0.85, 0, Math.PI * 2);
          ctx.fill();
          const [p0x, p0y] = proj([wx + 0.8, halfD + 0.08, winZ]);
          const [p1x, p1y] = proj([wx + 4.4, halfD + 0.08, winZ + 1.0]);
          ctx.fillRect(Math.min(p0x, p1x), p1y, Math.abs(p1x - p0x) + 1.0, Math.abs(p0y - p1y));
        } else {
          // Commuter with laptop
          ctx.beginPath();
          ctx.arc(cHeadX + 0.5, cHeadY, 0.9, 0, Math.PI * 2);
          ctx.fill();
          const [l0x, l0y] = proj([wx + 1.5, halfD + 0.08, winZ]);
          const [l1x, l1y] = proj([wx + 3.8, halfD + 0.08, winZ + 1.1]);
          ctx.fillRect(Math.min(l0x, l1x), l1y, Math.abs(l1x - l0x) + 1.0, Math.abs(l0y - l1y));
        }
        ctx.restore();
      } else {
        // Daytime tinted reflective glass
        southWindow(ctx, halfD, wx, winZ, winW, winH, '#CBD5E1');
        // Crisp window frame border
        poly(
          ctx,
          [
            [wx, halfD + 0.06, winZ],
            [wx + winW, halfD + 0.06, winZ],
            [wx + winW, halfD + 0.06, winZ + winH],
            [wx, halfD + 0.06, winZ + winH],
          ],
          'transparent',
          '#334155',
          0.6
        );
        // Diagonal glass glare slash
        const [gl0x, gl0y] = proj([wx + 1.2, halfD + 0.07, winZ + 0.4]);
        const [gl1x, gl1y] = proj([wx + 3.8, halfD + 0.07, winZ + winH - 0.4]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(gl0x, gl0y);
        ctx.lineTo(gl1x, gl1y);
        ctx.stroke();
      }
    }

    // Recessed passenger sliding door seams
    for (const dx of [-15.2, 14.8]) {
      const [d0x, d0y] = proj([dx, halfD + 0.06, bodyZ]);
      const [d1x, d1y] = proj([dx, halfD + 0.06, winZ + winH + 0.4]);
      ctx.strokeStyle = night ? '#1E293B' : '#94A3B8';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(d0x, d0y);
      ctx.lineTo(d1x, d1y);
      ctx.stroke();
    }
  } else {
    // Lead Locomotive: Driver's Panoramic Cockpit Windshield (on sloping front/side)
    const cwZ = 5.8;
    const cwH = 2.6;
    // Side cabin window
    southWindow(ctx, halfD, 5, cwZ, 7, cwH, night ? '#FDE047' : '#93C5FD');
    poly(
      ctx,
      [
        [5, halfD + 0.06, cwZ],
        [12, halfD + 0.06, cwZ],
        [12, halfD + 0.06, cwZ + cwH],
        [5, halfD + 0.06, cwZ + cwH],
      ],
      'transparent',
      '#1E293B',
      0.6
    );

    // Front raked windshield on the sloping nose (x: 14 to 18.5)
    poly(
      ctx,
      [
        [14.2, -halfD + 1.5, 9.0],
        [18.5, -halfD + 1.5, 6.2],
        [18.5, halfD - 1.5, 6.2],
        [14.2, halfD - 1.5, 9.0],
      ],
      night ? '#38BDF8' : '#0284C7',
      '#0F172A',
      0.8
    );

    // Cockpit driver silhouette inside
    const [drX, drY] = proj([8.5, halfD + 0.08, cwZ + 1.5]);
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.arc(drX, drY, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // 7. Roof Profile & Equipment
  // Crown roof panel (z = 9.2 to 10.2)
  const crownW = isLead ? carW - 5 : carW - 4;
  box(ctx, -halfW + 2, -halfD + 1.5, crownW, carD - 3, 9.2, 0.8, {
    top: night ? '#475569' : '#CBD5E1',
    south: night ? '#334155' : '#94A3B8',
    east: night ? '#1E293B' : '#64748B',
  });

  // Dual Rooftop HVAC Pods
  for (const acX of [-10, 2]) {
    box(ctx, acX, -3, 6, 6, 10.0, 0.9, {
      top: '#64748B',
      south: '#475569',
      east: '#334155',
    });
    // Louver lines on AC
    const [l0x, l0y] = proj([acX + 1, 3.05, 10.45]);
    const [l1x, l1y] = proj([acX + 5, 3.05, 10.45]);
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(l0x, l0y);
    ctx.lineTo(l1x, l1y);
    ctx.stroke();
  }

  // 8. Lead Locomotive Pantograph & Dual Headlights
  if (isLead) {
    // Diamond Articulated Pantograph (x = -4 to 2, z = 10.0 to 14.5)
    const pBaseZ = 10.2;
    const pMidZ = 12.6;
    const pTopZ = 14.4;
    ctx.save();
    ctx.strokeStyle = night ? '#94A3B8' : '#475569';
    ctx.lineWidth = 0.9;
    // Lower diagonal arms
    const [p0x, p0y] = proj([-3, 0, pBaseZ]);
    const [p1x, p1y] = proj([-0.5, 0, pMidZ]);
    const [p2x, p2y] = proj([2, 0, pBaseZ]);
    ctx.beginPath();
    ctx.moveTo(p0x, p0y);
    ctx.lineTo(p1x, p1y);
    ctx.lineTo(p2x, p2y);
    ctx.stroke();
    // Upper diagonal arms to collector shoe
    const [ptx, pty] = proj([0.5, 0, pTopZ]);
    ctx.beginPath();
    ctx.moveTo(p1x, p1y);
    ctx.lineTo(ptx, pty);
    ctx.stroke();
    // Horizontal collector shoe (copper)
    const [s0x, s0y] = proj([-1.5, -3.5, pTopZ]);
    const [s1x, s1y] = proj([2.5, 3.5, pTopZ]);
    ctx.strokeStyle = '#D97706'; // copper wear bar
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(s0x, s0y);
    ctx.lineTo(s1x, s1y);
    ctx.stroke();
    ctx.restore();

    // Twin High-Intensity Xenon Headlights at nose tip (x = 21.5, y = ±3.2, z = 3.6)
    for (const hy of [-3.2, 3.2]) {
      const [hlX, hlY] = proj([21.6, hy, 3.8]);
      ctx.save();
      // Chrome bezel ring
      ctx.fillStyle = '#CBD5E1';
      ctx.beginPath();
      ctx.arc(hlX, hlY, 1.8, 0, Math.PI * 2);
      ctx.fill();
      // Xenon bright core
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(hlX, hlY, 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // NIGHT HEADLIGHT BEAM CONE:
    // Cast expansive glowing beam eastward across the tracks
    if (night) {
      const [beamOriginX, beamOriginY] = proj([21.6, 0, 3.8]);
      const beamLen = 54;
      const [beamTipTopX, beamTipTopY] = proj([21.6 + beamLen, -15, 0]);
      const [beamTipBotX, beamTipBotY] = proj([21.6 + beamLen, 15, 0]);

      ctx.save();
      const grad = ctx.createLinearGradient(beamOriginX, beamOriginY, beamOriginX + beamLen * 1.1, beamOriginY);
      grad.addColorStop(0, 'rgba(255, 255, 230, 0.46)');
      grad.addColorStop(0.3, 'rgba(255, 255, 210, 0.28)');
      grad.addColorStop(0.7, 'rgba(255, 255, 190, 0.12)');
      grad.addColorStop(1, 'rgba(255, 255, 180, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(beamOriginX, beamOriginY);
      ctx.lineTo(beamTipTopX, beamTipTopY);
      ctx.lineTo(beamTipBotX, beamTipBotY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // 9. Trailing Coach Red Marker Tail Lights
  if (isTail) {
    for (const ty of [-3.5, 3.5]) {
      const [tlX, tlY] = proj([-halfW - 0.1, ty, 4.6]);
      ctx.save();
      if (night) {
        // Red glowing halo
        ctx.fillStyle = 'rgba(239, 68, 68, 0.38)';
        ctx.beginPath();
        ctx.arc(tlX, tlY, 3.8, 0, Math.PI * 2);
        ctx.fill();
      }
      // Ruby LED marker dot
      ctx.fillStyle = night ? '#EF4444' : '#DC2626';
      ctx.beginPath();
      ctx.arc(tlX, tlY, 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

/**
 * Renders an entire multi-car Commuter Train at given head world coordinates.
 */
export function drawDioramaTrain(
  ctx: CanvasRenderingContext2D,
  headX: number,
  headY: number,
  carCount: number,
  night: boolean,
  time = 0,
  accentColor = '#E84855'
) {
  const carSpacing = 38; // 34px car length + 4px bellows gap
  // Render from tail to lead (reverse painter's algorithm)
  for (let c = carCount - 1; c >= 0; c--) {
    const cx = headX - c * carSpacing;
    const cy = headY;
    ctx.save();
    ctx.translate(cx, cy);
    drawDioramaTrainCar(ctx, c, carCount, night, time, accentColor);
    ctx.restore();
  }
}

