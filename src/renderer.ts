import { CONFIG } from './config';
import { GridCoord, RoadTile } from './types';
import { DIR8_OFFSETS, RoadNetwork } from './roadNetwork';
import { TrafficSimulation } from './traffic';
import { LevelProgression } from './levelProgression';
import { drawResidential, drawDestination, drawStoreAlert, drawOffscreenArrow, drawDioramaTrainCar, StoreAlertStage } from './buildingArt';
import { sound } from './sound';

export class GameRenderer {
  private ctx: CanvasRenderingContext2D;
  public scale: number = 1;
  public offsetX: number = 0;
  public offsetY: number = 0;
  public userZoom: number = 1.0;
  public userPanX: number = 0;
  public userPanY: number = 0;
  public isNightMode: boolean = false;
  public showHeatmap: boolean = false;
  private animTime: number = 0;
  private cameraInitialized: boolean = false;
  private smoothBounds = { minX: 2, maxX: 25, minY: 1, maxY: 16 };
  private autoScale: number = 1;
  private autoCenterWorldX: number = 0;
  private autoCenterWorldY: number = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private roadNetwork: RoadNetwork,
    private traffic: TrafficSimulation,
    private level: LevelProgression
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not get 2D canvas context');
    this.ctx = context;
  }

  public resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);

    this.updateCameraFraming(true);
  }

  /**
   * Zooms in or out smoothly around a specific screen coordinate (e.g. mouse cursor or screen center).
   */
  public zoomAt(factor: number, screenX?: number, screenY?: number) {
    const sx = screenX ?? window.innerWidth / 2;
    const sy = screenY ?? window.innerHeight / 2;

    // World point currently under (sx, sy)
    const worldX = (sx - this.offsetX) / this.scale;
    const worldY = (sy - this.offsetY) / this.scale;

    const prevZoom = this.userZoom;
    this.userZoom = Math.max(0.55, Math.min(2.4, this.userZoom * factor));
    if (Math.abs(this.userZoom - prevZoom) < 0.0001) return;

    const newScale = this.autoScale * this.userZoom;
    const baseOffsetX = window.innerWidth / 2 - this.autoCenterWorldX * newScale;
    const baseOffsetY = window.innerHeight / 2 - this.autoCenterWorldY * newScale + 2;

    // Adjust userPanX/Y so (worldX, worldY) stays locked right under (sx, sy)
    const desiredOffsetX = sx - worldX * newScale;
    const desiredOffsetY = sy - worldY * newScale;
    this.userPanX = desiredOffsetX - baseOffsetX;
    this.userPanY = desiredOffsetY - baseOffsetY;

    this.scale = newScale;
    this.offsetX = desiredOffsetX;
    this.offsetY = desiredOffsetY;
  }

  public panBy(dx: number, dy: number) {
    this.userPanX += dx;
    this.userPanY += dy;
    this.offsetX += dx;
    this.offsetY += dy;
  }

  public resetCamera() {
    this.userZoom = 1.0;
    this.userPanX = 0;
    this.userPanY = 0;
    this.updateCameraFraming(true);
  }

  /**
   * Computes the target camera scale and offset from active buildings + map bounds
   * and smoothly interpolates so the map frames the city and supports manual zoom/pan.
   */
  private updateCameraFraming(immediate: boolean = false) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const marginX = 36;
    const marginY = 68;
    const availableW = Math.max(320, width - marginX * 2);
    const availableH = Math.max(240, height - marginY * 2);

    const b = this.level.activeBounds;
    let targetMinX = b.minX;
    let targetMaxX = b.maxX;
    let targetMinY = b.minY;
    let targetMaxY = b.maxY;

    // Ensure all spawned buildings + 2.5 tile margin are inside the target bounds
    for (const h of this.level.houses) {
      targetMinX = Math.min(targetMinX, Math.max(0, h.x - 2.5));
      targetMaxX = Math.max(targetMaxX, Math.min(CONFIG.GRID_COLS - 1, h.x + 2.5));
      targetMinY = Math.min(targetMinY, Math.max(0, h.y - 2.5));
      targetMaxY = Math.max(targetMaxY, Math.min(CONFIG.GRID_ROWS - 1, h.y + 2.5));
    }
    for (const d of this.level.destinations) {
      targetMinX = Math.min(targetMinX, Math.max(0, d.x - 2.5));
      targetMaxX = Math.max(targetMaxX, Math.min(CONFIG.GRID_COLS - 1, d.x + d.w + 2.0));
      targetMinY = Math.min(targetMinY, Math.max(0, d.y - 2.5));
      targetMaxY = Math.max(targetMaxY, Math.min(CONFIG.GRID_ROWS - 1, d.y + d.h + 2.0));
    }

    if (immediate || !this.cameraInitialized) {
      this.smoothBounds.minX = targetMinX;
      this.smoothBounds.maxX = targetMaxX;
      this.smoothBounds.minY = targetMinY;
      this.smoothBounds.maxY = targetMaxY;
    } else {
      const boundsLerp = 0.04;
      this.smoothBounds.minX += (targetMinX - this.smoothBounds.minX) * boundsLerp;
      this.smoothBounds.maxX += (targetMaxX - this.smoothBounds.maxX) * boundsLerp;
      this.smoothBounds.minY += (targetMinY - this.smoothBounds.minY) * boundsLerp;
      this.smoothBounds.maxY += (targetMaxY - this.smoothBounds.maxY) * boundsLerp;
    }

    const visibleCols = Math.max(12, this.smoothBounds.maxX - this.smoothBounds.minX + 1);
    const visibleRows = Math.max(8, this.smoothBounds.maxY - this.smoothBounds.minY + 1);

    const scaleX = availableW / (visibleCols * CONFIG.TILE_SIZE);
    const scaleY = availableH / (visibleRows * CONFIG.TILE_SIZE);
    this.autoScale = Math.min(scaleX, scaleY, 1.38);

    this.autoCenterWorldX =
      ((this.smoothBounds.minX + this.smoothBounds.maxX + 1) / 2) * CONFIG.TILE_SIZE;
    this.autoCenterWorldY =
      ((this.smoothBounds.minY + this.smoothBounds.maxY + 1) / 2) * CONFIG.TILE_SIZE;

    const targetScale = this.autoScale * this.userZoom;
    const targetOffsetX = width / 2 - this.autoCenterWorldX * targetScale + this.userPanX;
    const targetOffsetY = height / 2 - this.autoCenterWorldY * targetScale + 2 + this.userPanY;

    if (immediate || !this.cameraInitialized) {
      this.scale = targetScale;
      this.offsetX = targetOffsetX;
      this.offsetY = targetOffsetY;
      this.cameraInitialized = true;
    } else {
      const lerp = 0.12;
      this.scale += (targetScale - this.scale) * lerp;
      this.offsetX += (targetOffsetX - this.offsetX) * lerp;
      this.offsetY += (targetOffsetY - this.offsetY) * lerp;
    }
  }

  public screenToGrid(screenX: number, screenY: number): GridCoord {
    const worldX = (screenX - this.offsetX) / this.scale;
    const worldY = (screenY - this.offsetY) / this.scale;

    return {
      x: Math.floor(worldX / CONFIG.TILE_SIZE),
      y: Math.floor(worldY / CONFIG.TILE_SIZE),
    };
  }

  private getTheme() {
    return this.isNightMode ? CONFIG.THEMES.night : CONFIG.THEMES.day;
  }

  public render(
    hoverCoord: GridCoord | null,
    currentTool: 'draw' | 'erase' | 'motorway' | 'roundabout' | 'traffic_light' | 'subway' | 'blueprint',
    dragPath: GridCoord[],
    motorwayStart: GridCoord | null
  ) {
    this.animTime += 0.016;
    this.updateCameraFraming(false);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const theme = this.getTheme();

    // 0. Fill background
    this.ctx.fillStyle = theme.BACKGROUND;
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.save();

    if (this.level.screenShake > 0) {
      const shakeX = (Math.random() - 0.5) * 4.5 * this.level.screenShake;
      const shakeY = (Math.random() - 0.5) * 4.5 * this.level.screenShake;
      this.ctx.translate(shakeX, shakeY);
    }

    this.ctx.translate(this.offsetX, this.offsetY);
    this.ctx.scale(this.scale, this.scale);

    // 1. Topographic elevation contours & Steep Mountain Ridges
    this.renderHillContours();

    // 2. Smooth River Channels & shorelines
    this.renderSmoothRiver();

    // 3. Subtle architect drafting grid
    this.renderGridGuides(hoverCoord);

    // 3b. Surface Railroad Track Corridor
    this.renderRailTrack();

    // 3c. Underground Subway / Metro Lines & Shuttles
    this.renderSubways();

    // 4. Unified Multi-Pass Road, Bridge, Tunnel & Rail Crossing Network
    this.renderRoadNetworkUnified();
    this.renderSymphonyLaneFlow();

    // 4b. Surface Commuter Train & Active Crossing Signals
    this.renderSurfaceTrain();

    // 4c. Blueprint Ghost Planning Mode Network (Feature #3)
    this.renderBlueprintRoads();

    // 5. Tool Previews (Ghost road, roundabout, traffic light, motorway, subway, blueprint)
    this.renderInteractions(hoverCoord, currentTool, dragPath, motorwayStart);

    // 6. Architectural 2.5D Houses, Mid-Rise Apartments & High-Rise Skyscrapers
    this.renderHouses();

    // 7. Architectural 2.5D Destinations & Parking Lots
    this.renderDestinations();
    this.renderConstructionSites();
    this.renderRhythmBeacons();

    // 8. Clustered Forest Trees
    this.renderTrees();

    // 9. Surface Cars
    this.renderCars(false);

    // 9b. Surface Metro Station Portals (S1, S2...)
    this.renderSubwayStations();

    // 10. Elevated Motorways & Highway Cars
    this.renderMotorways();
    this.renderCars(true);

    // 11. Floating Demand Pins & Overcrowding Timers (always crisp on top of buildings)
    this.renderDestinationOverlays();

    // 12. Floating +1 / +N Score Particles
    this.renderFloatingTexts();

    // 12b. City Symphony Diurnal Atmosphere (Dawn, Midday, Dusk, Nocturnal Respite)
    this.renderDiurnalAtmosphere();

    this.ctx.restore();

    // 13. Screen-Edge Radar Arrows for any off-screen Stores in danger
    for (const dest of this.level.destinations) {
      const warningThreshold = CONFIG.GAMEPLAY.OVERFLOW_WARNING_THRESHOLD;
      let stage: StoreAlertStage = 'calm';
      const progress = dest.maxOverflowTime > 0 ? Math.min(1.0, dest.overflowTimer / dest.maxOverflowTime) : 0;
      if (dest.overflowTimer > 0) {
        stage = progress > 0.65 ? 'critical' : 'overflowing';
      } else if (dest.pins >= warningThreshold - 1) {
        stage = 'heads-up';
      }
      if (stage === 'calm') continue;

      const worldCx = (dest.x + dest.w / 2) * CONFIG.TILE_SIZE;
      const worldCy = (dest.y + dest.h / 2) * CONFIG.TILE_SIZE;
      const screenX = worldCx * this.scale + this.offsetX;
      const screenY = worldCy * this.scale + this.offsetY;

      const pad = 40;
      const isOffScreen = screenX < -pad || screenX > width + pad || screenY < -pad || screenY > height + pad;
      if (isOffScreen) {
        drawOffscreenArrow(this.ctx, width, height, screenX, screenY, stage === 'critical', this.animTime);
      }
    }
  }

  private renderSymphonyLaneFlow() {
    if (this.level.gameMode !== 'symphony') return;
    const flowStats = this.level.symphonyFlowStats;
    if (flowStats.flowPercentage < 65) return;

    const ctx = this.ctx;
    ctx.save();
    const pulseAlpha = (Math.sin(this.animTime * 4.5) * 0.5 + 0.5) * 0.45;
    ctx.lineWidth = 2.0;

    // Subtle harmonic flow pulse behind moving vehicles
    for (const car of this.traffic.cars) {
      if (car.speed > CONFIG.GAMEPLAY.BASE_CAR_SPEED * 0.6 && !car.isBraking) {
        const cx = car.x * CONFIG.TILE_SIZE;
        const cy = car.y * CONFIG.TILE_SIZE;
        const tailX = cx - Math.cos(car.angle) * (CONFIG.TILE_SIZE * 0.45);
        const tailY = cy - Math.sin(car.angle) * (CONFIG.TILE_SIZE * 0.45);

        const grad = ctx.createLinearGradient(tailX, tailY, cx, cy);
        grad.addColorStop(0, 'rgba(168, 85, 247, 0)');
        grad.addColorStop(1, `rgba(56, 189, 248, ${pulseAlpha})`);

        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(cx, cy);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private renderRhythmBeacons() {
    if (this.level.gameMode !== 'symphony') return;
    const upcoming = this.level.upcomingRhythmEvent;
    if (!upcoming) return;

    const ctx = this.ctx;
    const anim = (this.animTime * 1.8) % 1.0;
    const radius = 28 + anim * 32;
    const alpha = (1.0 - anim) * 0.45;

    if (upcoming.targetType === 'station') {
      for (const dest of this.level.destinations) {
        if (dest.isTrainStation) {
          const cx = (dest.x + dest.w / 2) * CONFIG.TILE_SIZE;
          const cy = (dest.y + dest.h / 2) * CONFIG.TILE_SIZE;

          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(245, 158, 11, ${alpha})`;
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.restore();
        }
      }
    } else if (upcoming.targetType === 'suburb') {
      for (let i = 0; i < Math.min(4, this.level.houses.length); i++) {
        const h = this.level.houses[i];
        const cx = (h.x + 0.5) * CONFIG.TILE_SIZE;
        const cy = (h.y + 0.5) * CONFIG.TILE_SIZE;

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.65, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(168, 85, 247, ${alpha * 0.8})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private renderDiurnalAtmosphere() {
    if (this.level.gameMode !== 'symphony') return;
    const timeInfo = this.level.getCityTime24();
    const ctx = this.ctx;
    const bounds = this.level.activeBounds;
    const x = (bounds.minX - 3) * CONFIG.TILE_SIZE;
    const y = (bounds.minY - 3) * CONFIG.TILE_SIZE;
    const w = (bounds.maxX - bounds.minX + 6) * CONFIG.TILE_SIZE;
    const h = (bounds.maxY - bounds.minY + 6) * CONFIG.TILE_SIZE;

    const decHour = timeInfo.hour + timeInfo.minute / 60;
    let overlayColor = '';

    if (decHour >= 5.5 && decHour < 8.5) {
      // Warm golden dawn
      const dawnProgress = (decHour - 5.5) / 3.0;
      const alpha = Math.sin(dawnProgress * Math.PI) * 0.08;
      overlayColor = `rgba(245, 158, 11, ${alpha})`;
    } else if (decHour >= 17.5 && decHour < 20.5) {
      // Dusk twilight glow
      const duskProgress = (decHour - 17.5) / 3.0;
      const alpha = Math.sin(duskProgress * Math.PI) * 0.10;
      overlayColor = `rgba(217, 70, 239, ${alpha})`;
    } else if (decHour >= 20.5 || decHour < 5.5) {
      // Gentle nocturnal indigo wash
      overlayColor = 'rgba(15, 23, 42, 0.14)';
    }

    if (overlayColor) {
      ctx.save();
      ctx.fillStyle = overlayColor;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
  }

  private renderHillContours() {
    const tileSize = CONFIG.TILE_SIZE;
    const theme = this.getTheme();

    // 1. Gentle grass hill contours
    for (let layer = 0; layer < 3; layer++) {
      this.ctx.fillStyle = theme.HILL_CONTOURS[layer];
      for (const hc of this.roadNetwork.hillContours) {
        if (hc.isMountain || hc.layer !== layer || hc.points.length < 3) continue;
        this.fillSmoothPolygon(hc.points, tileSize);
      }
    }

    // 2. Steep rocky mountain ridges (impassable without Tunnels)
    for (let layer = 0; layer < 3; layer++) {
      this.ctx.fillStyle = theme.MOUNTAIN_CONTOURS[layer];
      for (const hc of this.roadNetwork.hillContours) {
        if (!hc.isMountain || hc.layer !== layer || hc.points.length < 3) continue;
        this.fillSmoothPolygon(hc.points, tileSize);
      }
    }
  }

  private fillSmoothPolygon(pts: { x: number; y: number }[], tileSize: number) {
    this.ctx.beginPath();
    const firstMidX = ((pts[pts.length - 1].x + pts[0].x) / 2) * tileSize;
    const firstMidY = ((pts[pts.length - 1].y + pts[0].y) / 2) * tileSize;
    this.ctx.moveTo(firstMidX, firstMidY);

    for (let i = 0; i < pts.length; i++) {
      const curr = pts[i];
      const next = pts[(i + 1) % pts.length];
      const midX = ((curr.x + next.x) / 2) * tileSize;
      const midY = ((curr.y + next.y) / 2) * tileSize;
      this.ctx.quadraticCurveTo(curr.x * tileSize, curr.y * tileSize, midX, midY);
    }
    this.ctx.closePath();
    this.ctx.fill();
  }

  private renderSmoothRiver() {
    const tileSize = CONFIG.TILE_SIZE;
    const theme = this.getTheme();
    const riverWidth = tileSize * 1.82;

    this.ctx.save();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    for (const pts of this.roadNetwork.riverChannels) {
      if (pts.length < 2) continue;

      const traceRiverPath = () => {
        this.ctx.beginPath();
        this.ctx.moveTo(pts[0].x * tileSize, pts[0].y * tileSize);
        for (let i = 1; i < pts.length; i++) {
          const xc = ((pts[i - 1].x + pts[i].x) / 2) * tileSize;
          const yc = ((pts[i - 1].y + pts[i].y) / 2) * tileSize;
          this.ctx.quadraticCurveTo(pts[i - 1].x * tileSize, pts[i - 1].y * tileSize, xc, yc);
        }
      };

      // 1. Outer grassy/sandy riverbank contour
      traceRiverPath();
      this.ctx.strokeStyle = theme.WATER_SHORE;
      this.ctx.lineWidth = riverWidth + 18;
      this.ctx.stroke();

      // 2. Shallow water bank
      traceRiverPath();
      this.ctx.strokeStyle = theme.WATER_BANK;
      this.ctx.lineWidth = riverWidth + 6;
      this.ctx.stroke();

      // 3. Main water channel
      traceRiverPath();
      this.ctx.strokeStyle = theme.WATER;
      this.ctx.lineWidth = riverWidth;
      this.ctx.stroke();

      // 4. Deep water inner current
      traceRiverPath();
      this.ctx.strokeStyle = theme.WATER_DEEP;
      this.ctx.lineWidth = riverWidth * 0.52;
      this.ctx.stroke();

      // 5. Subtle continuous inner water sheen
      traceRiverPath();
      this.ctx.strokeStyle = theme.WATER_RIPPLE;
      this.ctx.lineWidth = riverWidth * 0.22;
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  private renderRailTrack() {
    const tileSize = CONFIG.TILE_SIZE;
    const theme = this.getTheme();
    const pts = this.roadNetwork.surfaceTrain.path;
    if (pts.length < 2) return;

    const sx = pts[0].x * tileSize;
    const sy = pts[0].y * tileSize;
    const ex = pts[pts.length - 1].x * tileSize;
    const ey = pts[pts.length - 1].y * tileSize;

    this.ctx.save();
    // 1. Crushed stone gravel ballast bed
    this.ctx.strokeStyle = theme.RAIL_BALLAST;
    this.ctx.lineWidth = 18;
    this.ctx.lineCap = 'butt';
    this.ctx.beginPath();
    this.ctx.moveTo(sx, sy);
    this.ctx.lineTo(ex, ey);
    this.ctx.stroke();

    // 2. Wooden sleeper ties perpendicular to track
    const totalLen = Math.hypot(ex - sx, ey - sy);
    const ux = (ex - sx) / totalLen;
    const uy = (ey - sy) / totalLen;
    const nx = -uy;
    const ny = ux;

    this.ctx.strokeStyle = theme.RAIL_TIE;
    this.ctx.lineWidth = 3.2;
    for (let d = 0; d < totalLen; d += 9) {
      const tx = sx + ux * d;
      const ty = sy + uy * d;
      this.ctx.beginPath();
      this.ctx.moveTo(tx - nx * 7.5, ty - ny * 7.5);
      this.ctx.lineTo(tx + nx * 7.5, ty + ny * 7.5);
      this.ctx.stroke();
    }

    // 3. Twin parallel steel rails
    this.ctx.strokeStyle = theme.RAIL_STEEL;
    this.ctx.lineWidth = 2.0;
    for (const offset of [-4.2, 4.2]) {
      this.ctx.beginPath();
      this.ctx.moveTo(sx + nx * offset, sy + ny * offset);
      this.ctx.lineTo(ex + nx * offset, ey + ny * offset);
      this.ctx.stroke();
    }

    // 4. Central Commuter Train Terminal Passenger Platform (flush against southern rail)
    const stX = (this.roadNetwork.stationTileX - 0.2) * tileSize;
    const stW = 2.4 * tileSize;
    const trackY = sy;
    const platTopY = trackY + 5.5;
    const platH = 16;

    // Concrete platform slab
    this.ctx.fillStyle = this.isNightMode ? '#1E293B' : '#E2E8F0';
    this.roundRect(stX, platTopY, stW, platH, 4);
    this.ctx.fill();

    // Curbing edge
    this.ctx.strokeStyle = this.isNightMode ? '#0F172A' : '#94A3B8';
    this.ctx.lineWidth = 1.2;
    this.roundRect(stX, platTopY, stW, platH, 4);
    this.ctx.stroke();

    // Safety yellow tactile warning edge
    this.ctx.strokeStyle = '#F59E0B';
    this.ctx.lineWidth = 2.4;
    this.ctx.beginPath();
    this.ctx.moveTo(stX + 2, platTopY + 1.5);
    this.ctx.lineTo(stX + stW - 2, platTopY + 1.5);
    this.ctx.stroke();

    // Hazard dashes
    this.ctx.strokeStyle = '#1E293B';
    this.ctx.lineWidth = 1.2;
    this.ctx.setLineDash([3, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(stX + 4, platTopY + 1.5);
    this.ctx.lineTo(stX + stW - 4, platTopY + 1.5);
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    // Platform Waiting Canopies & Pillars
    for (const cx of [stX + stW * 0.25, stX + stW * 0.75]) {
      this.ctx.strokeStyle = this.isNightMode ? '#64748B' : '#475569';
      this.ctx.lineWidth = 1.6;
      this.ctx.beginPath();
      this.ctx.moveTo(cx, platTopY + 4);
      this.ctx.lineTo(cx, platTopY + platH - 2);
      this.ctx.stroke();

      this.ctx.fillStyle = this.isNightMode ? '#334155' : '#475569';
      this.roundRect(cx - 12, platTopY + 3, 24, 4.5, 2);
      this.ctx.fill();
    }

    // Terminal Station Identifier Badge
    const badgeW = 76;
    const badgeH = 14;
    const badgeX = stX + stW / 2 - badgeW / 2;
    const badgeY = platTopY + platH - 5;
    this.ctx.fillStyle = '#1E293B';
    this.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
    this.ctx.fill();
    this.ctx.strokeStyle = '#38BDF8';
    this.ctx.lineWidth = 1;
    this.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
    this.ctx.stroke();

    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = '800 8.5px "Plus Jakarta Sans", sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('🚆 TERMINAL', stX + stW / 2, badgeY + badgeH / 2);

    this.ctx.restore();
  }

  private renderSurfaceTrain() {
    const tileSize = CONFIG.TILE_SIZE;
    const train = this.roadNetwork.surfaceTrain;
    const pts = train.path;
    if (pts.length < 2 || !train.active) return;

    // 1. Render flashing red warning lights at any Railroad Crossing where train is approaching
    const blink = Math.floor(this.animTime * 8) % 2 === 0;
    for (const road of this.roadNetwork.roads.values()) {
      if (!road.isRailCrossing) continue;
      const cx = (road.x + 0.5) * tileSize;
      const cy = (road.y + 0.5) * tileSize;
      const near = this.roadNetwork.isTrainNearTile(road.x, road.y);

      // Railroad crossbuck posts on corners
      this.ctx.save();
      this.ctx.fillStyle = '#2C313A';
      this.ctx.beginPath();
      this.ctx.arc(cx - 12, cy - 12, 4, 0, Math.PI * 2);
      this.ctx.arc(cx + 12, cy + 12, 4, 0, Math.PI * 2);
      this.ctx.fill();

      if (near) {
        sound.playCrossingBell();
        this.ctx.fillStyle = blink ? '#FF3B30' : '#7A1C18';
        this.ctx.beginPath();
        this.ctx.arc(cx - 12, cy - 12, 2.8, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = !blink ? '#FF3B30' : '#7A1C18';
        this.ctx.beginPath();
        this.ctx.arc(cx + 12, cy + 12, 2.8, 0, Math.PI * 2);
        this.ctx.fill();

        // Lowered red/white crossing barrier arms across road
        this.ctx.strokeStyle = '#E84855';
        this.ctx.lineWidth = 2.6;
        this.ctx.beginPath();
        this.ctx.moveTo(cx - 11, cy - 11);
        this.ctx.lineTo(cx + 8, cy - 11);
        this.ctx.moveTo(cx + 11, cy + 11);
        this.ctx.lineTo(cx - 8, cy + 11);
        this.ctx.stroke();
      }
      this.ctx.restore();
    }

    // 2. Render Multi-Car Commuter Train along the rail corridor (3D Low-Poly Diorama)
    const start = pts[0];
    const end = pts[pts.length - 1];
    const sx = start.x * tileSize;
    const sy = start.y * tileSize;
    const ex = end.x * tileSize;
    const ey = end.y * tileSize;
    const progress = train.distance / Math.max(1, train.totalLength);

    const carCount = this.roadNetwork.getTrainCarCount ? this.roadNetwork.getTrainCarCount() : 3;
    const headX = sx + (ex - sx) * progress;
    const headY = sy + (ey - sy) * progress;

    // Spacing between car centers: 34px car length + 4px bellows gap = 38px
    const carSpacingPx = 38;
    // Reverse painter's algorithm: draw tail car to lead car so lead locomotive & shadows layer correctly
    for (let c = carCount - 1; c >= 0; c--) {
      const cx = headX - c * carSpacingPx;
      const cy = headY;

      // Viewport culling with margin for oblique shadow & pantograph
      if (cx < -90 || cx > this.canvas.width + 90) continue;

      this.ctx.save();
      this.ctx.translate(cx, cy);
      drawDioramaTrainCar(
        this.ctx,
        c,
        carCount,
        this.isNightMode,
        this.animTime,
        CONFIG.COLORS.TRAIN_STRIPE || '#E84855'
      );
      this.ctx.restore();
    }
  }

  private renderSubways() {
    const tileSize = CONFIG.TILE_SIZE;

    for (const sub of this.roadNetwork.subways) {
      const sx = (sub.start.x + 0.5) * tileSize;
      const sy = (sub.start.y + 0.5) * tileSize;
      const ex = (sub.end.x + 0.5) * tileSize;
      const ey = (sub.end.y + 0.5) * tileSize;

      this.ctx.save();

      // 1. Subterranean Metro Conduit (glowing teal dashed underground tube)
      this.ctx.strokeStyle = CONFIG.COLORS.SUBWAY_LINE_OUTER;
      this.ctx.lineWidth = 10;
      this.ctx.lineCap = 'round';
      this.ctx.beginPath();
      this.ctx.moveTo(sx, sy);
      this.ctx.lineTo(ex, ey);
      this.ctx.stroke();

      this.ctx.strokeStyle = CONFIG.COLORS.SUBWAY_LINE_INNER;
      this.ctx.lineWidth = 3.5;
      this.ctx.setLineDash([7, 6]);
      this.ctx.beginPath();
      this.ctx.moveTo(sx, sy);
      this.ctx.lineTo(ex, ey);
      this.ctx.stroke();
      this.ctx.setLineDash([]);

      // 2. Automated Underground Metro Shuttle Capsule moving between stations
      const tx = sx + (ex - sx) * sub.trainProgress;
      const ty = sy + (ey - sy) * sub.trainProgress;
      const angle = Math.atan2(ey - sy, ex - sx);

      this.ctx.save();
      this.ctx.translate(tx, ty);
      this.ctx.rotate(angle);

      // Capsule Drop Shadow
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      this.roundRect(-12, -4.5, 24, 12, 5.5);
      this.ctx.fill();

      // Outer teal capsule body
      this.ctx.fillStyle = CONFIG.COLORS.SUBWAY_STATION_BG;
      this.roundRect(-11, -5.5, 22, 11, 5.5);
      this.ctx.fill();

      // Inner sleek white roof
      this.ctx.fillStyle = CONFIG.COLORS.SUBWAY_TRAIN;
      this.roundRect(-7, -3.2, 14, 6.4, 3);
      this.ctx.fill();

      // Commuter passenger lights inside windows
      if (sub.passengers && sub.passengers > 0) {
        const dotColor =
          sub.passengerColor && CONFIG.COLORS.BUILDINGS[sub.passengerColor]
            ? CONFIG.COLORS.BUILDINGS[sub.passengerColor].main
            : '#2CE5D5';
        this.ctx.fillStyle = dotColor;
        const count = Math.min(4, sub.passengers);
        const startX = -((count - 1) * 3) / 2;
        for (let p = 0; p < count; p++) {
          this.ctx.beginPath();
          this.ctx.arc(startX + p * 3, 0, 1.3, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
      this.ctx.restore();

      this.ctx.restore();
    }
  }

  private renderSubwayStations() {
    const tileSize = CONFIG.TILE_SIZE;

    for (const sub of this.roadNetwork.subways) {
      const sx = (sub.start.x + 0.5) * tileSize;
      const sy = (sub.start.y + 0.5) * tileSize;
      const ex = (sub.end.x + 0.5) * tileSize;
      const ey = (sub.end.y + 0.5) * tileSize;

      // Metro Station Portals at both ends (`S1`, `S2`, ...)
      for (const [ptX, ptY] of [
        [sx, sy],
        [ex, ey],
      ]) {
        this.ctx.save();
        this.ctx.translate(ptX, ptY);

        // Station Drop Shadow
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        this.ctx.beginPath();
        this.ctx.arc(1, 2.5, 13, 0, Math.PI * 2);
        this.ctx.fill();

        // Pulsing active platform halo when train is stopped and boarding
        const isAtThisStation =
          (sub.dwellTimer && sub.dwellTimer > 0) &&
          ((ptX === sx && ptY === sy && sub.trainProgress <= 0.1) ||
            (ptX === ex && ptY === ey && sub.trainProgress >= 0.9));

        if (isAtThisStation) {
          const pulse = Math.sin(performance.now() * 0.012) * 2.5;
          this.ctx.strokeStyle = 'rgba(44, 229, 213, 0.8)';
          this.ctx.lineWidth = 2.5;
          this.ctx.beginPath();
          this.ctx.arc(0, 0, 15 + pulse, 0, Math.PI * 2);
          this.ctx.stroke();
        }

        // White Outer Ring
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.beginPath();
        this.ctx.arc(0, 0, 13, 0, Math.PI * 2);
        this.ctx.fill();

        // Teal Metro Badge Core
        this.ctx.fillStyle = CONFIG.COLORS.SUBWAY_STATION_BG;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, 10.2, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '800 10px "Plus Jakarta Sans", sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(`S${sub.number}`, 0, 0.5);

        this.ctx.restore();
      }
    }
  }

  private renderGridGuides(hoverCoord: GridCoord | null) {
    const tileSize = CONFIG.TILE_SIZE;
    const theme = this.getTheme();

    this.ctx.fillStyle = theme.GRID_DOT;
    for (let y = 1; y < CONFIG.GRID_ROWS; y++) {
      for (let x = 1; x < CONFIG.GRID_COLS; x++) {
        this.ctx.beginPath();
        this.ctx.arc(x * tileSize, y * tileSize, 1.2, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    if (
      hoverCoord &&
      hoverCoord.x >= 0 &&
      hoverCoord.x < CONFIG.GRID_COLS &&
      hoverCoord.y >= 0 &&
      hoverCoord.y < CONFIG.GRID_ROWS
    ) {
      this.ctx.strokeStyle = theme.GRID_LINE;
      this.ctx.lineWidth = 1.5;
      this.roundRect(
        hoverCoord.x * tileSize + 2,
        hoverCoord.y * tileSize + 2,
        tileSize - 4,
        tileSize - 4,
        6
      );
      this.ctx.stroke();
    }
  }

  private renderRoadNetworkUnified() {
    const tileSize = CONFIG.TILE_SIZE;
    const theme = this.getTheme();
    const roadWidth = tileSize * 0.48;
    const casingWidth = roadWidth + 5;
    const buildingDirsMap = this.buildBuildingConnectionsMap();

    // 1. Bridge Shadows & Support Piers in Water
    for (const road of this.roadNetwork.roads.values()) {
      if (!road.isBridge) continue;
      const cx = (road.x + 0.5) * tileSize;
      const cy = (road.y + 0.5) * tileSize;

      // Cast shadow on water
      this.ctx.save();
      this.ctx.strokeStyle = CONFIG.COLORS.BRIDGE_SHADOW;
      this.ctx.lineWidth = casingWidth + 4;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.drawTileRoadGeometry(road, cx + 3, cy + 6, tileSize, buildingDirsMap, false);
      this.ctx.stroke();

      // Concrete pier pilings in water
      this.ctx.fillStyle = CONFIG.COLORS.BRIDGE_PIER;
      this.ctx.beginPath();
      this.ctx.arc(cx, cy + 3, roadWidth * 0.62, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }

    // 2. PASS A: Road Outer Casing (Curbs) + Roundabout Rings + Driveway/Entrance Throats
    this.ctx.save();
    this.ctx.strokeStyle = theme.ROAD_CASING;
    this.ctx.fillStyle = theme.ROAD_CASING;
    this.ctx.lineWidth = casingWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    for (const rb of this.roadNetwork.roundabouts) {
      const rcx = (rb.center.x + 0.5) * tileSize;
      const rcy = (rb.center.y + 0.5) * tileSize;
      this.ctx.beginPath();
      this.ctx.arc(rcx, rcy, tileSize * 0.94, 0, Math.PI * 2);
      this.ctx.stroke();
    }

    for (const road of this.roadNetwork.roads.values()) {
      if (road.isTunnel) continue;
      if (this.isInternalRoundaboutCorner(road, buildingDirsMap)) continue;
      const cx = (road.x + 0.5) * tileSize;
      const cy = (road.y + 0.5) * tileSize;
      this.drawTileRoadGeometry(road, cx, cy, tileSize, buildingDirsMap, false);
      this.ctx.stroke();
    }
    this.drawBuildingConnectorThroats(tileSize, casingWidth);
    this.ctx.restore();

    // 3. Bridge Guardrails Layer (between casing and asphalt)
    for (const road of this.roadNetwork.roads.values()) {
      if (!road.isBridge) continue;
      const cx = (road.x + 0.5) * tileSize;
      const cy = (road.y + 0.5) * tileSize;

      this.ctx.save();
      this.ctx.strokeStyle = CONFIG.COLORS.BRIDGE_RAIL;
      this.ctx.lineWidth = roadWidth + 7;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.drawTileRoadGeometry(road, cx, cy, tileSize, buildingDirsMap, false);
      this.ctx.stroke();
      this.ctx.restore();
    }

    // 4. PASS B: Road Asphalt Surface + Roundabout Rings + Driveway/Entrance Asphalt
    this.ctx.save();
    this.ctx.strokeStyle = theme.ROAD_ASPHALT;
    this.ctx.fillStyle = theme.ROAD_ASPHALT;
    this.ctx.lineWidth = roadWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    for (const rb of this.roadNetwork.roundabouts) {
      const rcx = (rb.center.x + 0.5) * tileSize;
      const rcy = (rb.center.y + 0.5) * tileSize;
      this.ctx.beginPath();
      this.ctx.arc(rcx, rcy, tileSize * 0.94, 0, Math.PI * 2);
      this.ctx.stroke();
    }

    for (const road of this.roadNetwork.roads.values()) {
      if (this.isInternalRoundaboutCorner(road, buildingDirsMap)) continue;
      const cx = (road.x + 0.5) * tileSize;
      const cy = (road.y + 0.5) * tileSize;
      if (road.isTunnel) {
        this.ctx.save();
        this.ctx.strokeStyle = CONFIG.COLORS.TUNNEL_UNDERGROUND;
        this.ctx.setLineDash([5, 5]);
        this.drawTileRoadGeometry(road, cx, cy, tileSize, buildingDirsMap, false);
        this.ctx.stroke();
        this.ctx.restore();
      } else {
        if (road.isBridge) {
          this.ctx.strokeStyle = CONFIG.COLORS.BRIDGE_DECK;
        } else {
          this.ctx.strokeStyle = theme.ROAD_ASPHALT;
        }
        this.drawTileRoadGeometry(road, cx, cy, tileSize, buildingDirsMap, false);
        this.ctx.stroke();
      }
    }
    this.ctx.strokeStyle = theme.ROAD_ASPHALT;
    this.drawBuildingConnectorThroats(tileSize, roadWidth);
    this.ctx.restore();

    // 4b. Concrete Mountain Tunnel Portals where a normal road enters a mountain tunnel tile
    for (const road of this.roadNetwork.roads.values()) {
      if (!road.isTunnel) continue;
      const cx = (road.x + 0.5) * tileSize;
      const cy = (road.y + 0.5) * tileSize;
      for (const { dir, dx, dy } of DIR8_OFFSETS) {
        if (!road.connections[dir]) continue;
        const nb = this.roadNetwork.getRoad(road.x + dx, road.y + dy);
        if (nb && !nb.isTunnel) {
          const px = cx + dx * (tileSize * 0.44);
          const py = cy + dy * (tileSize * 0.44);
          const angle = Math.atan2(dy, dx);
          this.ctx.save();
          this.ctx.translate(px, py);
          this.ctx.rotate(angle);
          this.ctx.fillStyle = CONFIG.COLORS.TUNNEL_ARCH;
          this.roundRect(-5, -roadWidth * 0.62, 9, roadWidth * 1.24, 3);
          this.ctx.fill();
          this.ctx.fillStyle = CONFIG.COLORS.TUNNEL_PORTAL;
          this.roundRect(-3.5, -roadWidth * 0.68, 7, roadWidth * 1.36, 3);
          this.ctx.fill();
          this.ctx.restore();
        }
      }
    }

    // 5. PASS C: Center Lane Dashed Markings, Roundabout Central Islands & Traffic Lights
    this.ctx.save();
    this.ctx.strokeStyle = theme.ROAD_LANE;
    this.ctx.lineWidth = 1.6;
    this.ctx.setLineDash([4, 5]);

    for (const rb of this.roadNetwork.roundabouts) {
      const rcx = (rb.center.x + 0.5) * tileSize;
      const rcy = (rb.center.y + 0.5) * tileSize;
      this.ctx.beginPath();
      this.ctx.arc(rcx, rcy, tileSize * 0.94, 0, Math.PI * 2);
      this.ctx.stroke();
    }

    for (const road of this.roadNetwork.roads.values()) {
      if (road.isRoundabout) continue;
      const cx = (road.x + 0.5) * tileSize;
      const cy = (road.y + 0.5) * tileSize;
      this.drawTileRoadGeometry(road, cx, cy, tileSize, buildingDirsMap, true);
      this.ctx.stroke();
    }
    this.ctx.restore();

    // Render Roundabout central grass islands
    for (const rb of this.roadNetwork.roundabouts) {
      const rcx = (rb.center.x + 0.5) * tileSize;
      const rcy = (rb.center.y + 0.5) * tileSize;

      // Stone outer curb
      this.ctx.fillStyle = CONFIG.COLORS.ROUNDABOUT_CURB;
      this.ctx.beginPath();
      this.ctx.arc(rcx, rcy, tileSize * 0.62, 0, Math.PI * 2);
      this.ctx.fill();

      // Inner grass circle
      this.ctx.fillStyle = CONFIG.COLORS.ROUNDABOUT_GRASS;
      this.ctx.beginPath();
      this.ctx.arc(rcx, rcy, tileSize * 0.50, 0, Math.PI * 2);
      this.ctx.fill();

      // Inner ornamental tree/bush
      this.ctx.fillStyle = theme.TREE_SHADES[0];
      this.ctx.beginPath();
      this.ctx.arc(rcx - 1, rcy - 1, tileSize * 0.24, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Render Traffic Lights on intersections
    for (const road of this.roadNetwork.roads.values()) {
      if (!road.hasTrafficLight) continue;
      const cx = (road.x + 0.5) * tileSize;
      const cy = (road.y + 0.5) * tileSize;

      // Traffic signal housing box
      this.ctx.fillStyle = '#1E242B';
      this.roundRect(cx - 8, cy - 8, 16, 16, 4);
      this.ctx.fill();

      const nsColor = road.lightGreenAxis === 'ns' ? '#2ECC71' : '#FF4757';
      const ewColor = road.lightGreenAxis === 'ew' ? '#2ECC71' : '#FF4757';

      // N/S lamps
      this.ctx.fillStyle = nsColor;
      this.ctx.beginPath();
      this.ctx.arc(cx, cy - 4.5, 2.4, 0, Math.PI * 2);
      this.ctx.arc(cx, cy + 4.5, 2.4, 0, Math.PI * 2);
      this.ctx.fill();

      // E/W lamps
      this.ctx.fillStyle = ewColor;
      this.ctx.beginPath();
      this.ctx.arc(cx - 4.5, cy, 2.4, 0, Math.PI * 2);
      this.ctx.arc(cx + 4.5, cy, 2.4, 0, Math.PI * 2);
      this.ctx.fill();

      // Smart sensor center status lens (glows blue/cyan when actively scanning vehicle demand)
      const sensorPulse = 0.75 + Math.sin(this.animTime * 6) * 0.25;
      this.ctx.fillStyle = `rgba(56, 189, 248, ${sensorPulse})`;
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, 1.6, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // 5b. Ghost Demolition Queue: Render animated hazard caution stripes on pending roads
    for (const road of this.roadNetwork.roads.values()) {
      if (!road.isDemolishing) continue;
      const cx = (road.x + 0.5) * tileSize;
      const cy = (road.y + 0.5) * tileSize;

      this.ctx.save();
      // Amber/yellow striped hazard pattern
      this.ctx.strokeStyle = '#F59E0B';
      this.ctx.lineWidth = roadWidth * 0.82;
      this.ctx.lineCap = 'round';
      this.ctx.setLineDash([6, 6]);
      this.ctx.lineDashOffset = (this.animTime * 16) % 12;
      this.drawTileRoadGeometry(road, cx, cy, tileSize, buildingDirsMap, false);
      this.ctx.stroke();

      // Cordon alert indicator
      this.ctx.fillStyle = '#EF4444';
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }

    // 5c. Bottleneck Congestion Heatmap Overlay (when active or during Game Over)
    if (this.showHeatmap || this.level.gameOver) {
      let maxCong = 0;
      for (const r of this.roadNetwork.roads.values()) {
        if (r.congestionAccum && r.congestionAccum > maxCong) {
          maxCong = r.congestionAccum;
        }
      }

      if (maxCong > 0.4) {
        this.ctx.save();
        for (const road of this.roadNetwork.roads.values()) {
          const cong = road.congestionAccum || 0;
          if (cong < 0.2) continue;
          const ratio = Math.min(1.0, cong / maxCong);
          const cx = (road.x + 0.5) * tileSize;
          const cy = (road.y + 0.5) * tileSize;

          // Heat gradient from Cyan -> Amber -> Neon Crimson
          const heatColor =
            ratio > 0.65
              ? 'rgba(239, 68, 68, 0.78)'
              : ratio > 0.32
                ? 'rgba(245, 158, 11, 0.68)'
                : 'rgba(56, 189, 248, 0.48)';

          this.ctx.strokeStyle = heatColor;
          this.ctx.lineWidth = roadWidth + 6 * ratio;
          this.ctx.lineCap = 'round';
          this.drawTileRoadGeometry(road, cx, cy, tileSize, buildingDirsMap, false);
          this.ctx.stroke();

          // Pulsing warning beacon on worst bottlenecks
          if (ratio > 0.78) {
            const p = 1 + Math.sin(this.animTime * 8) * 0.25;
            this.ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, 5.2 * p, 0, Math.PI * 2);
            this.ctx.fill();
          }
        }
        this.ctx.restore();
      }
    }
  }

  /**
   * Renders the architectural blueprint ghost roads with translucent azure neon lines,
   * dashed engineering centerlines, and drafted alignment markers (Feature #3).
   */
  private renderBlueprintRoads() {
    if (this.roadNetwork.blueprintRoads.size === 0) return;

    const tileSize = CONFIG.TILE_SIZE;
    const roadWidth = tileSize * 0.48;
    const casingWidth = roadWidth + 5;
    const emptyBuildingMap = new Map<string, { dx: number; dy: number }[]>();

    // Pass 1: Glowing Cyan Blueprint Casing
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(14, 165, 233, 0.45)';
    this.ctx.fillStyle = 'rgba(14, 165, 233, 0.45)';
    this.ctx.lineWidth = casingWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.shadowColor = '#0284c7';
    this.ctx.shadowBlur = 8;

    for (const road of this.roadNetwork.blueprintRoads.values()) {
      const cx = (road.x + 0.5) * tileSize;
      const cy = (road.y + 0.5) * tileSize;
      this.drawTileRoadGeometry(road, cx, cy, tileSize, emptyBuildingMap, false);
      this.ctx.stroke();
    }
    this.ctx.restore();

    // Pass 2: Blueprint Architectural Core (Translucent Azure with drafting dashes)
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    this.ctx.fillStyle = 'rgba(56, 189, 248, 0.85)';
    this.ctx.lineWidth = roadWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.setLineDash([8, 4]);

    for (const road of this.roadNetwork.blueprintRoads.values()) {
      const cx = (road.x + 0.5) * tileSize;
      const cy = (road.y + 0.5) * tileSize;
      this.drawTileRoadGeometry(road, cx, cy, tileSize, emptyBuildingMap, false);
      this.ctx.stroke();
    }
    this.ctx.restore();

    // Pass 3: Crisp White Drafting Grid Centerlines & Alignment Marks
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    this.ctx.lineWidth = 1.8;
    this.ctx.lineCap = 'round';
    this.ctx.setLineDash([3, 3]);

    for (const road of this.roadNetwork.blueprintRoads.values()) {
      const cx = (road.x + 0.5) * tileSize;
      const cy = (road.y + 0.5) * tileSize;
      this.drawTileRoadGeometry(road, cx, cy, tileSize, emptyBuildingMap, true);
      this.ctx.stroke();

      // Drafting alignment crosses at corners
      this.ctx.save();
      this.ctx.strokeStyle = 'rgba(186, 230, 253, 0.7)';
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([]);
      const half = tileSize * 0.5;
      const corners = [
        { x: cx - half, y: cy - half },
        { x: cx + half, y: cy - half },
        { x: cx - half, y: cy + half },
        { x: cx + half, y: cy + half },
      ];
      for (const pt of corners) {
        this.ctx.beginPath();
        this.ctx.moveTo(pt.x - 2, pt.y);
        this.ctx.lineTo(pt.x + 2, pt.y);
        this.ctx.moveTo(pt.x, pt.y - 2);
        this.ctx.lineTo(pt.x, pt.y + 2);
        this.ctx.stroke();
      }
      this.ctx.restore();
    }
    this.ctx.restore();
  }

  /**
   * Builds a map of virtual road connections from each road tile to any House driveway
   * or Destination entrance connected to it, so road corners into buildings curve smoothly!
   */
  private buildBuildingConnectionsMap(): Map<string, { dx: number; dy: number }[]> {
    const map = new Map<string, { dx: number; dy: number }[]>();
    const addDir = (rx: number, ry: number, dx: number, dy: number) => {
      if (dx === 0 && dy === 0) return;
      const key = `${rx},${ry}`;
      let list = map.get(key);
      if (!list) {
        list = [];
        map.set(key, list);
      }
      if (!list.some((d) => d.dx === dx && d.dy === dy)) {
        list.push({ dx, dy });
      }
    };

    for (const house of this.level.houses) {
      const connectedRoads = this.traffic.getHouseRoadNeighbors(house);
      if (connectedRoads.length > 0) {
        const r = connectedRoads[0];
        addDir(r.x, r.y, Math.sign(house.x - r.x), Math.sign(house.y - r.y));
      }
    }

    for (const dest of this.level.destinations) {
      const connectedRoads = this.traffic.getDestinationRoadNeighbors(dest);
      if (connectedRoads.length > 0) {
        const r = connectedRoads[0];
        const clampedX = Math.max(dest.x, Math.min(dest.x + dest.w - 1, r.x));
        const clampedY = Math.max(dest.y, Math.min(dest.y + dest.h - 1, r.y));
        addDir(r.x, r.y, Math.sign(clampedX - r.x), Math.sign(clampedY - r.y));
      }
    }

    return map;
  }

  private isInternalRoundaboutCorner(
    road: RoadTile,
    buildingDirsMap: Map<string, { dx: number; dy: number }[]>
  ): boolean {
    if (!road.isRoundabout || !road.roundaboutCenter) return false;
    const isCorner =
      Math.abs(road.x - road.roundaboutCenter.x) === 1 &&
      Math.abs(road.y - road.roundaboutCenter.y) === 1;
    if (!isCorner) return false;

    const bDirs = buildingDirsMap.get(`${road.x},${road.y}`);
    if (bDirs && bDirs.length > 0) return false;

    // Only draw if connected to an external non-roundabout road
    for (const { dir, dx, dy } of DIR8_OFFSETS) {
      if (road.connections[dir]) {
        const nb = this.roadNetwork.getRoad(road.x + dx, road.y + dy);
        if (nb && !nb.isRoundabout) return false;
      }
    }
    return true;
  }

  /**
   * Draws smooth curved road geometry inside a tile:
   * - Includes both neighbor road connections AND virtual connections to House driveways / Store entrances!
   * - If the tile is part of a roundabout, flares external arms smoothly onto the circular ring (`r = 0.94 * tileSize`).
   * - For 2-way, 3-way, and 4-way intersections, draws pairwise Quadratic Bezier curves between all non-acute branches so every turn and T-junction has smooth curved fillets!
   */
  private drawTileRoadGeometry(
    road: RoadTile,
    cx: number,
    cy: number,
    tileSize: number,
    buildingDirsMap: Map<string, { dx: number; dy: number }[]>,
    isCenterLanePass: boolean
  ) {
    const activeDirs: { dx: number; dy: number; ex: number; ey: number; isBuilding: boolean }[] = [];
    const half = tileSize * 0.5;

    for (const { dir, dx, dy } of DIR8_OFFSETS) {
      if (road.connections[dir]) {
        if (road.isRoundabout) {
          const nb = this.roadNetwork.getRoad(road.x + dx, road.y + dy);
          if (nb && nb.isRoundabout) continue;
        }
        activeDirs.push({
          dx,
          dy,
          ex: cx + dx * half,
          ey: cy + dy * half,
          isBuilding: false,
        });
      }
    }

    const bDirs = buildingDirsMap.get(`${road.x},${road.y}`);
    if (bDirs) {
      for (const bd of bDirs) {
        if (!activeDirs.some((a) => a.dx === bd.dx && a.dy === bd.dy)) {
          activeDirs.push({
            dx: bd.dx,
            dy: bd.dy,
            ex: cx + bd.dx * half,
            ey: cy + bd.dy * half,
            isBuilding: true,
          });
        }
      }
    }

    this.ctx.beginPath();

    // Roundabout perimeter tiles: flare external arms smoothly onto the roundabout ring
    if (road.isRoundabout && road.roundaboutCenter) {
      const rcx = (road.roundaboutCenter.x + 0.5) * tileSize;
      const rcy = (road.roundaboutCenter.y + 0.5) * tileSize;
      const ringRadius = tileSize * 0.94;
      const baseAngle = Math.atan2(cy - rcy, cx - rcx);
      const ringX = rcx + Math.cos(baseAngle) * ringRadius;
      const ringY = rcy + Math.sin(baseAngle) * ringRadius;

      for (const a of activeDirs) {
        this.ctx.moveTo(a.ex, a.ey);
        this.ctx.quadraticCurveTo(cx, cy, ringX, ringY);

        if (!isCenterLanePass) {
          // Tangent flares left & right onto the roundabout circle so corner joins never pinch
          const leftAngle = baseAngle - 0.30;
          const rightAngle = baseAngle + 0.30;
          this.ctx.moveTo(a.ex, a.ey);
          this.ctx.quadraticCurveTo(
            ringX,
            ringY,
            rcx + Math.cos(leftAngle) * ringRadius,
            rcy + Math.sin(leftAngle) * ringRadius
          );
          this.ctx.moveTo(a.ex, a.ey);
          this.ctx.quadraticCurveTo(
            ringX,
            ringY,
            rcx + Math.cos(rightAngle) * ringRadius,
            rcy + Math.sin(rightAngle) * ringRadius
          );
        }
      }
      return;
    }

    if (activeDirs.length === 0) {
      if (!isCenterLanePass) {
        this.ctx.moveTo(cx - 0.5, cy);
        this.ctx.lineTo(cx + 0.5, cy);
      }
      return;
    }

    if (activeDirs.length === 1) {
      const a = activeDirs[0];
      if (!isCenterLanePass || !a.isBuilding) {
        this.ctx.moveTo(cx, cy);
        this.ctx.lineTo(a.ex, a.ey);
      }
      return;
    }

    if (isCenterLanePass) {
      if (activeDirs.length === 2) {
        const a = activeDirs[0];
        const b = activeDirs[1];
        // If one arm is a building driveway, stop the dashed centerline at the road edge
        if (a.isBuilding && !b.isBuilding) {
          this.ctx.moveTo(cx, cy);
          this.ctx.lineTo(b.ex, b.ey);
        } else if (b.isBuilding && !a.isBuilding) {
          this.ctx.moveTo(cx, cy);
          this.ctx.lineTo(a.ex, a.ey);
        } else if (!a.isBuilding && !b.isBuilding) {
          this.ctx.moveTo(a.ex, a.ey);
          this.ctx.quadraticCurveTo(cx, cy, b.ex, b.ey);
        }
      } else {
        // At 3-way and 4-way intersections, keep the center box clear of overlapping dashes
        for (const a of activeDirs) {
          if (a.isBuilding) continue;
          const ix = cx + (a.ex - cx) * 0.42;
          const iy = cy + (a.ey - cy) * 0.42;
          this.ctx.moveTo(ix, iy);
          this.ctx.lineTo(a.ex, a.ey);
        }
      }
      return;
    }

    // For Casing (Pass A) and Asphalt (Pass B) with 2+ connections:
    // Draw pairwise Quadratic Bezier curves for all non-acute pairs of arms so every 2-way, 3-way, and 4-way turn has smooth curved fillets!
    for (let i = 0; i < activeDirs.length; i++) {
      for (let j = i + 1; j < activeDirs.length; j++) {
        const a = activeDirs[i];
        const b = activeDirs[j];
        const lenA = Math.hypot(a.dx, a.dy) || 1;
        const lenB = Math.hypot(b.dx, b.dy) || 1;
        const dot = (a.dx * b.dx + a.dy * b.dy) / (lenA * lenB);

        if (dot <= 0.55) {
          this.ctx.moveTo(a.ex, a.ey);
          this.ctx.quadraticCurveTo(cx, cy, b.ex, b.ey);
        } else {
          this.ctx.moveTo(cx, cy);
          this.ctx.lineTo(a.ex, a.ey);
          this.ctx.moveTo(cx, cy);
          this.ctx.lineTo(b.ex, b.ey);
        }
      }
    }
  }

  /**
   * Connects houses and destination parking lots seamlessly into adjacent road tiles
   * at matching road width when a road is connected.
   */
  private drawBuildingConnectorThroats(tileSize: number, lineWidth: number) {
    this.ctx.save();
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';

    // House driveways (only extend outside the house lot when connected to a road)
    for (const house of this.level.houses) {
      const connectedRoads = this.traffic.getHouseRoadNeighbors(house);
      if (connectedRoads.length === 0) continue;
      const targetTile = connectedRoads[0];

      const hcx = (house.x + 0.5) * tileSize;
      const hcy = (house.y + 0.5) * tileSize;
      const reach = 0.52;
      const tx = hcx + (targetTile.x - house.x) * tileSize * reach;
      const ty = hcy + (targetTile.y - house.y) * tileSize * reach;

      this.ctx.beginPath();
      this.ctx.moveTo(hcx, hcy);
      this.ctx.lineTo(tx, ty);
      this.ctx.stroke();
    }

    // Destination parking lot entrance throats (100% full road width when connected to a road)
    this.ctx.lineWidth = lineWidth;
    for (const dest of this.level.destinations) {
      const connectedRoads = this.traffic.getDestinationRoadNeighbors(dest);
      if (connectedRoads.length === 0) continue;
      const targetTile = connectedRoads[0];

      const clampedX = Math.max(dest.x + 0.5, Math.min(dest.x + dest.w - 0.5, targetTile.x + 0.5));
      const clampedY = Math.max(dest.y + 0.5, Math.min(dest.y + dest.h - 0.5, targetTile.y + 0.5));

      const ox = clampedX * tileSize;
      const oy = clampedY * tileSize;
      const reach = 0.52;
      const tx = ox + (targetTile.x + 0.5 - clampedX) * tileSize * reach;
      const ty = oy + (targetTile.y + 0.5 - clampedY) * tileSize * reach;

      this.ctx.beginPath();
      this.ctx.moveTo(ox, oy);
      this.ctx.lineTo(tx, ty);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  private renderInteractions(
    hoverCoord: GridCoord | null,
    currentTool: 'draw' | 'erase' | 'motorway' | 'roundabout' | 'traffic_light' | 'subway' | 'blueprint',
    dragPath: GridCoord[],
    motorwayStart: GridCoord | null
  ) {
    const tileSize = CONFIG.TILE_SIZE;

    // Gentle onboarding guide when no roads have been drawn yet
    if (
      this.roadNetwork.roads.size === 0 &&
      this.roadNetwork.motorways.length === 0 &&
      this.roadNetwork.subways.length === 0 &&
      this.level.houses.length > 0 &&
      this.level.destinations.length > 0
    ) {
      const h = this.level.houses[0];
      const d = this.level.destinations[0];
      const sx = (h.driveway.x + 0.5) * tileSize;
      const sy = (h.driveway.y + 0.5) * tileSize;
      const ex = (d.entrance.x + 0.5) * tileSize;
      const ey = (d.entrance.y + 0.5) * tileSize;

      this.ctx.save();
      this.ctx.strokeStyle = 'rgba(232, 72, 85, 0.35)';
      this.ctx.lineWidth = 6;
      this.ctx.lineCap = 'round';
      this.ctx.setLineDash([10, 10]);
      this.ctx.lineDashOffset = -this.animTime * 28;
      this.ctx.beginPath();
      this.ctx.moveTo(sx, sy);
      const midX = (sx + ex) * 0.5;
      this.ctx.bezierCurveTo(midX, sy, midX, ey, ex, ey);
      this.ctx.stroke();
      this.ctx.restore();
    }

    if (currentTool === 'blueprint') {
      const coords = dragPath.length > 0 ? dragPath : hoverCoord ? [hoverCoord] : [];
      this.ctx.save();
      this.ctx.fillStyle = 'rgba(14, 165, 233, 0.45)';
      this.ctx.strokeStyle = '#38bdf8';
      this.ctx.lineWidth = 1.5;

      for (const c of coords) {
        if (c.x < 0 || c.x >= CONFIG.GRID_COLS || c.y < 0 || c.y >= CONFIG.GRID_ROWS) continue;
        const cx = (c.x + 0.5) * tileSize;
        const cy = (c.y + 0.5) * tileSize;

        this.ctx.beginPath();
        this.ctx.arc(cx, cy, tileSize * 0.28, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
      }
      this.ctx.restore();
    } else if (currentTool === 'draw' || currentTool === 'erase') {
      const coords = dragPath.length > 0 ? dragPath : hoverCoord ? [hoverCoord] : [];
      this.ctx.fillStyle =
        currentTool === 'draw' ? CONFIG.COLORS.ROAD_PREVIEW : CONFIG.COLORS.ROAD_ERASE_PREVIEW;

      for (const c of coords) {
        if (c.x < 0 || c.x >= CONFIG.GRID_COLS || c.y < 0 || c.y >= CONFIG.GRID_ROWS) continue;
        const cx = (c.x + 0.5) * tileSize;
        const cy = (c.y + 0.5) * tileSize;

        this.ctx.beginPath();
        this.ctx.arc(cx, cy, tileSize * 0.24, 0, Math.PI * 2);
        this.ctx.fill();
      }
    } else if (currentTool === 'roundabout' && hoverCoord) {
      const rcx = (hoverCoord.x + 0.5) * tileSize;
      const rcy = (hoverCoord.y + 0.5) * tileSize;
      this.ctx.save();
      this.ctx.strokeStyle = 'rgba(67, 74, 87, 0.55)';
      this.ctx.lineWidth = tileSize * 0.42;
      this.ctx.beginPath();
      this.ctx.arc(rcx, rcy, tileSize * 0.95, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.restore();
    } else if (currentTool === 'traffic_light' && hoverCoord) {
      const cx = (hoverCoord.x + 0.5) * tileSize;
      const cy = (hoverCoord.y + 0.5) * tileSize;
      this.ctx.fillStyle = 'rgba(46, 204, 113, 0.45)';
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, tileSize * 0.32, 0, Math.PI * 2);
      this.ctx.fill();
    } else if (currentTool === 'motorway' && motorwayStart && hoverCoord) {
      const sx = (motorwayStart.x + 0.5) * tileSize;
      const sy = (motorwayStart.y + 0.5) * tileSize;
      const ex = (hoverCoord.x + 0.5) * tileSize;
      const ey = (hoverCoord.y + 0.5) * tileSize;
      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2 - 36;

      this.ctx.save();
      this.ctx.strokeStyle = 'rgba(84, 66, 214, 0.55)';
      this.ctx.lineWidth = 14;
      this.ctx.lineCap = 'round';
      this.ctx.setLineDash([10, 7]);
      this.ctx.beginPath();
      this.ctx.moveTo(sx, sy);
      this.ctx.quadraticCurveTo(mx, my, ex, ey);
      this.ctx.stroke();
      this.ctx.restore();
    } else if (currentTool === 'subway') {
      // Collect active station portals to display their compact walking catchment radius & connected buildings
      const previewStations: GridCoord[] = [];
      for (const sub of this.roadNetwork.subways) {
        previewStations.push(sub.start, sub.end);
      }
      if (motorwayStart) previewStations.push(motorwayStart);
      if (hoverCoord) previewStations.push(hoverCoord);

      const catchRadiusTiles = CONFIG.GAMEPLAY.SUBWAY_CATCHMENT_RADIUS;
      this.ctx.save();
      for (const st of previewStations) {
        const scx = (st.x + 0.5) * tileSize;
        const scy = (st.y + 0.5) * tileSize;
        const catchRadius = catchRadiusTiles * tileSize;

        // Soft translucent teal catchment fill
        this.ctx.fillStyle = 'rgba(15, 165, 155, 0.11)';
        this.ctx.beginPath();
        this.ctx.arc(scx, scy, catchRadius, 0, Math.PI * 2);
        this.ctx.fill();

        // Crisp dashed outer catchment ring
        this.ctx.strokeStyle = 'rgba(31, 209, 195, 0.72)';
        this.ctx.lineWidth = 2.0;
        this.ctx.setLineDash([6, 5]);
        this.ctx.beginPath();
        this.ctx.arc(scx, scy, catchRadius, 0, Math.PI * 2);
        this.ctx.stroke();

        // Draw walking tether lines to every House/Apartment/High-Rise & Store inside this station's catchment!
        this.ctx.strokeStyle = 'rgba(31, 209, 195, 0.58)';
        this.ctx.lineWidth = 1.8;
        this.ctx.setLineDash([4, 4]);
        for (const h of this.level.houses) {
          const dist = Math.hypot(h.x + 0.5 - (st.x + 0.5), h.y + 0.5 - (st.y + 0.5));
          if (dist <= catchRadiusTiles) {
            this.ctx.beginPath();
            this.ctx.moveTo(scx, scy);
            this.ctx.lineTo((h.x + 0.5) * tileSize, (h.y + 0.5) * tileSize);
            this.ctx.stroke();
          }
        }
        for (const d of this.level.destinations) {
          const dist = Math.hypot(
            d.x + d.w * 0.5 - (st.x + 0.5),
            d.y + d.h * 0.5 - (st.y + 0.5)
          );
          if (dist <= catchRadiusTiles) {
            this.ctx.beginPath();
            this.ctx.moveTo(scx, scy);
            this.ctx.lineTo((d.x + d.w * 0.5) * tileSize, (d.y + d.h * 0.5) * tileSize);
            this.ctx.stroke();
          }
        }
      }
      this.ctx.restore();

      if (motorwayStart && hoverCoord) {
        const sx = (motorwayStart.x + 0.5) * tileSize;
        const sy = (motorwayStart.y + 0.5) * tileSize;
        const ex = (hoverCoord.x + 0.5) * tileSize;
        const ey = (hoverCoord.y + 0.5) * tileSize;

        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(0, 168, 150, 0.78)';
        this.ctx.lineWidth = 8;
        this.ctx.lineCap = 'round';
        this.ctx.setLineDash([8, 6]);
        this.ctx.beginPath();
        this.ctx.moveTo(sx, sy);
        this.ctx.lineTo(ex, ey);
        this.ctx.stroke();
        this.ctx.restore();
      } else if (hoverCoord) {
        const cx = (hoverCoord.x + 0.5) * tileSize;
        const cy = (hoverCoord.y + 0.5) * tileSize;
        this.ctx.fillStyle = 'rgba(0, 168, 150, 0.65)';
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, 13, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  private renderHouses() {
    const tileSize = CONFIG.TILE_SIZE;
    const theme = this.getTheme();
    const roadWidth = tileSize * 0.48;
    const casingWidth = roadWidth + 5;

    for (const house of this.level.houses) {
      const cx = (house.x + 0.5) * tileSize;
      const cy = (house.y + 0.5) * tileSize;
      const scheme = CONFIG.COLORS.BUILDINGS[house.color];
      const scale = this.easeOutBack(house.spawnAnimation);
      const tier = house.tier || 1;

      const connectedRoads = this.traffic.getHouseRoadNeighbors(house);
      const isConnected = connectedRoads.length > 0;
      const targetTile = isConnected ? connectedRoads[0] : house.driveway;
      const driveAngle = Math.atan2(targetTile.y - house.y, targetTile.x - house.x);

      this.ctx.save();
      this.ctx.translate(cx, cy);
      this.ctx.scale(scale, scale);

      // 1. Property Lot Pad & Driveway Apron (rotated toward driveway)
      this.ctx.save();
      this.ctx.rotate(driveAngle);

      this.ctx.fillStyle = this.isNightMode ? '#222B3B' : scheme.lot;
      this.roundRect(-tileSize * 0.44, -tileSize * 0.40, tileSize * 0.88, tileSize * 0.80, 7);
      this.ctx.fill();

      // Distance to target tile (1 for orthogonal, sqrt(2) for diagonal)
      const targetDist = Math.hypot(targetTile.x - house.x, targetTile.y - house.y);
      const reach = isConnected ? targetDist * tileSize * 0.52 : tileSize * 0.44;
      const apronLength = reach + 2;

      // Outer Casing Underlay (matches road casing: theme.ROAD_CASING and casingWidth)
      this.ctx.fillStyle = theme.ROAD_CASING;
      this.roundRect(-2, -casingWidth / 2, apronLength, casingWidth, isConnected ? 2 : 4);
      this.ctx.fill();

      // Seamless asphalt driveway apron (matches road asphalt: theme.ROAD_ASPHALT and roadWidth)
      this.ctx.fillStyle = theme.ROAD_ASPHALT;
      this.roundRect(-2, -roadWidth / 2, apronLength, roadWidth, isConnected ? 1 : 3);
      this.ctx.fill();

      // 2. Parked Cars inside driveway bays (supports up to 6 cars for High-Rises!)
      const visibleCars = Math.min(house.availableCars, 4);
      for (let i = 0; i < visibleCars; i++) {
        const col = Math.floor(i / 2);
        const row = i % 2;
        const bayY = (row === 0 ? -1 : 1) * 5.2;
        const bayX = 11.5 - col * 5.2;
        this.drawDetailedCar(bayX, bayY, 0, house.color, 0.68, false, false);
      }

      // Shift building body slightly back along the driveway axis, then un-rotate so lighting/shadows are globally consistent!
      this.ctx.translate(-4.5, 0);
      this.ctx.rotate(-driveAngle);

      // Render crisp 3D Diorama residential architecture (Design A)
      const houseSeed = (house.x * 37 + house.y * 19 + tier * 7) % 1000;
      drawResidential(
        this.ctx,
        'diorama',
        tier,
        scheme,
        this.isNightMode,
        houseSeed,
        this.animTime
      );

      this.ctx.restore();
      this.ctx.restore();
    }
  }

  private renderConstructionSites() {
    const tileSize = CONFIG.TILE_SIZE;

    for (const site of this.level.constructionSites) {
      const px = site.x * tileSize;
      const py = site.y * tileSize;
      const pw = site.w * tileSize;
      const ph = site.h * tileSize;
      const cx = px + pw / 2;
      const cy = py + ph / 2;
      const scheme = CONFIG.COLORS.BUILDINGS[site.color];
      const mainCol = scheme ? scheme.main : '#2B85E4';

      this.ctx.save();

      // 1. Blueprint excavation ground wash
      this.ctx.fillStyle = 'rgba(43, 133, 228, 0.09)';
      this.roundRect(px + 3, py + 3, pw - 6, ph - 6, 8);
      this.ctx.fill();

      // 2. Animated dashed blueprint perimeter
      this.ctx.strokeStyle = mainCol;
      this.ctx.lineWidth = 2.4;
      this.ctx.setLineDash([6, 5]);
      this.ctx.lineDashOffset = -this.animTime * 18;
      this.roundRect(px + 4, py + 4, pw - 8, ph - 8, 8);
      this.ctx.stroke();
      this.ctx.setLineDash([]);

      // 3. Corner safety cones & survey stakes
      const corners = [
        [px + 6, py + 6],
        [px + pw - 6, py + 6],
        [px + pw - 6, py + ph - 6],
        [px + 6, py + ph - 6],
      ];
      for (const [cornX, cornY] of corners) {
        this.ctx.fillStyle = '#FF793F';
        this.ctx.beginPath();
        this.ctx.arc(cornX, cornY, 4, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.beginPath();
        this.ctx.arc(cornX, cornY, 1.8, 0, Math.PI * 2);
        this.ctx.fill();
      }

      // 4. Designated Entrance / Driveway Nub Preview
      const ex = (site.entrance.x + 0.5) * tileSize;
      const ey = (site.entrance.y + 0.5) * tileSize;
      const dirX = Math.sign(site.entrance.x + 0.5 - (site.x + site.w * 0.5));
      const dirY = Math.sign(site.entrance.y + 0.5 - (site.y + site.h * 0.5));

      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
      this.ctx.lineWidth = tileSize * 0.36;
      this.ctx.lineCap = 'round';
      this.ctx.beginPath();
      const mouthX = cx + dirX * (pw * 0.5 - 4);
      const mouthY = cy + dirY * (ph * 0.5 - 4);
      this.ctx.moveTo(mouthX, mouthY);
      this.ctx.lineTo(mouthX + dirX * (tileSize * 0.32), mouthY + dirY * (tileSize * 0.32));
      this.ctx.stroke();

      // Entrance target ring
      this.ctx.strokeStyle = mainCol;
      this.ctx.lineWidth = 2.0;
      this.ctx.beginPath();
      this.ctx.arc(ex, ey, 5.5, 0, Math.PI * 2);
      this.ctx.stroke();

      // 5. Floating Blueprint Badge with Countdown
      const remainingSecs = Math.max(0.1, site.previewTimer).toFixed(0);
      this.ctx.translate(cx, cy);

      // Badge Drop Shadow
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
      this.roundRect(-54, -13, 108, 26, 13);
      this.ctx.fill();

      // Badge Core
      this.ctx.fillStyle = '#181D27';
      this.roundRect(-52, -12, 104, 24, 12);
      this.ctx.fill();

      // Color Swatch
      this.ctx.fillStyle = mainCol;
      this.ctx.beginPath();
      this.ctx.arc(-39, 0, 5, 0, Math.PI * 2);
      this.ctx.fill();

      // Text Label & Timer
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.font = '700 9.5px "Plus Jakarta Sans", sans-serif';
      this.ctx.textAlign = 'left';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(`SURVEYING ${remainingSecs}s`, -29, 0.5);

      this.ctx.restore();
    }
  }

  private renderDestinations() {
    const tileSize = CONFIG.TILE_SIZE;
    const theme = this.getTheme();

    for (const dest of this.level.destinations) {
      const px = dest.x * tileSize;
      const py = dest.y * tileSize;
      const pw = dest.w * tileSize;
      const ph = dest.h * tileSize;
      const cx = px + pw / 2;
      const cy = py + ph / 2;
      const scheme = CONFIG.COLORS.BUILDINGS[dest.color];
      const scale = this.easeOutBack(dest.spawnAnimation);

      const connectedRoads = this.traffic.getDestinationRoadNeighbors(dest);
      const targetTile = dest.entrance;
      const isNorthEntrance = dest.entrance.y < dest.y;
      const clampedX = Math.max(dest.x + 0.5, Math.min(dest.x + dest.w - 0.5, targetTile.x + 0.5));
      const clampedY = Math.max(dest.y + 0.5, Math.min(dest.y + dest.h - 0.5, targetTile.y + 0.5));

      this.ctx.save();
      this.ctx.translate(cx, cy);
      this.ctx.scale(scale, scale);

      const halfW = pw / 2 - 2;
      const halfH = ph / 2 - 2;

      // Determine early warning / overflow status
      const warningThreshold = CONFIG.GAMEPLAY.OVERFLOW_WARNING_THRESHOLD;
      let stage: StoreAlertStage = 'calm';
      const progress = dest.maxOverflowTime > 0 ? Math.min(1.0, dest.overflowTimer / dest.maxOverflowTime) : 0;
      if (dest.overflowTimer > 0) {
        stage = progress > 0.65 ? 'critical' : 'overflowing';
      } else if (dest.pins >= warningThreshold - 1) {
        stage = 'heads-up';
      }

      // Critical stage: subtle building wobble
      if (stage === 'critical') {
        this.ctx.translate(Math.sin(this.animTime * 36) * 0.75, 0);
      }

      // 0. Store danger ground glow & ripple under lot
      if (stage !== 'calm') {
        drawStoreAlert(this.ctx, stage, progress, 0, 0, halfW, halfH, this.animTime, 'under');
      }

      // 1. Compound Base Lot & Drop Shadow
      this.ctx.fillStyle = scheme.shadow;
      this.roundRect(-halfW + 3, -halfH + 5, halfW * 2, halfH * 2, 12);
      this.ctx.fill();

      this.ctx.fillStyle = this.isNightMode ? '#222B3B' : scheme.lot;
      this.roundRect(-halfW, -halfH, halfW * 2, halfH * 2, 12);
      this.ctx.fill();
      if (this.isNightMode) {
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        this.ctx.lineWidth = 1.2;
        this.ctx.stroke();
      }

      // 2. Asphalt Parking Lot (automatically faces North if connected from North, otherwise South!)
      const lotH = halfH - 5;
      const lotTop = isNorthEntrance ? -halfH + 5 : 2;
      this.ctx.fillStyle = theme.ROAD_ASPHALT;
      this.roundRect(-halfW + 5, lotTop, (halfW - 5) * 2, lotH, 7);
      this.ctx.fill();

      // Seamless asphalt mouth connecting the parking lot across the outer lot border when a road is connected
      const localMouthX = clampedX * tileSize - cx;
      const localMouthY = clampedY * tileSize - cy;
      if (connectedRoads.length > 0) {
        const dirX = Math.sign(targetTile.x + 0.5 - clampedX);
        const dirY = Math.sign(targetTile.y + 0.5 - clampedY);
        this.ctx.strokeStyle = theme.ROAD_ASPHALT;
        this.ctx.lineWidth = tileSize * 0.48;
        this.ctx.lineCap = 'round';
        this.ctx.beginPath();
        this.ctx.moveTo(localMouthX, localMouthY);
        this.ctx.lineTo(
          localMouthX + dirX * (tileSize * 0.46),
          localMouthY + dirY * (tileSize * 0.46)
        );
        this.ctx.stroke();
      } else {
        // Option 1 tactile driveway nub: show a clean driveway nub extending toward dest.entrance
        // so the player clearly sees where the entrance road connects!
        const dirX = Math.sign(targetTile.x + 0.5 - clampedX);
        const dirY = Math.sign(targetTile.y + 0.5 - clampedY);
        this.ctx.strokeStyle = theme.ROAD_ASPHALT;
        this.ctx.lineWidth = tileSize * 0.38;
        this.ctx.lineCap = 'round';
        this.ctx.beginPath();
        this.ctx.moveTo(localMouthX, localMouthY);
        this.ctx.lineTo(
          localMouthX + dirX * (tileSize * 0.22),
          localMouthY + dirY * (tileSize * 0.22)
        );
        this.ctx.stroke();
      }

      // Painted White Parking Stalls
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      this.ctx.lineWidth = 1.5;
      for (let s = -1; s <= 1; s++) {
        const sx = s * 16;
        this.ctx.beginPath();
        this.ctx.moveTo(sx, lotTop + 4);
        this.ctx.lineTo(sx, lotTop + lotH - 4);
        this.ctx.stroke();
      }

      // Draw any cars currently parked in stalls
      for (let i = 0; i < 4; i++) {
        if (dest.activeParkingStalls[i]) {
          const stallX = -22 + i * 15;
          const stallY = lotTop + lotH * 0.5;
          const parkedAngle = isNorthEntrance ? Math.PI / 2 : -Math.PI / 2;
          this.drawDetailedCar(stallX, stallY, parkedAngle, dest.color, 0.78, false, false);
        }
      }

      // Subtle entrance arrow marking on parking lot apron aligned with active entrance
      const arrowX = localMouthX >= 0 ? halfW - 17 : -halfW + 17;
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.52)';
      this.ctx.lineWidth = 1.8;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.beginPath();
      if (isNorthEntrance) {
        this.ctx.moveTo(arrowX - 4, lotTop + 4);
        this.ctx.lineTo(arrowX, lotTop + 8);
        this.ctx.lineTo(arrowX + 4, lotTop + 4);
      } else {
        this.ctx.moveTo(arrowX - 4, lotTop + lotH - 4);
        this.ctx.lineTo(arrowX, lotTop + lotH - 8);
        this.ctx.lineTo(arrowX + 4, lotTop + lotH - 4);
      }
      this.ctx.stroke();

      // 3. Architectural 3D Diorama Building Structure (Design A matching houses)
      const destType = dest.isTrainStation ? 'station' : dest.isCircular ? 'circular' : 'store';
      const destSeed = (dest.x * 47 + dest.y * 23) % 1000;
      drawDestination(
        this.ctx,
        destType,
        scheme,
        this.isNightMode,
        destSeed,
        this.animTime,
        {
          isNorthEntrance,
          criticalDanger: stage === 'critical',
          offsetY: isNorthEntrance ? 20 : -20,
        }
      );

      this.ctx.restore();
    }
  }

  /**
   * Renders floating 3D Demand Pins and the iconic Overcrowding Clock Dial
   * on top of Destinations.
   */
  private renderDestinationOverlays() {
    const tileSize = CONFIG.TILE_SIZE;

    for (const dest of this.level.destinations) {
      const px = dest.x * tileSize;
      const py = dest.y * tileSize;
      const pw = dest.w * tileSize;
      const ph = dest.h * tileSize;
      const cx = px + pw / 2;
      const cy = py + ph / 2;
      const scheme = CONFIG.COLORS.BUILDINGS[dest.color];

      const isNorthEntrance = dest.entrance.y < dest.y;
      const basePinY = isNorthEntrance ? py + 54 : py + 18;

      // Determine early warning / overflow status
      const warningThreshold = CONFIG.GAMEPLAY.OVERFLOW_WARNING_THRESHOLD;
      let stage: StoreAlertStage = 'calm';
      const progress = dest.maxOverflowTime > 0 ? Math.min(1.0, dest.overflowTimer / dest.maxOverflowTime) : 0;
      if (dest.overflowTimer > 0) {
        stage = progress > 0.65 ? 'critical' : 'overflowing';
      } else if (dest.pins >= warningThreshold - 1) {
        stage = 'heads-up';
      }

      const halfW = pw / 2 - 2;
      const halfH = ph / 2 - 2;

      // Draw perimeter countdown ring & floating alert badge ("!" / "!!" / "!!!")
      if (stage !== 'calm') {
        this.ctx.save();
        this.ctx.translate(cx, cy);
        drawStoreAlert(this.ctx, stage, progress, 0, 0, halfW, halfH, this.animTime, 'over');
        this.ctx.restore();
      }

      // Feature #3: Store Connection Grace Period indicator (calm introductory connection window)
      if (dest.gracePeriodTimer && dest.gracePeriodTimer > 0) {
        const graceSecs = Math.ceil(dest.gracePeriodTimer);
        this.ctx.save();
        this.ctx.translate(cx, py - 14);

        // Shadow
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        this.roundRect(-48, -11, 96, 22, 11);
        this.ctx.fill();

        // Amber Capsule with pulsing glow
        this.ctx.fillStyle = '#D97706';
        this.roundRect(-46, -10, 92, 20, 10);
        this.ctx.fill();

        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '700 9.5px "Plus Jakarta Sans", sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(`✨ OPENING (${graceSecs}s)`, 0, 0.5);
        this.ctx.restore();
      }

      // 1. Floating 3D Demand Pins
      const pinRadius = 7.5;
      const pinSpacing = 17;

      for (let i = 0; i < dest.pins; i++) {
        const animScale = this.easeOutBack(dest.pinAnimations[i] ?? 1);
        const col = i % 4;
        const row = Math.floor(i / 4);
        const rowCount = Math.min(4, dest.pins - row * 4);
        const startX = cx - ((rowCount - 1) * pinSpacing) / 2;

        const jig = stage === 'critical' ? 2.5 : stage === 'overflowing' ? 1.4 : 0.6;
        const bob = Math.sin(this.animTime * (stage === 'critical' ? 16 : 3.5) + i * 0.9) * (stage === 'calm' ? 1.8 : jig * 1.8);
        const pinX = startX + col * pinSpacing;
        const pinY = basePinY + row * 17 + bob;

        this.ctx.save();
        this.ctx.translate(pinX, pinY);
        this.ctx.scale(animScale, animScale);

        // Pin Drop Shadow
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        this.ctx.beginPath();
        this.ctx.arc(1, 2.5, pinRadius, 0, Math.PI * 2);
        this.ctx.fill();

        // Pin White Outer Rim
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.beginPath();
        this.ctx.arc(0, 0, pinRadius, 0, Math.PI * 2);
        this.ctx.fill();

        // Pin Colored Core
        this.ctx.fillStyle = scheme.main;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, pinRadius - 2.2, 0, Math.PI * 2);
        this.ctx.fill();

        // Pin Center Specular Dot
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.beginPath();
        this.ctx.arc(0, 0, 2.0, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.restore();
      }

      // 2. Iconic Mini Motorways Pie-Chart Overcrowding Timer Badge
      if (dest.overflowTimer > 0) {
        const progress = Math.min(1.0, dest.overflowTimer / dest.maxOverflowTime);
        const isCritical = progress > 0.65;
        const pulse = isCritical ? 1 + Math.sin(this.animTime * 16) * 0.12 : 1;
        const badgeX = px + pw - 4;
        const badgeY = py + 4;
        const radius = 14;

        this.ctx.save();
        this.ctx.translate(badgeX, badgeY);
        this.ctx.scale(pulse, pulse);

        // Shadow
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        this.ctx.beginPath();
        this.ctx.arc(1, 2.5, radius + 2, 0, Math.PI * 2);
        this.ctx.fill();

        // White outer clock casing
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.beginPath();
        this.ctx.arc(0, 0, radius + 2, 0, Math.PI * 2);
        this.ctx.fill();

        // Dark clock face background
        this.ctx.fillStyle = '#2C313A';
        this.ctx.beginPath();
        this.ctx.arc(0, 0, radius - 0.5, 0, Math.PI * 2);
        this.ctx.fill();

        // Sweeping Pie Chart Sector
        this.ctx.fillStyle = isCritical
          ? CONFIG.COLORS.UI_TIMER_DANGER
          : CONFIG.COLORS.UI_TIMER_WARNING;
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.arc(
          0,
          0,
          radius - 2,
          -Math.PI / 2,
          -Math.PI / 2 + progress * Math.PI * 2
        );
        this.ctx.closePath();
        this.ctx.fill();

        this.ctx.restore();
      }

      // 3. Game-Over Spotlight Beacon & Callout Tag on the exact Destination that overflowed!
      if (this.level.failedDestId === dest.id) {
        const ph = dest.h * tileSize;
        const cy = py + ph / 2;
        const pulseRing = 1 + Math.sin(this.animTime * 8) * 0.08;

        this.ctx.save();
        // Pulsing danger halo around the failed destination
        this.ctx.strokeStyle = '#FF3B30';
        this.ctx.lineWidth = 4;
        this.ctx.setLineDash([8, 6]);
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, Math.max(pw, ph) * 0.72 * pulseRing, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        // Floating Callout Banner above the failed building
        const bannerW = 148;
        const bannerH = 26;
        const bannerX = cx - bannerW / 2;
        const bannerY = py - 38 + Math.sin(this.animTime * 6) * 3;

        this.ctx.fillStyle = '#E84855';
        this.roundRect(bannerX, bannerY, bannerW, bannerH, 8);
        this.ctx.fill();
        this.ctx.strokeStyle = '#FFFFFF';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Downward pointer triangle
        this.ctx.fillStyle = '#E84855';
        this.ctx.beginPath();
        this.ctx.moveTo(cx - 6, bannerY + bannerH);
        this.ctx.lineTo(cx + 6, bannerY + bannerH);
        this.ctx.lineTo(cx, bannerY + bannerH + 7);
        this.ctx.closePath();
        this.ctx.fill();

        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '800 11px "Plus Jakarta Sans", sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('⚠️ OVERFLOWED HERE', cx, bannerY + bannerH / 2);
        this.ctx.restore();
      }
    }
  }

  private renderTrees() {
    const tileSize = CONFIG.TILE_SIZE;
    const theme = this.getTheme();

    for (const tree of this.roadNetwork.trees) {
      // Do not render if a building or road was placed right on it
      const gx = Math.floor(tree.x);
      const gy = Math.floor(tree.y);
      if (this.roadNetwork.hasRoad(gx, gy) || this.level.isOccupied(gx, gy)) {
        continue;
      }

      const sway = Math.sin(this.animTime * tree.swaySpeed + tree.swayOffset) * 1.2;
      const tx = tree.x * tileSize + sway;
      const ty = tree.y * tileSize;
      const r = tree.radius;

      // Directional canopy shadow
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.09)';
      this.ctx.beginPath();
      this.ctx.arc(tx + 3, ty + 4, r, 0, Math.PI * 2);
      this.ctx.fill();

      // Main foliage crown
      this.ctx.fillStyle = theme.TREE_SHADES[tree.shadeIndex % theme.TREE_SHADES.length];
      this.ctx.beginPath();
      this.ctx.arc(tx, ty, r, 0, Math.PI * 2);
      this.ctx.fill();

      // Sunlit top-left highlight puff
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      this.ctx.beginPath();
      this.ctx.arc(tx - r * 0.25, ty - r * 0.25, r * 0.55, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private renderMotorways() {
    const tileSize = CONFIG.TILE_SIZE;
    const placedShields: { x: number; y: number }[] = [];

    for (const m of this.roadNetwork.motorways) {
      const sx = (m.start.x + 0.5) * tileSize;
      const sy = (m.start.y + 0.5) * tileSize;
      const ex = (m.end.x + 0.5) * tileSize;
      const ey = (m.end.y + 0.5) * tileSize;

      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2 - 36;

      this.ctx.save();
      this.ctx.lineCap = 'round';

      // 1. Cast Shadow on Ground
      this.ctx.strokeStyle = CONFIG.COLORS.MOTORWAY_SHADOW;
      this.ctx.lineWidth = 20;
      this.ctx.beginPath();
      this.ctx.moveTo(sx, sy + 10);
      this.ctx.quadraticCurveTo(mx, my + 24, ex, ey + 10);
      this.ctx.stroke();

      // 2. Outer Highway Casing & Ramp Terminals
      this.ctx.fillStyle = CONFIG.COLORS.MOTORWAY_CASING;
      this.ctx.beginPath();
      this.ctx.arc(sx, sy, 13, 0, Math.PI * 2);
      this.ctx.arc(ex, ey, 13, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.strokeStyle = CONFIG.COLORS.MOTORWAY_CASING;
      this.ctx.lineWidth = 19;
      this.ctx.beginPath();
      this.ctx.moveTo(sx, sy);
      this.ctx.quadraticCurveTo(mx, my, ex, ey);
      this.ctx.stroke();

      // 3. Inner Express Deck & Ramp Centers
      this.ctx.fillStyle = CONFIG.COLORS.MOTORWAY_ASPHALT;
      this.ctx.beginPath();
      this.ctx.arc(sx, sy, 9.5, 0, Math.PI * 2);
      this.ctx.arc(ex, ey, 9.5, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.strokeStyle = CONFIG.COLORS.MOTORWAY_ASPHALT;
      this.ctx.lineWidth = 14;
      this.ctx.beginPath();
      this.ctx.moveTo(sx, sy);
      this.ctx.quadraticCurveTo(mx, my, ex, ey);
      this.ctx.stroke();

      // 4. Center Median Dashed Line
      this.ctx.strokeStyle = CONFIG.COLORS.MOTORWAY_LANE;
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([7, 6]);
      this.ctx.beginPath();
      this.ctx.moveTo(sx, sy);
      this.ctx.quadraticCurveTo(mx, my, ex, ey);
      this.ctx.stroke();
      this.ctx.restore();

      // 5. Highway Shield Badge (automatically de-conflicted so crossing motorways never stack badges!)
      const candidateTs = [0.5, 0.34, 0.66, 0.24, 0.76];
      let shieldX = 0.25 * sx + 0.5 * mx + 0.25 * ex;
      let shieldY = 0.25 * sy + 0.5 * my + 0.25 * ey;

      for (const t of candidateTs) {
        const inv = 1 - t;
        const bx = inv * inv * sx + 2 * inv * t * mx + t * t * ex;
        const by = inv * inv * sy + 2 * inv * t * my + t * t * ey;
        const overlaps = placedShields.some((p) => Math.hypot(p.x - bx, p.y - by) < 32);
        if (!overlaps) {
          shieldX = bx;
          shieldY = by;
          break;
        }
      }
      placedShields.push({ x: shieldX, y: shieldY });
      this.renderMotorwayShield(shieldX, shieldY, m.number);
    }
  }

  private renderMotorwayShield(x: number, y: number, num: number) {
    this.ctx.save();
    this.ctx.translate(x, y);

    // Drop shadow
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    this.roundRect(-12, -11, 24, 24, 6);
    this.ctx.fill();

    // Shield badge
    this.ctx.fillStyle = CONFIG.COLORS.MOTORWAY_SHIELD_BG;
    this.roundRect(-12, -13, 24, 24, 6);
    this.ctx.fill();

    this.ctx.strokeStyle = CONFIG.COLORS.MOTORWAY_SHIELD_BORDER;
    this.ctx.lineWidth = 2.2;
    this.ctx.stroke();

    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = '800 12px "Plus Jakarta Sans", sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(`M${num}`, 0, -1);

    this.ctx.restore();
  }

  private renderCars(motorwayPass: boolean) {
    const tileSize = CONFIG.TILE_SIZE;

    for (const car of this.traffic.cars) {
      if (car.state === 'at_dest' || car.state === 'home') continue;
      if (car.onMotorway !== motorwayPass) continue;

      const px = car.x * tileSize;
      const py = car.y * tileSize;

      this.drawDetailedCar(
        px,
        py,
        car.angle,
        car.color,
        1.0,
        car.isBraking,
        this.isNightMode
      );
    }
  }

  private drawDetailedCar(
    x: number,
    y: number,
    angle: number,
    color: keyof typeof CONFIG.COLORS.BUILDINGS,
    scale: number,
    isBraking: boolean,
    showHeadlights: boolean
  ) {
    const carLen = CONFIG.TILE_SIZE * 0.34;
    const carWid = CONFIG.TILE_SIZE * 0.20;
    const scheme = CONFIG.COLORS.BUILDINGS[color];

    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(angle);
    this.ctx.scale(scale, scale);

    // Night mode headlight cones
    if (showHeadlights) {
      this.ctx.fillStyle = CONFIG.COLORS.HEADLIGHT_NIGHT;
      this.ctx.beginPath();
      this.ctx.moveTo(carLen * 0.45, -carWid * 0.35);
      this.ctx.lineTo(carLen * 1.6, -carWid * 1.1);
      this.ctx.lineTo(carLen * 1.6, carWid * 1.1);
      this.ctx.lineTo(carLen * 0.45, carWid * 0.35);
      this.ctx.closePath();
      this.ctx.fill();
    }

    // Car Drop Shadow
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
    this.roundRect(-carLen / 2 + 1, -carWid / 2 + 2, carLen, carWid, 3.5);
    this.ctx.fill();

    // Car Main Chassis
    this.ctx.fillStyle = scheme.main;
    this.roundRect(-carLen / 2, -carWid / 2, carLen, carWid, 3.5);
    this.ctx.fill();

    // Rear Trunk Shaded Accent
    this.ctx.fillStyle = scheme.roofDark;
    this.roundRect(-carLen / 2, -carWid / 2, carLen * 0.28, carWid, 2.5);
    this.ctx.fill();

    // Dark-tinted Front & Rear Glass Pack
    this.ctx.fillStyle = 'rgba(24, 32, 44, 0.58)';
    this.roundRect(-carLen * 0.28, -carWid * 0.38, carLen * 0.64, carWid * 0.76, 2.2);
    this.ctx.fill();

    // Bright Cabin Roof Panel (shifted slightly rearward so front windshield is wider)
    this.ctx.fillStyle = scheme.roofLight;
    this.roundRect(-carLen * 0.20, -carWid * 0.35, carLen * 0.36, carWid * 0.70, 1.8);
    this.ctx.fill();

    // Specular Roof Highlight
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    this.roundRect(-carLen * 0.14, -carWid * 0.28, carLen * 0.24, carWid * 0.56, 1.4);
    this.ctx.fill();

    // Glowing Red Brake Lights
    if (isBraking) {
      this.ctx.fillStyle = CONFIG.COLORS.TAILLIGHT;
      this.ctx.beginPath();
      this.ctx.arc(-carLen / 2 + 0.5, -carWid * 0.3, 2.1, 0, Math.PI * 2);
      this.ctx.arc(-carLen / 2 + 0.5, carWid * 0.3, 2.1, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  private renderFloatingTexts() {
    this.ctx.save();
    for (const ft of this.traffic.floatingTexts) {
      this.ctx.save();
      this.ctx.globalAlpha = ft.opacity;
      this.ctx.translate(ft.x, ft.y);
      this.ctx.scale(ft.scale, ft.scale);

      // Pill background for crisp readability in both Day and Night modes
      const pillW = ft.text.length > 2 ? 44 : 28;
      this.ctx.fillStyle = this.isNightMode ? '#1E2638' : '#FFFFFF';
      this.roundRect(-pillW / 2, -10, pillW, 20, 10);
      this.ctx.fill();
      if (this.isNightMode) {
        this.ctx.strokeStyle = ft.color;
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();
      }

      this.ctx.fillStyle = ft.color;
      this.ctx.font = '800 13px "Plus Jakarta Sans", sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(ft.text, 0, 0);
      this.ctx.restore();
    }
    this.ctx.restore();
  }

  private easeOutBack(t: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  private roundRect(x: number, y: number, width: number, height: number, radius: number) {
    const r = Math.min(radius, width / 2, height / 2);
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.arcTo(x + width, y, x + width, y + height, r);
    this.ctx.arcTo(x + width, y + height, x, y + height, r);
    this.ctx.arcTo(x, y + height, x, y, r);
    this.ctx.arcTo(x, y, x + width, y, r);
    this.ctx.closePath();
  }

  /**
   * Generates a clean, high-resolution Postcard image of the current city
   * with a sleek minimalist typography watermark in the corner.
   */
  public generatePostcard(mapName: string, trips: number, days: number): string {
    const off = document.createElement('canvas');
    off.width = this.canvas.width;
    off.height = this.canvas.height;
    const octx = off.getContext('2d')!;

    // 1. Draw the underlying game world canvas
    octx.drawImage(this.canvas, 0, 0);

    // 2. Minimalist Postcard Graphic Badge in bottom-right corner
    const cardW = 340;
    const cardH = 88;
    const pad = 24;
    const cardX = off.width - cardW - pad;
    const cardY = off.height - cardH - pad;

    octx.save();
    octx.fillStyle = this.isNightMode ? 'rgba(15, 20, 32, 0.94)' : 'rgba(255, 255, 255, 0.96)';
    octx.shadowColor = 'rgba(0, 0, 0, 0.28)';
    octx.shadowBlur = 18;
    octx.shadowOffsetY = 4;
    octx.beginPath();
    octx.roundRect(cardX, cardY, cardW, cardH, 16);
    octx.fill();
    octx.shadowColor = 'transparent';

    // Accent left stripe
    octx.fillStyle = '#0284C7';
    octx.beginPath();
    octx.roundRect(cardX, cardY, 6, cardH, [16, 0, 0, 16]);
    octx.fill();

    // Subtle border
    octx.strokeStyle = this.isNightMode ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';
    octx.lineWidth = 1;
    octx.beginPath();
    octx.roundRect(cardX, cardY, cardW, cardH, 16);
    octx.stroke();

    // Typography
    const textColor = this.isNightMode ? '#F8FAFC' : '#1E293B';
    const subColor = this.isNightMode ? '#94A3B8' : '#64748B';

    octx.fillStyle = textColor;
    octx.font = '800 17px "Plus Jakarta Sans", sans-serif';
    octx.fillText('TRAFFIC NIRVANA', cardX + 22, cardY + 30);

    octx.fillStyle = subColor;
    octx.font = '600 12px "Plus Jakarta Sans", sans-serif';
    octx.fillText(`${mapName} · ${trips} Trips · Day ${days}`, cardX + 22, cardY + 52);

    octx.fillStyle = '#0284C7';
    octx.font = '700 11px "Plus Jakarta Sans", sans-serif';
    octx.fillText('traffic-nirvana.web.app', cardX + 22, cardY + 71);

    octx.restore();
    return off.toDataURL('image/png');
  }
}
