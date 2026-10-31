import { CONFIG } from './config';
import {
  drawResidential,
  drawStoreAlert,
  drawOffscreenArrow,
  drawDioramaTrainCar,
  drawDioramaTrain,
  ArtStyle,
  ArtPalette,
  StoreAlertStage,
  dioramaStore,
  dioramaCircularHub,
  dioramaTrainStation,
} from './buildingArt';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const W = 1560;
const H = 3450;
const dpr = window.devicePixelRatio || 1;
canvas.width = W * dpr;
canvas.height = H * dpr;
canvas.style.width = `${W}px`;
canvas.style.height = `${H}px`;

let night = new URLSearchParams(location.search).has('night');
let animating = true;
let time = 1.3;
document.getElementById('toggleNight')!.onclick = () => (night = !night);
document.getElementById('toggleAnim')!.onclick = (e) => {
  animating = !animating;
  (e.target as HTMLButtonElement).textContent = animating ? 'Pause Animation' : 'Play Animation';
};

const PAL = CONFIG.COLORS.BUILDINGS as Record<string, ArtPalette>;
const TILE = CONFIG.TILE_SIZE;

const STYLES: { id: ArtStyle; name: string; blurb: string }[] = [
  { id: 'diorama', name: 'A · Diorama', blurb: 'Crisp low-poly blocks, real gabled roofs, balconies, rooftop props' },
  { id: 'clay', name: 'B · Clay Toy', blurb: 'Soft rounded volumes, gradients, terraced planters, round tower' },
  { id: 'modern', name: 'C · Modern', blurb: 'White + timber villas, green roofs, solar, glass skyscraper' },
];

function lot(x: number, y: number, palette: ArtPalette, isNight: boolean) {
  ctx.fillStyle = isNight ? '#222B3B' : palette.lot;
  ctx.beginPath();
  ctx.roundRect(x - TILE * 0.44, y - TILE * 0.4, TILE * 0.88, TILE * 0.8, 7);
  ctx.fill();
}

function text(s: string, x: number, y: number, size: number, weight = 800, color = '#2C313A', align: CanvasTextAlign = 'left') {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px "Plus Jakarta Sans", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

function drawBuilding(style: ArtStyle, tier: 1 | 2 | 3, color: string, x: number, y: number, zoom: number, isNight: boolean, seed: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(zoom, zoom);
  lot(0, 0, PAL[color], isNight);
  drawResidential(ctx, style, tier, PAL[color], isNight, seed, time);
  ctx.restore();
}

/** Mini neighbourhood at true in-game scale (1 tile = 44px). */
function drawNeighbourhood(style: ArtStyle, ox: number, oy: number, isNight: boolean) {
  const cols = 9, rows = 3;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = isNight ? '#1A2130' : '#F2EEDF';
  ctx.beginPath();
  ctx.roundRect(0, 0, cols * TILE, rows * TILE + 8, 10);
  ctx.fill();
  // road along the bottom row
  ctx.strokeStyle = isNight ? '#3A4256' : '#5D6470';
  ctx.lineWidth = TILE * 0.48;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(TILE * 0.5, TILE * 2.5);
  ctx.lineTo(TILE * (cols - 0.5), TILE * 2.5);
  ctx.stroke();
  const layout: [number, 1 | 2 | 3, string][] = [
    [0, 1, 'red'], [1, 2, 'red'], [2, 1, 'blue'], [3, 3, 'blue'], [4, 1, 'yellow'],
    [5, 2, 'green'], [6, 3, 'purple'], [7, 1, 'green'], [8, 2, 'yellow'],
  ];
  for (const [c, tier, color] of layout) {
    ctx.save();
    ctx.translate((c + 0.5) * TILE, 1.5 * TILE);
    lot(0, 0, PAL[color], isNight);
    // driveway stub
    ctx.fillStyle = isNight ? '#3A4256' : '#5D6470';
    ctx.fillRect(-5, 8, 10, TILE * 0.6);
    drawResidential(ctx, style, tier, PAL[color], isNight, c * 13 + 7, time);
    ctx.restore();
  }
  ctx.restore();
}

/** Full destination compound with 2x2 lot, parking stalls, parked cars & 3D building. */
function drawDestinationCompound(
  type: 'store' | 'circular' | 'station',
  color: string,
  x: number,
  y: number,
  zoom: number,
  isNight: boolean,
  critical = false,
  seed = 1
) {
  const p = PAL[color] || PAL.blue;
  const halfW = TILE - 2; // 42
  const halfH = TILE - 2; // 42

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(zoom, zoom);

  // 1. Lot base and shadow
  ctx.fillStyle = p.shadow;
  ctx.beginPath();
  ctx.roundRect(-halfW + 3, -halfH + 5, halfW * 2, halfH * 2, 12);
  ctx.fill();

  ctx.fillStyle = isNight ? '#222B3B' : p.lot;
  ctx.beginPath();
  ctx.roundRect(-halfW, -halfH, halfW * 2, halfH * 2, 12);
  ctx.fill();
  if (isNight) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // 2. Asphalt parking lot on south half
  const lotH = halfH - 5;
  const lotTop = 2;
  ctx.fillStyle = isNight ? '#3A4256' : '#5D6470';
  ctx.beginPath();
  ctx.roundRect(-halfW + 5, lotTop, (halfW - 5) * 2, lotH, 7);
  ctx.fill();

  // White parking stalls
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1.4;
  for (let s = -1; s <= 1; s++) {
    const sx = s * 16;
    ctx.beginPath();
    ctx.moveTo(sx, lotTop + 4);
    ctx.lineTo(sx, lotTop + lotH - 4);
    ctx.stroke();
  }

  // Draw 2 parked cars
  for (let c = 0; c < 2; c++) {
    const stallX = -15 + c * 30;
    const stallY = lotTop + lotH * 0.5;
    ctx.fillStyle = isNight ? '#E2E8F0' : PAL[c === 0 ? 'red' : 'yellow'].main;
    ctx.beginPath();
    ctx.roundRect(stallX - 4.5, stallY - 7, 9, 14, 2.5);
    ctx.fill();
    ctx.fillStyle = '#1E293B';
    ctx.beginPath();
    ctx.roundRect(stallX - 3.5, stallY - 3, 7, 6, 1.5);
    ctx.fill();
  }

  // 3. Draw the 3D Diorama destination building
  if (type === 'store') {
    dioramaStore(ctx, p, isNight, seed, time, false, critical);
  } else if (type === 'circular') {
    dioramaCircularHub(ctx, p, isNight, seed, time, false, critical);
  } else {
    dioramaTrainStation(ctx, p, isNight, seed, time, false);
  }

  ctx.restore();
}

/** Store demo with escalating alert FX. */
function drawStoreDemo(cx: number, cy: number, zoom: number, stage: StoreAlertStage, progress: number, pins: number, isNight: boolean) {
  const p = PAL.blue;
  const halfW = TILE - 2;
  const halfH = TILE / 2 - 2 + 22;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(zoom, zoom);

  // Critical: whole store gently shakes
  if (stage === 'critical') ctx.translate(Math.sin(time * 40) * 0.8, 0);

  drawStoreAlert(ctx, stage, progress, 0, 0, halfW, halfH, time);

  ctx.fillStyle = isNight ? '#222B3B' : p.lot;
  ctx.beginPath();
  ctx.roundRect(-halfW, -halfH, halfW * 2, halfH * 2, 12);
  ctx.fill();
  ctx.fillStyle = isNight ? '#3A4256' : '#5D6470';
  ctx.beginPath();
  ctx.roundRect(-halfW + 5, 4, halfW * 2 - 10, halfH - 9, 7);
  ctx.fill();

  // Render 3D Diorama Store with alert reaction
  dioramaStore(ctx, p, isNight, 42, time, false, stage === 'critical');

  // pins (jiggle harder as stage escalates)
  const jig = stage === 'critical' ? 2.4 : stage === 'overflowing' ? 1.4 : 0.6;
  for (let i = 0; i < pins; i++) {
    const col = i % 4, row = Math.floor(i / 4);
    const rc = Math.min(4, pins - row * 4);
    const px = -((rc - 1) * 17) / 2 + col * 17 + Math.sin(time * 18 + i) * (stage === 'calm' ? 0 : jig * 0.4);
    const py = -halfH + 16 + row * 15 + Math.sin(time * 3.5 + i * 0.9) * jig;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.main;
    ctx.beginPath();
    ctx.arc(px, py, 4.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function frame() {
  if (animating) time += 1 / 60;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = night ? '#141A26' : '#EDE6D6';
  ctx.fillRect(0, 0, W, H);
  const ink = night ? '#E8ECF3' : '#2C313A';
  const sub = night ? '#9AA5B8' : '#6B7280';

  // =========================================================================
  // 1. RESIDENTIAL BUILDINGS
  // =========================================================================
  text('Residential Buildings — 3 Art Directions', 40, 40, 26, 900, ink);
  text('House (2 cars)  ·  Apartment (4 cars)  ·  High-Rise (6 cars)   — shown at 2.7× zoom, then at true in-game size', 40, 70, 14, 600, sub);

  const colW = W / 3;
  STYLES.forEach((st, si) => {
    const x0 = si * colW;
    ctx.fillStyle = night ? '#1C2333' : '#F7F2E6';
    ctx.beginPath();
    ctx.roundRect(x0 + 16, 96, colW - 32, 940, 18);
    ctx.fill();
    text(st.name, x0 + 40, 128, 22, 900, ink);
    text(st.blurb, x0 + 40, 154, 12, 600, sub);

    const rows: [string, boolean][] = [['red', false], ['blue', false], ['green', true]];
    rows.forEach(([color, forceNight], ri) => {
      const isN = night || forceNight;
      const y = 300 + ri * 215;
      if (forceNight) {
        ctx.fillStyle = '#141A26';
        ctx.beginPath();
        ctx.roundRect(x0 + 28, y - 130, colW - 56, 200, 14);
        ctx.fill();
        text('NIGHT', x0 + 44, y - 112, 11, 800, '#9AA5B8');
      }
      ([1, 2, 3] as const).forEach((tier, ti) => {
        drawBuilding(st.id, tier, color, x0 + 105 + ti * 155, y + 10, 2.7, isN, si * 31 + ri * 7 + ti * 3 + 1);
      });
    });
    text('Actual size', x0 + 40, 860, 12, 800, sub);
    drawNeighbourhood(st.id, x0 + (colW - 9 * TILE) / 2, 840 - 0 + 28, night);
  });

  // =========================================================================
  // 2. COMMERCIAL & TRANSIT DESTINATIONS (Design A - Diorama)
  // =========================================================================
  const dy = 1060;
  ctx.fillStyle = night ? '#1C2333' : '#F7F2E6';
  ctx.beginPath();
  ctx.roundRect(16, dy, W - 32, 870, 18);
  ctx.fill();

  text('Commercial & Transit Destinations — Design A (Diorama)', 40, dy + 34, 22, 900, ink);
  text('3D Low-Poly Extruded Architecture: Superstore / Factory  ·  Circular High-Demand Hub  ·  Commuter Train Station', 40, dy + 62, 13, 600, sub);

  const destColumns: {
    type: 'store' | 'circular' | 'station';
    title: string;
    blurb: string;
    dayColor: string;
    nightColor: string;
  }[] = [
    {
      type: 'store',
      title: 'Commercial Superstore / Factory',
      blurb: 'Loading bay with roll-up corrugated door, canopy, rooftop HVAC & sawtooth skylights',
      dayColor: 'blue',
      nightColor: 'red',
    },
    {
      type: 'circular',
      title: 'Circular High-Demand Hub',
      blurb: 'Layered rotunda tiers, 360° clerestory ribbon, geodesic glass dome & entrance portal',
      dayColor: 'green',
      nightColor: 'yellow',
    },
    {
      type: 'station',
      title: 'Central Commuter Train Terminal',
      blurb: 'Arched train shed roof, trackside concrete platform, dual-face clock tower & glass ribs',
      dayColor: 'purple',
      nightColor: 'blue',
    },
  ];

  destColumns.forEach((dc, di) => {
    const cardX = 36 + di * ((W - 72) / 3);
    const cardW = (W - 96) / 3;

    // Inner card border / header
    text(dc.title, cardX + 10, dy + 105, 17, 900, ink);
    text(dc.blurb, cardX + 10, dy + 128, 11, 600, sub);

    // DAY DISPLAY (2.2x zoom)
    const dayY = dy + 265;
    text('DAY MODE (2.2×)', cardX + 10, dayY - 105, 11, 800, sub);
    drawDestinationCompound(dc.type, dc.dayColor, cardX + cardW / 2, dayY, 2.2, false, false, di * 13 + 5);

    // NIGHT DISPLAY (2.2x zoom)
    const nightY = dy + 510;
    ctx.fillStyle = '#141A26';
    ctx.beginPath();
    ctx.roundRect(cardX + 4, nightY - 118, cardW - 8, 230, 14);
    ctx.fill();
    text('NIGHT MODE (2.2×)', cardX + 16, nightY - 100, 11, 800, '#9AA5B8');
    drawDestinationCompound(dc.type, dc.nightColor, cardX + cardW / 2, nightY + 8, 2.2, true, false, di * 23 + 9);

    // ACTUAL IN-GAME SIZE (1.0x scale) & CRITICAL COMPARISON
    const actY = dy + 750;
    text('Actual Size (1.0×)', cardX + 10, actY - 8, 11, 800, sub);
    drawDestinationCompound(dc.type, dc.dayColor, cardX + 65, actY + 45, 1.0, night, false, di * 7 + 1);

    // Critical Danger alert preview (shows pulsing alert roof)
    text('Critical Pulse (>65%)', cardX + 190, actY - 8, 11, 800, '#FF3B30');
    drawDestinationCompound(dc.type, dc.dayColor, cardX + 260, actY + 45, 1.0, night, true, di * 7 + 2);
  });

  // =========================================================================
  // 3. EARLY WARNING ALERTS
  // =========================================================================
  const ay = 1960;
  ctx.fillStyle = night ? '#1C2333' : '#F7F2E6';
  ctx.beginPath();
  ctx.roundRect(16, ay, W - 32, 640, 18);
  ctx.fill();
  text('Early "Store About To Go Bust" Warning — 3 escalating stages', 40, ay + 34, 22, 900, ink);
  text('New: warning starts one pin EARLIER (before the clock starts), ring fills up around the whole lot, and an edge arrow points at off-screen stores.', 40, ay + 60, 13, 600, sub);

  const stages: { s: StoreAlertStage; label: string; desc: string; pins: number; prog: number }[] = [
    { s: 'calm', label: 'Today', desc: 'Nothing until 4 pins', pins: 2, prog: 0 },
    { s: 'heads-up', label: '1 · Heads-up (NEW)', desc: '3 pins: amber "!" + marching dashed ring', pins: 3, prog: 0 },
    { s: 'overflowing', label: '2 · Overflowing', desc: 'Clock running: amber ring fills around lot', pins: 5, prog: ((time * 0.06) % 0.6) + 0.05 },
    { s: 'critical', label: '3 · Critical (>65%)', desc: 'Red ring, sonar ripples, flashing roof, shake', pins: 7, prog: 0.65 + ((time * 0.05) % 0.33) },
  ];
  stages.forEach((st, i) => {
    const cx = 160 + i * 300;
    const cy = ay + 320;
    text(st.label, cx, ay + 110, 15, 900, ink, 'center');
    text(st.desc, cx, ay + 132, 11.5, 600, sub, 'center');
    drawStoreDemo(cx, cy + 20, 1.7, st.s, st.prog, st.pins, night);
  });

  // Off-screen arrow mock (phone viewport)
  const vx = 1260, vy = ay + 100, vw = 250, vh = 480;
  text('Off-screen store', vx + vw / 2, ay + 110 - 24, 15, 900, ink, 'center');
  ctx.save();
  ctx.fillStyle = night ? '#0E131D' : '#2C313A';
  ctx.beginPath();
  ctx.roundRect(vx - 8, vy + 8, vw + 16, vh + 16, 34);
  ctx.fill();
  ctx.fillStyle = night ? '#1A2130' : '#F2EEDF';
  ctx.beginPath();
  ctx.roundRect(vx, vy + 16, vw, vh, 28);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(vx, vy + 16, vw, vh, 28);
  ctx.clip();
  ctx.translate(vx, vy + 16);
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.translate(60 + i * 65, 330);
    lot(0, 0, PAL.red, night);
    drawResidential(ctx, 'diorama', ((i % 3) + 1) as 1 | 2 | 3, PAL.red, night, i * 9 + 2, time);
    ctx.restore();
  }
  drawOffscreenArrow(ctx, vw, vh, vw + 220, -160, true, time);
  drawOffscreenArrow(ctx, vw, vh, -200, vh * 0.55, false, time);
  ctx.restore();

  // =========================================================================
  // 4. SURFACE COMMUTER TRAIN — 3D LOW-POLY DIORAMA MODEL
  // =========================================================================
  const ty = 2620;
  ctx.fillStyle = night ? '#1C2333' : '#F7F2E6';
  ctx.beginPath();
  ctx.roundRect(16, ty, W - 32, 790, 18);
  ctx.fill();

  text('4 · Surface Commuter Train — 3D Low-Poly Diorama Model', 40, ty + 34, 22, 900, ink);
  text(
    'Consistent with Design A architecture: steel bogies, pantograph, aerodynamic lead nose, commuter silhouettes in windows at night, and progressive multi-car train scaling.',
    40,
    ty + 60,
    13,
    600,
    sub
  );

  function drawTrack(tx0: number, ty0: number, len: number, isNight: boolean) {
    const theme = isNight ? CONFIG.THEMES.night : CONFIG.THEMES.day;
    ctx.save();
    // Ballast
    ctx.strokeStyle = theme.RAIL_BALLAST;
    ctx.lineWidth = 20;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tx0, ty0);
    ctx.lineTo(tx0 + len, ty0);
    ctx.stroke();

    // Sleeper ties
    ctx.strokeStyle = theme.RAIL_TIE;
    ctx.lineWidth = 3.4;
    for (let d = 10; d < len - 6; d += 9.5) {
      ctx.beginPath();
      ctx.moveTo(tx0 + d, ty0 - 8);
      ctx.lineTo(tx0 + d, ty0 + 8);
      ctx.stroke();
    }

    // Steel rails
    ctx.strokeStyle = theme.RAIL_STEEL;
    ctx.lineWidth = 2.2;
    for (const offset of [-4.5, 4.5]) {
      ctx.beginPath();
      ctx.moveTo(tx0, ty0 + offset);
      ctx.lineTo(tx0 + len, ty0 + offset);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- LEFT SIDE: 2.2x DETAILED ANATOMY CARDS ---
  const colLeftW = 680;

  // Day Card (2.0x) - Individual cars separated for inspection
  const dCardY = ty + 95;
  ctx.fillStyle = night ? '#141A26' : '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(40, dCardY, colLeftW, 310, 14);
  ctx.fill();
  text('DAY MODE — ANATOMY BREAKDOWN (2.0× Zoom)', 56, dCardY + 24, 12, 800, sub);
  text('Lead Locomotive (aerodynamic wedge, pantograph) | Passenger Coach (bogies, livery) | Tail (bellows, end plate)', 56, dCardY + 44, 11, 600, sub);

  ctx.save();
  ctx.translate(40 + colLeftW / 2, dCardY + 185);
  ctx.scale(2.0, 2.0);
  drawTrack(-150, 0, 300, false);
  // Draw cars slightly spaced apart to show individual components
  ctx.save();
  ctx.translate(-85, 0);
  drawDioramaTrainCar(ctx, 2, 3, false, time);
  ctx.restore();
  ctx.save();
  ctx.translate(0, 0);
  drawDioramaTrainCar(ctx, 1, 3, false, time);
  ctx.restore();
  ctx.save();
  ctx.translate(85, 0);
  drawDioramaTrainCar(ctx, 0, 3, false, time);
  ctx.restore();
  ctx.restore();

  // Labels for Day Card
  text('Tail Car (red markers + bellows)', 75, dCardY + 285, 11, 700, sub);
  text('Passenger Coach (windows & bogies)', 260, dCardY + 285, 11, 700, sub);
  text('Lead Locomotive (nose & pantograph)', 480, dCardY + 285, 11, 700, '#0284C7');

  // Night Card (2.0x)
  const nCardY = ty + 425;
  ctx.fillStyle = '#0F1420';
  ctx.beginPath();
  ctx.roundRect(40, nCardY, colLeftW, 335, 14);
  ctx.fill();
  text('NIGHT MODE — COMMUTER SILHOUETTES & LIGHTING (2.0× Zoom)', 56, nCardY + 24, 12, 800, '#94A3B8');
  text('Warm interior light with commuter passenger silhouettes inside windows, dual red taillights, Xenon beam cone', 56, nCardY + 44, 11, 600, '#64748B');

  ctx.save();
  ctx.translate(40 + colLeftW / 2 + 30, nCardY + 185);
  ctx.scale(2.0, 2.0);
  drawTrack(-150, 0, 230, true);
  drawDioramaTrain(ctx, 35, 0, 3, true, time);
  ctx.restore();

  // Labels for Night Card
  text('🔴 Red LED markers', 60, nCardY + 300, 11, 700, '#EF4444');
  text('👥 Commuter silhouettes in windows', 220, nCardY + 300, 11, 700, '#FDE047');
  text('💡 High-intensity Xenon beam', 480, nCardY + 300, 11, 700, '#E2E8F0');

  // --- RIGHT SIDE: PROGRESSION SCALING ACROSS WEEKS ---
  const colRightX = 750;
  const colRightW = W - 32 - colRightX - 24;

  const progCardY = ty + 95;
  ctx.fillStyle = night ? '#141A26' : '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(colRightX, progCardY, colRightW, 665, 14);
  ctx.fill();

  text('PROGRESSION SCALING ACROSS GAME WEEKS (1.0× In-Game Scale)', colRightX + 20, progCardY + 24, 13, 800, ink);
  text('As weeks progress, more passenger coaches are added to show increasing commuter demand!', colRightX + 20, progCardY + 44, 11.5, 600, sub);

  const progressionStages = [
    { week: 'Week 1', cars: 2, rush: '+1 Passenger Pin', note: '1 Locomotive + 1 Passenger Coach (Starter service)' },
    { week: 'Week 2', cars: 3, rush: '+2 Passenger Pins', note: '1 Locomotive + 2 Passenger Coaches' },
    { week: 'Week 3', cars: 4, rush: '+3 Passenger Pins', note: '1 Locomotive + 3 Passenger Coaches' },
    { week: 'Week 4', cars: 5, rush: '+4 Passenger Pins', note: '1 Locomotive + 4 Passenger Coaches' },
    { week: 'Week 5+', cars: 6, rush: '+5 Passenger Pins (Max)', note: '1 Locomotive + 5 Passenger Coaches (Full commuter express)' },
  ];

  progressionStages.forEach((ps, idx) => {
    const rowY = progCardY + 80 + idx * 115;
    const isNightRow = idx % 2 === 1;

    // Row backdrop
    ctx.fillStyle = isNightRow ? (night ? '#0B0F19' : '#141A26') : (night ? '#1E2638' : '#F8FAFC');
    ctx.beginPath();
    ctx.roundRect(colRightX + 16, rowY, colRightW - 32, 100, 10);
    ctx.fill();

    // Stage labels
    const labelColor = isNightRow ? '#FFFFFF' : ink;
    const noteColor = isNightRow ? '#94A3B8' : sub;
    text(`${ps.week}: ${ps.cars} Cars`, colRightX + 28, rowY + 20, 13, 800, labelColor);
    text(ps.note, colRightX + 28, rowY + 38, 11, 500, noteColor);

    // Rush pill badge
    ctx.fillStyle = isNightRow ? '#38BDF8' : '#0284C7';
    ctx.beginPath();
    ctx.roundRect(colRightX + colRightW - 200, rowY + 12, 170, 22, 6);
    ctx.fill();
    text(ps.rush, colRightX + colRightW - 115, rowY + 23, 10.5, 800, '#FFFFFF', 'center');

    // Live Train on Track
    ctx.save();
    const trackStartX = colRightX + 35;
    const trackLen = colRightW - 70;
    const trackY = rowY + 68;
    drawTrack(trackStartX, trackY, trackLen, isNightRow);

    // Position train along track
    const headPosX = trackStartX + trackLen - 30;
    drawDioramaTrain(ctx, headPosX, trackY, ps.cars, isNightRow, time);
    ctx.restore();
  });

  requestAnimationFrame(frame);
}

document.fonts.ready.then(() => requestAnimationFrame(frame));
