import { CONFIG } from './config';
import {
  Direction8,
  GridCoord,
  HillContour,
  MapId,
  Motorway,
  RoadTile,
  Roundabout,
  SubwayLine,
  SurfaceTrain,
  TileType,
  Tree,
  WorldPoint,
} from './types';
import { sound } from './sound';

export const DIR8_OFFSETS: { dir: Direction8; opp: Direction8; dx: number; dy: number }[] = [
  { dir: 'n', opp: 's', dx: 0, dy: -1 },
  { dir: 'ne', opp: 'sw', dx: 1, dy: -1 },
  { dir: 'e', opp: 'w', dx: 1, dy: 0 },
  { dir: 'se', opp: 'nw', dx: 1, dy: 1 },
  { dir: 's', opp: 'n', dx: 0, dy: 1 },
  { dir: 'sw', opp: 'ne', dx: -1, dy: 1 },
  { dir: 'w', opp: 'e', dx: -1, dy: 0 },
  { dir: 'nw', opp: 'se', dx: -1, dy: -1 },
];

export class RoadNetwork {
  public mapId: MapId;
  public roads: Map<string, RoadTile> = new Map();
  public blueprintRoads: Map<string, RoadTile> = new Map();
  public motorways: Motorway[] = [];
  public subways: SubwayLine[] = [];
  public roundabouts: Roundabout[] = [];
  public terrain: TileType[][] = [];
  public trees: Tree[] = [];
  public hillContours: HillContour[] = [];

  public roadsRemaining: number = CONFIG.GAMEPLAY.INITIAL_ROADS;
  public bridgesRemaining: number = CONFIG.GAMEPLAY.INITIAL_BRIDGES;
  public tunnelsRemaining: number = CONFIG.GAMEPLAY.INITIAL_TUNNELS;
  public motorwaysRemaining: number = CONFIG.GAMEPLAY.INITIAL_MOTORWAYS;
  public subwaysRemaining: number = CONFIG.GAMEPLAY.INITIAL_SUBWAYS;
  public roundaboutsRemaining: number = CONFIG.GAMEPLAY.INITIAL_ROUNDABOUTS;
  public trafficLightsRemaining: number = CONFIG.GAMEPLAY.INITIAL_TRAFFIC_LIGHTS;

  public riverPoints: WorldPoint[] = [];
  public riverChannels: WorldPoint[][] = [];
  public surfaceTrain: SurfaceTrain;
  public getTrainCarCount: () => number = () => 3;
  public defaultOccupiedCheck: ((x: number, y: number) => boolean) | null = null;
  public onTrainStationArrival: (() => void) | null = null;
  public onNetworkChanged: (() => void) | null = null;
  private trainRunCount: number = 0;

  public railRow: number = 8;
  public stationTileX: number = 16;
  private riverBranchParams: {
    baseX: number;
    freq1: number;
    amp1: number;
    phase1: number;
    freq2: number;
    amp2: number;
    phase2: number;
    slope: number;
  }[] = [];
  private mountainCentersList: { cx: number; cy: number; rx: number; ry: number }[] = [];

  constructor(mapId: MapId = 'river_valley') {
    this.mapId = mapId;
    if (mapId === 'twin_islands') {
      this.bridgesRemaining = 4;
    } else if (mapId === 'alpine_pass') {
      this.tunnelsRemaining = 4;
    }

    this.surfaceTrain = {
      path: [],
      distance: 0,
      totalLength: 1,
      speed: 4.8,
      active: false,
      cooldown: 33.0,
    };

    this.generateRandomMapLayout();
    this.initTerrainRiverAndRail();
    this.initHillsMountainsAndTrees();
  }

  private generateRandomMapLayout() {
    const randRange = (min: number, max: number) => min + Math.random() * (max - min);

    // 1. Randomize commuter rail corridor row (between row 6 and row 11)
    this.railRow = 6 + Math.floor(Math.random() * 6);

    // 2. Randomize river channel curves per map archetype
    this.riverBranchParams = [];
    if (this.mapId === 'twin_islands') {
      this.riverBranchParams.push({
        baseX: randRange(9.2, 11.8),
        freq1: randRange(0.26, 0.42),
        amp1: randRange(1.6, 2.5),
        phase1: randRange(0, Math.PI * 2),
        freq2: randRange(0.14, 0.25),
        amp2: randRange(0.4, 0.9),
        phase2: randRange(0, Math.PI * 2),
        slope: randRange(-0.08, 0.08),
      });
      this.riverBranchParams.push({
        baseX: randRange(20.2, 22.8),
        freq1: randRange(0.26, 0.42),
        amp1: randRange(1.6, 2.5),
        phase1: randRange(0, Math.PI * 2),
        freq2: randRange(0.14, 0.25),
        amp2: randRange(0.4, 0.9),
        phase2: randRange(0, Math.PI * 2),
        slope: randRange(-0.08, 0.08),
      });
    } else if (this.mapId === 'alpine_pass') {
      const eastSide = Math.random() < 0.65;
      this.riverBranchParams.push({
        baseX: eastSide ? randRange(22.0, 25.5) : randRange(8.0, 11.0),
        freq1: randRange(0.24, 0.38),
        amp1: randRange(1.5, 2.4),
        phase1: randRange(0, Math.PI * 2),
        freq2: randRange(0.12, 0.22),
        amp2: randRange(0.4, 0.8),
        phase2: randRange(0, Math.PI * 2),
        slope: randRange(-0.07, 0.07),
      });
    } else {
      // River Valley: meandering central river with random phase, bend amplitude, and diagonal drift
      this.riverBranchParams.push({
        baseX: randRange(12.0, 16.5),
        freq1: randRange(0.26, 0.42),
        amp1: randRange(2.1, 3.4),
        phase1: randRange(0, Math.PI * 2),
        freq2: randRange(0.14, 0.24),
        amp2: randRange(0.5, 1.1),
        phase2: randRange(0, Math.PI * 2),
        slope: randRange(-0.11, 0.11),
      });
    }

    // 3. Randomize mountain ridges while keeping the rail row passable
    this.mountainCentersList = [];
    const isNearRailOrRiver = (cx: number, cy: number, rx: number, ry: number) => {
      if (Math.abs(cy - (this.railRow + 0.5)) < ry + 1.1) return true;
      for (let b = 0; b < this.riverBranchParams.length; b++) {
        const rivX = this.getRiverCenterAtY(cy, b);
        if (Math.abs(cx - rivX) < rx + 1.4) return true;
      }
      return false;
    };

    if (this.mapId === 'alpine_pass') {
      const ridgeX = randRange(13.0, 16.2);
      // Upper and lower alpine ridges split by the rail corridor / natural pass
      const upperCy = Math.max(3.2, (this.railRow - 1.5) * 0.5);
      const upperRy = Math.max(1.8, Math.min(3.4, this.railRow - upperCy - 1.0));
      this.mountainCentersList.push({
        cx: ridgeX + randRange(-0.8, 0.8),
        cy: upperCy,
        rx: randRange(2.0, 2.5),
        ry: upperRy,
      });

      const lowerCy = Math.min(17.5, this.railRow + 4.8 + randRange(0, 1.8));
      const lowerRy = Math.max(1.8, Math.min(3.4, lowerCy - this.railRow - 1.4));
      this.mountainCentersList.push({
        cx: ridgeX + randRange(-0.8, 0.8),
        cy: lowerCy,
        rx: randRange(2.0, 2.5),
        ry: lowerRy,
      });

      // Outer foothill peak
      const cornerX = Math.random() < 0.5 ? randRange(4.0, 7.5) : randRange(26.5, 29.5);
      const cornerY = Math.random() < 0.5 ? randRange(3.0, 4.8) : randRange(17.0, 19.0);
      if (!isNearRailOrRiver(cornerX, cornerY, 2.4, 2.0)) {
        this.mountainCentersList.push({
          cx: cornerX,
          cy: cornerY,
          rx: randRange(2.1, 2.8),
          ry: randRange(1.7, 2.2),
        });
      }
    } else if (this.mapId === 'twin_islands') {
      for (let attempt = 0; attempt < 25; attempt++) {
        const cx = randRange(5.0, 28.0);
        const cy = Math.random() < 0.5 ? randRange(2.8, 5.2) : randRange(15.5, 18.8);
        const rx = randRange(1.9, 2.4);
        const ry = randRange(1.6, 2.1);
        if (!isNearRailOrRiver(cx, cy, rx, ry)) {
          this.mountainCentersList.push({ cx, cy, rx, ry });
          if (this.mountainCentersList.length >= 2) break;
        }
      }
    } else {
      // River Valley: 2 randomized rocky ridges in outer/mid valley zones
      for (let attempt = 0; attempt < 30; attempt++) {
        const cx = randRange(5.5, 28.5);
        const cy = Math.random() < 0.5 ? randRange(3.0, 6.5) : randRange(14.5, 18.8);
        const rx = randRange(1.9, 2.5);
        const ry = randRange(1.6, 2.1);
        const tooClose = this.mountainCentersList.some(
          (m) => Math.hypot(m.cx - cx, m.cy - cy) < 8.0
        );
        if (!tooClose && !isNearRailOrRiver(cx, cy, rx, ry)) {
          this.mountainCentersList.push({ cx, cy, rx, ry });
          if (this.mountainCentersList.length >= 2) break;
        }
      }
    }
  }

  public getRiverCenterAtY(y: number, branch: number = 0): number {
    const p = this.riverBranchParams[branch] || this.riverBranchParams[0];
    if (!p) {
      return 13.5 + Math.sin(y * 0.36) * 3.1;
    }
    const centerY = CONFIG.GRID_ROWS * 0.5;
    return (
      p.baseX +
      (y - centerY) * p.slope +
      Math.sin(y * p.freq1 + p.phase1) * p.amp1 +
      Math.cos(y * p.freq2 + p.phase2) * p.amp2
    );
  }

  public getRailYAtX(_x: number): number {
    return this.railRow + 0.5;
  }

  private getMountainCenters(): { cx: number; cy: number; rx: number; ry: number }[] {
    return this.mountainCentersList;
  }

  private initTerrainRiverAndRail() {
    this.terrain = [];
    this.riverChannels = [];

    const branchCount = this.mapId === 'twin_islands' ? 2 : 1;
    for (let b = 0; b < branchCount; b++) {
      const ch: WorldPoint[] = [];
      for (let y = -2; y <= CONFIG.GRID_ROWS + 2; y += 0.5) {
        ch.push({ x: this.getRiverCenterAtY(y, b), y });
      }
      this.riverChannels.push(ch);
    }
    this.riverPoints = this.riverChannels[0];

    // Build commuter train path across the map
    const railPts: WorldPoint[] = [];
    for (let x = -3; x <= CONFIG.GRID_COLS + 3; x += 0.5) {
      railPts.push({ x, y: this.getRailYAtX(x) });
    }
    let totalLen = 0;
    for (let i = 1; i < railPts.length; i++) {
      totalLen += Math.hypot(railPts[i].x - railPts[i - 1].x, railPts[i].y - railPts[i - 1].y);
    }
    this.surfaceTrain = {
      path: railPts,
      distance: 0,
      totalLength: totalLen,
      speed: 4.8,
      active: false,
      cooldown: 8.5, // Initial train arrival during Day 1 to service the Central Train Station!
    };

    const mountains = this.getMountainCenters();

    for (let y = 0; y < CONFIG.GRID_ROWS; y++) {
      const row: TileType[] = [];
      for (let x = 0; x < CONFIG.GRID_COLS; x++) {
        // 1. Check water channels
        let isWater = false;
        for (let b = 0; b < branchCount; b++) {
          const rx = this.getRiverCenterAtY(y + 0.5, b);
          if (Math.abs(x + 0.5 - rx) <= 0.92) {
            isWater = true;
            break;
          }
        }
        if (isWater) {
          row.push('water');
          continue;
        }

        // 2. Check mountain ridges
        let isMountain = false;
        for (const m of mountains) {
          const ndx = (x + 0.5 - m.cx) / m.rx;
          const ndy = (y + 0.5 - m.cy) / m.ry;
          if (ndx * ndx + ndy * ndy <= 0.88) {
            isMountain = true;
            break;
          }
        }
        if (isMountain) {
          row.push('mountain');
          continue;
        }

        // 3. Check commuter rail track
        const railY = this.getRailYAtX(x + 0.5);
        if (Math.abs(y + 0.5 - railY) <= 0.45) {
          row.push('rail');
          continue;
        }

        row.push('grass');
      }
      this.terrain.push(row);
    }

    // Pick a randomized clear trackside X for the Central Train Station (along y = this.railRow + 1)
    const validStationXs: number[] = [];
    const sy = this.railRow + 1;
    for (let sx = 5; sx <= 22; sx++) {
      let clear = true;
      for (let dy = 0; dy <= 2; dy++) {
        for (let dx = -1; dx <= 2; dx++) {
          if (this.getTileType(sx + dx, sy + dy) !== 'grass') {
            clear = false;
            break;
          }
        }
        if (!clear) break;
      }
      if (clear) validStationXs.push(sx);
    }
    if (validStationXs.length > 0) {
      this.stationTileX = validStationXs[Math.floor(Math.random() * validStationXs.length)];
    } else {
      this.stationTileX = 16;
    }
  }

  private initHillsMountainsAndTrees() {
    this.hillContours = [];
    this.trees = [];

    let seed = Math.floor(Math.random() * 2147483640) + 1;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const hillCenters = [
      {
        cx: 1.5 + rand() * 3.0,
        cy: 1.5 + rand() * 2.5,
        rx: 3.6 + rand() * 1.6,
        ry: 2.8 + rand() * 1.2,
      },
      {
        cx: 28.5 + rand() * 3.5,
        cy: 17.5 + rand() * 2.5,
        rx: 3.8 + rand() * 1.6,
        ry: 2.8 + rand() * 1.4,
      },
      {
        cx: 28.0 + rand() * 3.5,
        cy: 1.5 + rand() * 2.5,
        rx: 3.4 + rand() * 1.4,
        ry: 2.5 + rand() * 1.2,
      },
      {
        cx: 1.5 + rand() * 3.0,
        cy: 17.5 + rand() * 2.5,
        rx: 3.4 + rand() * 1.4,
        ry: 2.5 + rand() * 1.2,
      },
    ];

    const wobbleSeed = rand() * Math.PI * 2;
    for (const hc of hillCenters) {
      for (let layer = 0; layer < 3; layer++) {
        const scale = 1 - layer * 0.28;
        const pts: WorldPoint[] = [];
        const steps = 20;
        for (let i = 0; i < steps; i++) {
          const angle = (i / steps) * Math.PI * 2;
          const wobble =
            1 +
            Math.sin(angle * 3 + layer + wobbleSeed) * 0.08 +
            Math.cos(angle * 2 - wobbleSeed) * 0.06;
          pts.push({
            x: hc.cx + Math.cos(angle) * hc.rx * scale * wobble,
            y: hc.cy + Math.sin(angle) * hc.ry * scale * wobble,
          });
        }
        this.hillContours.push({ points: pts, layer, isMountain: false });
      }
    }

    // Steep rocky mountain contours
    for (const mc of this.getMountainCenters()) {
      for (let layer = 0; layer < 3; layer++) {
        const scale = 1.08 - layer * 0.28;
        const pts: WorldPoint[] = [];
        const steps = 18;
        for (let i = 0; i < steps; i++) {
          const angle = (i / steps) * Math.PI * 2;
          const crag =
            1 +
            Math.sin(angle * 5 + layer * 1.4 + wobbleSeed) * 0.1 +
            Math.cos(angle * 3 + wobbleSeed) * 0.07;
          pts.push({
            x: mc.cx + Math.cos(angle) * mc.rx * scale * crag,
            y: mc.cy + Math.sin(angle) * mc.ry * scale * crag,
          });
        }
        this.hillContours.push({ points: pts, layer, isMountain: true });
      }
    }

    const clusterCenters: { x: number; y: number; count: number; spread: number }[] = [
      { x: 2.2 + rand() * 2.5, y: 2.0 + rand() * 2.0, count: 8, spread: 1.8 },
      { x: 28.5 + rand() * 3.0, y: 17.5 + rand() * 2.0, count: 9, spread: 1.9 },
      { x: 28.0 + rand() * 3.0, y: 2.0 + rand() * 2.0, count: 8, spread: 1.7 },
      { x: 2.2 + rand() * 2.5, y: 17.5 + rand() * 2.0, count: 7, spread: 1.6 },
    ];
    // Add 6 randomized interior forest groves
    for (let g = 0; g < 6; g++) {
      clusterCenters.push({
        x: 4.5 + rand() * 24.0,
        y: 3.0 + rand() * 15.5,
        count: 5 + Math.floor(rand() * 4),
        spread: 1.2 + rand() * 0.6,
      });
    }

    for (const cluster of clusterCenters) {
      for (let i = 0; i < cluster.count; i++) {
        const angle = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * cluster.spread;
        const tx = cluster.x + Math.cos(angle) * r;
        const ty = cluster.y + Math.sin(angle) * r;

        const gx = Math.floor(tx);
        const gy = Math.floor(ty);
        if (gx < 0 || gx >= CONFIG.GRID_COLS || gy < 0 || gy >= CONFIG.GRID_ROWS) {
          continue;
        }
        if (this.getTileType(gx, gy) !== 'grass') continue;

        this.trees.push({
          x: tx,
          y: ty,
          radius: 6.5 + rand() * 5.5,
          shadeIndex: Math.floor(rand() * 4),
          swaySpeed: 0.7 + rand() * 0.6,
          swayOffset: rand() * Math.PI * 2,
        });
      }
    }
  }

  public clearTreesNear(gx: number, gy: number, radiusTiles: number = 0.85) {
    this.trees = this.trees.filter(
      (t) => Math.hypot(t.x - (gx + 0.5), t.y - (gy + 0.5)) > radiusTiles
    );
  }

  public getTileType(x: number, y: number): TileType {
    if (x < 0 || x >= CONFIG.GRID_COLS || y < 0 || y >= CONFIG.GRID_ROWS) {
      return 'grass';
    }
    return this.terrain[y][x];
  }

  public getKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  public getRoad(x: number, y: number): RoadTile | undefined {
    return this.roads.get(this.getKey(x, y));
  }

  public hasRoad(x: number, y: number): boolean {
    return this.roads.has(this.getKey(x, y));
  }

  /**
   * Returns current world position (in tile units) of the surface commuter train's front locomotive.
   */
  public getSurfaceTrainHeadWorld(): WorldPoint | null {
    if (!this.surfaceTrain.active || this.surfaceTrain.path.length < 2) return null;
    const pts = this.surfaceTrain.path;
    const idx = Math.min(pts.length - 1, Math.max(0, Math.floor(this.surfaceTrain.distance * 2)));
    return pts[idx];
  }

  public isTrainNearTile(x: number, y: number): boolean {
    if (!this.surfaceTrain.active) return false;
    const railY = this.getRailYAtX(x + 0.5);
    if (Math.abs(y + 0.5 - railY) > 1.2) return false;

    // Train is carCount cars long (38px / 44px/tile = 0.864 tiles per car)
    const carCount = this.getTrainCarCount ? this.getTrainCarCount() : 3;
    const trainLengthTiles = (carCount - 1) * 0.864 + 0.8;
    const trainHeadX = -3 + this.surfaceTrain.distance;
    const trainTailX = trainHeadX - trainLengthTiles;
    return x + 0.5 >= trainTailX - 1.5 && x + 0.5 <= trainHeadX + 2.4;
  }

  public update(
    dt: number,
    getTrafficQueue?: (x: number, y: number) => { ns: number; ew: number }
  ) {
    for (const road of this.roads.values()) {
      if (road.isDemolishing) {
        road.demolishAnim = ((road.demolishAnim || 0) + dt * 4.5) % 1.0;
      }

      if (road.hasTrafficLight) {
        road.lightTimer += dt;
        let shouldFlip = false;

        if (getTrafficQueue) {
          const q = getTrafficQueue(road.x, road.y);
          const currentQueue = road.lightGreenAxis === 'ns' ? q.ns : q.ew;
          const opposingQueue = road.lightGreenAxis === 'ns' ? q.ew : q.ns;

          // Smart Sensor Traffic Light:
          // 1. Min green time of 1.6s ensures safety and eliminates jitter
          if (road.lightTimer >= 1.6) {
            if (opposingQueue > 0 && currentQueue === 0) {
              // Opposing direction has waiting cars and current direction is clear -> switch immediately!
              shouldFlip = true;
            } else if (opposingQueue > 0 && road.lightTimer >= 3.6) {
              // Both axes have traffic -> cycle after standard safe duration
              shouldFlip = true;
            } else if (opposingQueue === 0 && currentQueue > 0 && road.lightTimer < 7.0) {
              // Current axis has traffic and opposing is empty -> hold green!
              shouldFlip = false;
            } else if (road.lightTimer >= 4.5) {
              // Max timer safety fallback
              shouldFlip = true;
            }
          }
        } else {
          if (road.lightTimer >= 3.2) {
            shouldFlip = true;
          }
        }

        if (shouldFlip) {
          road.lightTimer = 0;
          road.lightGreenAxis = road.lightGreenAxis === 'ns' ? 'ew' : 'ns';
        }
      }
    }

    // Update surface commuter train
    if (this.surfaceTrain.active) {
      if (this.surfaceTrain.stationStopTimer && this.surfaceTrain.stationStopTimer > 0) {
        this.surfaceTrain.stationStopTimer = Math.max(0, this.surfaceTrain.stationStopTimer - dt);
      } else {
        this.surfaceTrain.distance += this.surfaceTrain.speed * dt;
        // When the train pulls into the Central Station platform (around stationTileX + 5.0), stop briefly and unload commuters!
        const stopDist = this.stationTileX + 5.0;
        if (this.surfaceTrain.distance >= stopDist && !this.surfaceTrain.hasStoppedThisRun) {
          this.surfaceTrain.hasStoppedThisRun = true;
          this.surfaceTrain.stationStopTimer = 1.6;
          if (this.onTrainStationArrival) {
            this.onTrainStationArrival();
          }
        }
        const carCount = this.getTrainCarCount ? this.getTrainCarCount() : 3;
        const trainLengthTiles = carCount * 0.864;
        if (this.surfaceTrain.distance > this.surfaceTrain.totalLength + trainLengthTiles + 2.0) {
          this.surfaceTrain.active = false;
          this.trainRunCount++;
          this.surfaceTrain.cooldown = Math.max(6.5, 13.5 - this.trainRunCount * 1.4);
          this.surfaceTrain.speed = Math.min(5.8, 4.8 + this.trainRunCount * 0.15);
        }
      }
    } else {
      this.surfaceTrain.cooldown -= dt;
      if (this.surfaceTrain.cooldown <= 0) {
        this.surfaceTrain.active = true;
        this.surfaceTrain.distance = 0;
        this.surfaceTrain.hasStoppedThisRun = false;
        this.surfaceTrain.stationStopTimer = 0;
      }
    }
  }

  public placeRoad(
    x: number,
    y: number,
    occupiedCheck?: (x: number, y: number) => boolean,
    silent: boolean = false
  ): boolean {
    if (x < 0 || x >= CONFIG.GRID_COLS || y < 0 || y >= CONFIG.GRID_ROWS) {
      return false;
    }

    const key = this.getKey(x, y);
    if (this.roads.has(key)) return false;

    const checkFn = occupiedCheck || this.defaultOccupiedCheck;
    if (checkFn && checkFn(x, y)) return false;

    // Also do not allow placing a road inside the center island of a roundabout
    for (const rb of this.roundabouts) {
      if (rb.center.x === x && rb.center.y === y) return false;
    }

    const tileType = this.getTileType(x, y);
    const isWater = tileType === 'water';
    const isMountain = tileType === 'mountain';
    const isRail = tileType === 'rail';

    if (this.roadsRemaining <= 0) return false;
    if (isWater && this.bridgesRemaining <= 0) return false;
    if (isMountain && this.tunnelsRemaining <= 0) return false;

    this.roadsRemaining--;
    if (isWater) {
      this.bridgesRemaining--;
    }
    if (isMountain) {
      this.tunnelsRemaining--;
    }

    const newRoad: RoadTile = {
      x,
      y,
      isBridge: isWater,
      isTunnel: isMountain,
      isRailCrossing: isRail,
      hasTrafficLight: false,
      lightGreenAxis: 'ns',
      lightTimer: 0,
      isRoundabout: false,
      connections: {
        n: false,
        ne: false,
        e: false,
        se: false,
        s: false,
        sw: false,
        w: false,
        nw: false,
      },
    };

    this.roads.set(key, newRoad);
    this.clearTreesNear(x, y, 0.75);
    this.updateConnectionsAround(x, y);

    if (!silent) {
      sound.playDrawRoadStep();
      this.onNetworkChanged?.();
    }
    return true;
  }

  public removeRoad(
    x: number,
    y: number,
    isCarOnTile?: (x: number, y: number) => boolean,
    silent: boolean = false
  ): boolean {
    // Check if clicking center of roundabout
    for (const rb of this.roundabouts) {
      if (Math.abs(rb.center.x - x) <= 1 && Math.abs(rb.center.y - y) <= 1) {
        return this.removeRoundaboutAt(rb.center.x, rb.center.y);
      }
    }

    const key = this.getKey(x, y);
    const road = this.roads.get(key);
    if (!road) return false;

    if (road.isRoundabout && road.roundaboutCenter) {
      return this.removeRoundaboutAt(road.roundaboutCenter.x, road.roundaboutCenter.y, isCarOnTile);
    }

    if (isCarOnTile && isCarOnTile(x, y)) {
      if (!road.isDemolishing) {
        road.isDemolishing = true;
        road.demolishAnim = 0;
        this.onNetworkChanged?.();
        if (!silent) sound.playDemolishQueued();
      }
      return true;
    }

    this.roadsRemaining++;
    if (road.isBridge) {
      this.bridgesRemaining++;
    }
    if (road.isTunnel) {
      this.tunnelsRemaining++;
    }
    if (road.hasTrafficLight) {
      this.trafficLightsRemaining++;
    }

    for (const { dx, dy, opp } of DIR8_OFFSETS) {
      const neighbor = this.getRoad(x + dx, y + dy);
      if (neighbor) {
        neighbor.connections[opp] = false;
      }
    }

    this.roads.delete(key);

    for (const { dx, dy } of DIR8_OFFSETS) {
      if (this.hasRoad(x + dx, y + dy)) {
        this.updateConnectionsForTile(x + dx, y + dy);
      }
    }

    if (!silent) {
      sound.playEraseRoad();
      this.onNetworkChanged?.();
    }
    return true;
  }

  private updateConnectionsAround(x: number, y: number) {
    this.updateConnectionsForTile(x, y);
    for (const { dx, dy } of DIR8_OFFSETS) {
      if (this.hasRoad(x + dx, y + dy)) {
        this.updateConnectionsForTile(x + dx, y + dy);
      }
    }
  }

  private updateConnectionsForTile(x: number, y: number) {
    const road = this.getRoad(x, y);
    if (!road) return;

    const orthoDirs: { dir: Direction8; opp: Direction8; dx: number; dy: number }[] = [
      { dir: 'n', opp: 's', dx: 0, dy: -1 },
      { dir: 'e', opp: 'w', dx: 1, dy: 0 },
      { dir: 's', opp: 'n', dx: 0, dy: 1 },
      { dir: 'w', opp: 'e', dx: -1, dy: 0 },
    ];

    for (const { dir, opp, dx, dy } of orthoDirs) {
      const neighbor = this.getRoad(x + dx, y + dy);
      const connected = Boolean(neighbor);
      road.connections[dir] = connected;
      if (neighbor) {
        neighbor.connections[opp] = connected;
      }
    }

    const diagDirs: {
      dir: Direction8;
      opp: Direction8;
      dx: number;
      dy: number;
      ortho1: [number, number];
      ortho2: [number, number];
    }[] = [
      { dir: 'ne', opp: 'sw', dx: 1, dy: -1, ortho1: [0, -1], ortho2: [1, 0] },
      { dir: 'se', opp: 'nw', dx: 1, dy: 1, ortho1: [0, 1], ortho2: [1, 0] },
      { dir: 'sw', opp: 'ne', dx: -1, dy: 1, ortho1: [0, 1], ortho2: [-1, 0] },
      { dir: 'nw', opp: 'se', dx: -1, dy: -1, ortho1: [0, -1], ortho2: [-1, 0] },
    ];

    for (const { dir, opp, dx, dy, ortho1, ortho2 } of diagDirs) {
      const neighbor = this.getRoad(x + dx, y + dy);
      if (!neighbor) {
        road.connections[dir] = false;
        continue;
      }

      const sameRoundabout =
        road.isRoundabout &&
        neighbor.isRoundabout &&
        road.roundaboutCenter &&
        neighbor.roundaboutCenter &&
        road.roundaboutCenter.x === neighbor.roundaboutCenter.x &&
        road.roundaboutCenter.y === neighbor.roundaboutCenter.y;

      const hasOrthoBridge =
        this.hasRoad(x + ortho1[0], y + ortho1[1]) ||
        this.hasRoad(x + ortho2[0], y + ortho2[1]);

      const shouldConnectDiag = Boolean(sameRoundabout) || !hasOrthoBridge;
      road.connections[dir] = shouldConnectDiag;
      neighbor.connections[opp] = shouldConnectDiag;
    }
  }

  public drawLineOfRoads(
    from: GridCoord,
    to: GridCoord,
    occupiedCheck?: (x: number, y: number) => boolean
  ): boolean {
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    const sx = from.x < to.x ? 1 : -1;
    const sy = from.y < to.y ? 1 : -1;
    let err = dx - dy;

    let cx = from.x;
    let cy = from.y;
    let anyPlaced = false;

    while (true) {
      if (this.placeRoad(cx, cy, occupiedCheck)) {
        anyPlaced = true;
      }

      if (cx === to.x && cy === to.y) break;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
      }
    }

    return anyPlaced;
  }

  public eraseLineOfRoads(
    from: GridCoord,
    to: GridCoord,
    isCarOnTile?: (x: number, y: number) => boolean
  ): boolean {
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    const sx = from.x < to.x ? 1 : -1;
    const sy = from.y < to.y ? 1 : -1;
    let err = dx - dy;

    let cx = from.x;
    let cy = from.y;
    let anyErased = false;

    while (true) {
      if (this.removeRoad(cx, cy, isCarOnTile)) {
        anyErased = true;
      }

      if (cx === to.x && cy === to.y) break;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
      }
    }

    return anyErased;
  }

  // --- BLUEPRINT GHOST PLANNING MODE (Feature #3) ---

  public isBlueprintTile(x: number, y: number): boolean {
    return this.blueprintRoads.has(this.getKey(x, y));
  }

  public getBlueprintRoad(x: number, y: number): RoadTile | undefined {
    return this.blueprintRoads.get(this.getKey(x, y));
  }

  public placeBlueprintRoad(
    x: number,
    y: number,
    occupiedCheck?: (x: number, y: number) => boolean,
    silent: boolean = false
  ): boolean {
    if (x < 0 || x >= CONFIG.GRID_COLS || y < 0 || y >= CONFIG.GRID_ROWS) {
      return false;
    }
    const key = this.getKey(x, y);
    if (this.roads.has(key)) return false;
    if (this.blueprintRoads.has(key)) return false;

    const checkFn = occupiedCheck || this.defaultOccupiedCheck;
    if (checkFn && checkFn(x, y)) return false;

    for (const rb of this.roundabouts) {
      if (rb.center.x === x && rb.center.y === y) return false;
    }

    const tileType = this.getTileType(x, y);
    const isWater = tileType === 'water';
    const isMountain = tileType === 'mountain';
    const isRail = tileType === 'rail';

    const bpRoad: RoadTile = {
      x,
      y,
      isBridge: isWater,
      isTunnel: isMountain,
      isRailCrossing: isRail,
      hasTrafficLight: false,
      lightGreenAxis: 'ns',
      lightTimer: 0,
      isRoundabout: false,
      connections: {
        n: false,
        ne: false,
        e: false,
        se: false,
        s: false,
        sw: false,
        w: false,
        nw: false,
      },
    };

    this.blueprintRoads.set(key, bpRoad);
    this.updateBlueprintConnectionsAround(x, y);

    if (!silent) {
      sound.playBlueprintDraft();
    }
    return true;
  }

  public removeBlueprintRoad(x: number, y: number, silent: boolean = false): boolean {
    const key = this.getKey(x, y);
    if (!this.blueprintRoads.has(key)) return false;

    for (const { dx, dy, opp } of DIR8_OFFSETS) {
      const neighbor = this.getBlueprintRoad(x + dx, y + dy);
      if (neighbor) {
        neighbor.connections[opp] = false;
      }
    }

    this.blueprintRoads.delete(key);

    for (const { dx, dy } of DIR8_OFFSETS) {
      if (this.isBlueprintTile(x + dx, y + dy)) {
        this.updateBlueprintConnectionsForTile(x + dx, y + dy);
      }
    }

    if (!silent) {
      sound.playEraseRoad();
    }
    return true;
  }

  public drawBlueprintLine(
    from: GridCoord,
    to: GridCoord,
    occupiedCheck?: (x: number, y: number) => boolean
  ): boolean {
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    const sx = from.x < to.x ? 1 : -1;
    const sy = from.y < to.y ? 1 : -1;
    let err = dx - dy;

    let cx = from.x;
    let cy = from.y;
    let anyPlaced = false;

    while (true) {
      if (this.placeBlueprintRoad(cx, cy, occupiedCheck)) {
        anyPlaced = true;
      }

      if (cx === to.x && cy === to.y) break;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
      }
    }

    return anyPlaced;
  }

  public eraseBlueprintLine(from: GridCoord, to: GridCoord): boolean {
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    const sx = from.x < to.x ? 1 : -1;
    const sy = from.y < to.y ? 1 : -1;
    let err = dx - dy;

    let cx = from.x;
    let cy = from.y;
    let anyErased = false;

    while (true) {
      if (this.removeBlueprintRoad(cx, cy)) {
        anyErased = true;
      }

      if (cx === to.x && cy === to.y) break;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
      }
    }

    return anyErased;
  }

  private updateBlueprintConnectionsAround(x: number, y: number) {
    this.updateBlueprintConnectionsForTile(x, y);
    for (const { dx, dy } of DIR8_OFFSETS) {
      if (this.isBlueprintTile(x + dx, y + dy)) {
        this.updateBlueprintConnectionsForTile(x + dx, y + dy);
      }
    }
  }

  private updateBlueprintConnectionsForTile(x: number, y: number) {
    const road = this.getBlueprintRoad(x, y);
    if (!road) return;

    const orthoDirs: { dir: Direction8; opp: Direction8; dx: number; dy: number }[] = [
      { dir: 'n', opp: 's', dx: 0, dy: -1 },
      { dir: 'e', opp: 'w', dx: 1, dy: 0 },
      { dir: 's', opp: 'n', dx: 0, dy: 1 },
      { dir: 'w', opp: 'e', dx: -1, dy: 0 },
    ];

    for (const { dir, opp, dx, dy } of orthoDirs) {
      const neighbor = this.getBlueprintRoad(x + dx, y + dy) || this.getRoad(x + dx, y + dy);
      const connected = Boolean(neighbor);
      road.connections[dir] = connected;
      if (neighbor && this.isBlueprintTile(x + dx, y + dy)) {
        neighbor.connections[opp] = connected;
      }
    }
  }

  public getBlueprintCost(): { roads: number; bridges: number; tunnels: number } {
    let roads = 0;
    let bridges = 0;
    let tunnels = 0;

    for (const tile of this.blueprintRoads.values()) {
      roads++;
      if (tile.isBridge) bridges++;
      if (tile.isTunnel) tunnels++;
    }

    return { roads, bridges, tunnels };
  }

  public canCommitBlueprint(): { ok: boolean; reason?: string } {
    if (this.blueprintRoads.size === 0) {
      return { ok: false, reason: 'No blueprint roads drafted yet.' };
    }
    const cost = this.getBlueprintCost();
    if (this.roadsRemaining < cost.roads) {
      return {
        ok: false,
        reason: `Need ${cost.roads} roads (You have ${this.roadsRemaining})`,
      };
    }
    if (this.bridgesRemaining < cost.bridges) {
      return {
        ok: false,
        reason: `Need ${cost.bridges} bridges (You have ${this.bridgesRemaining})`,
      };
    }
    if (this.tunnelsRemaining < cost.tunnels) {
      return {
        ok: false,
        reason: `Need ${cost.tunnels} tunnels (You have ${this.tunnelsRemaining})`,
      };
    }
    return { ok: true };
  }

  public commitBlueprint(occupiedCheck?: (x: number, y: number) => boolean): {
    success: boolean;
    placed: number;
    reason?: string;
  } {
    const check = this.canCommitBlueprint();
    if (!check.ok) {
      return { success: false, placed: 0, reason: check.reason };
    }

    let placed = 0;
    const tilesToPlace = Array.from(this.blueprintRoads.values());
    this.blueprintRoads.clear();

    for (const tile of tilesToPlace) {
      if (this.placeRoad(tile.x, tile.y, occupiedCheck, true)) {
        placed++;
      }
    }

    sound.playBlueprintCommit();
    this.onNetworkChanged?.();
    return { success: true, placed };
  }

  public discardBlueprint(): void {
    if (this.blueprintRoads.size > 0) {
      this.blueprintRoads.clear();
      sound.playBlueprintDiscard();
      this.onNetworkChanged?.();
    }
  }

  public toggleTrafficLight(x: number, y: number): 'placed' | 'removed' | 'failed' {
    const road = this.getRoad(x, y);
    if (!road || road.isRoundabout) return 'failed';

    if (road.hasTrafficLight) {
      road.hasTrafficLight = false;
      this.trafficLightsRemaining++;
      sound.playEraseRoad();
      this.onNetworkChanged?.();
      return 'removed';
    }

    if (this.trafficLightsRemaining <= 0) return 'failed';

    road.hasTrafficLight = true;
    road.lightTimer = 0;
    road.lightGreenAxis = 'ns';
    this.trafficLightsRemaining--;
    sound.playDrawRoadStep();
    this.onNetworkChanged?.();
    return 'placed';
  }

  public placeRoundabout(
    cx: number,
    cy: number,
    occupiedCheck?: (x: number, y: number) => boolean
  ): boolean {
    if (this.roundaboutsRemaining <= 0) return false;
    if (cx < 1 || cx >= CONFIG.GRID_COLS - 1 || cy < 1 || cy >= CONFIG.GRID_ROWS - 1) {
      return false;
    }

    const checkFn = occupiedCheck || this.defaultOccupiedCheck;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (checkFn && checkFn(tx, ty)) return false;
        const tt = this.getTileType(tx, ty);
        if (tt === 'water' || tt === 'mountain') return false;
        const existing = this.getRoad(tx, ty);
        if (existing && existing.isRoundabout) return false;
      }
    }

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.hasRoad(cx + dx, cy + dy)) {
          this.removeRoad(cx + dx, cy + dy, undefined, true);
        }
        this.clearTreesNear(cx + dx, cy + dy, 0.8);
      }
    }

    const ringOffsets = [
      [-1, -1], [0, -1], [1, -1],
      [1, 0],
      [1, 1], [0, 1], [-1, 1],
      [-1, 0],
    ];

    for (const [dx, dy] of ringOffsets) {
      const tx = cx + dx;
      const ty = cy + dy;
      const key = this.getKey(tx, ty);
      const tile: RoadTile = {
        x: tx,
        y: ty,
        isBridge: false,
        isTunnel: false,
        isRailCrossing: this.getTileType(tx, ty) === 'rail',
        hasTrafficLight: false,
        lightGreenAxis: 'ns',
        lightTimer: 0,
        isRoundabout: true,
        roundaboutCenter: { x: cx, y: cy },
        connections: {
          n: false,
          ne: false,
          e: false,
          se: false,
          s: false,
          sw: false,
          w: false,
          nw: false,
        },
      };
      this.roads.set(key, tile);
    }

    for (const [dx, dy] of ringOffsets) {
      this.updateConnectionsAround(cx + dx, cy + dy);
    }

    this.roundabouts.push({
      id: `rb_${cx}_${cy}`,
      center: { x: cx, y: cy },
    });
    this.roundaboutsRemaining--;
    sound.playMotorwayPlacement();
    this.onNetworkChanged?.();
    return true;
  }

  public removeRoundaboutAt(
    cx: number,
    cy: number,
    isCarOnTile?: (x: number, y: number) => boolean
  ): boolean {
    const idx = this.roundabouts.findIndex((r) => r.center.x === cx && r.center.y === cy);
    if (idx === -1) return false;

    // If cars are active on the roundabout, mark all its tiles as pending demolition
    if (isCarOnTile) {
      let carOnRoundabout = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (isCarOnTile(cx + dx, cy + dy)) {
            carOnRoundabout = true;
            break;
          }
        }
        if (carOnRoundabout) break;
      }

      if (carOnRoundabout) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const key = this.getKey(cx + dx, cy + dy);
            const road = this.roads.get(key);
            if (road && road.isRoundabout) {
              road.isDemolishing = true;
              road.demolishAnim = 0;
            }
          }
        }
        sound.playDemolishQueued();
        this.onNetworkChanged?.();
        return true;
      }
    }

    this.roundabouts.splice(idx, 1);
    this.roundaboutsRemaining++;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        const key = this.getKey(tx, ty);
        const road = this.roads.get(key);
        if (road && road.isRoundabout) {
          for (const { dx: ndx, dy: ndy, opp } of DIR8_OFFSETS) {
            const neighbor = this.getRoad(tx + ndx, ty + ndy);
            if (neighbor) {
              neighbor.connections[opp] = false;
            }
          }
          this.roads.delete(key);
        }
      }
    }

    sound.playEraseRoad();
    this.onNetworkChanged?.();
    return true;
  }

  /**
   * Finalizes demolition for any road tiles or roundabouts in the demolition queue
   * once all vehicles have fully cleared the tile.
   */
  public checkAndFinalizeDemolitions(
    isCarOnTile: (x: number, y: number) => boolean
  ): { x: number; y: number }[] {
    const finalizedTiles: { x: number; y: number }[] = [];

    // Check roundabouts first
    for (const rb of [...this.roundabouts]) {
      let carOnRb = false;
      let hasDemolishing = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const key = this.getKey(rb.center.x + dx, rb.center.y + dy);
          const road = this.roads.get(key);
          if (road?.isDemolishing) hasDemolishing = true;
          if (isCarOnTile(rb.center.x + dx, rb.center.y + dy)) {
            carOnRb = true;
          }
        }
      }

      if (hasDemolishing && !carOnRb) {
        this.removeRoundaboutAt(rb.center.x, rb.center.y, undefined);
        sound.playDemolishPopped();
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            finalizedTiles.push({ x: rb.center.x + dx, y: rb.center.y + dy });
          }
        }
      }
    }

    // Check standard individual road tiles
    for (const road of this.roads.values()) {
      if (road.isDemolishing && !road.isRoundabout && !isCarOnTile(road.x, road.y)) {
        finalizedTiles.push({ x: road.x, y: road.y });
      }
    }

    for (const pt of finalizedTiles) {
      if (this.hasRoad(pt.x, pt.y)) {
        this.removeRoad(pt.x, pt.y, undefined, true);
        sound.playDemolishPopped();
      }
    }

    if (finalizedTiles.length > 0) {
      this.onNetworkChanged?.();
    }
    return finalizedTiles;
  }

  public placeMotorway(start: GridCoord, end: GridCoord): Motorway | null {
    if (this.motorwaysRemaining <= 0) return null;
    if (start.x === end.x && start.y === end.y) return null;

    const usedNumbers = new Set(this.motorways.map((m) => m.number));
    let num = 1;
    while (usedNumbers.has(num)) num++;

    const motorway: Motorway = {
      id: `motorway_${num}_${Date.now()}`,
      number: num,
      start: { ...start },
      end: { ...end },
      color: CONFIG.COLORS.MOTORWAY_ASPHALT,
    };

    this.motorways.push(motorway);
    this.motorwaysRemaining--;
    sound.playMotorwayPlacement();
    this.onNetworkChanged?.();
    return motorway;
  }

  public removeMotorway(motorwayId: string): boolean {
    const idx = this.motorways.findIndex((m) => m.id === motorwayId);
    if (idx !== -1) {
      this.motorways.splice(idx, 1);
      this.motorwaysRemaining++;
      sound.playEraseRoad();
      this.onNetworkChanged?.();
      return true;
    }
    return false;
  }

  public getMotorwayNear(x: number, y: number): Motorway | null {
    for (const m of this.motorways) {
      const midX = (m.start.x + m.end.x) / 2;
      const midY = (m.start.y + m.end.y) / 2 - 36 / CONFIG.TILE_SIZE / 2;
      if (
        (Math.abs(m.start.x - x) <= 1 && Math.abs(m.start.y - y) <= 1) ||
        (Math.abs(m.end.x - x) <= 1 && Math.abs(m.end.y - y) <= 1) ||
        Math.hypot(midX - x, midY - y) <= 1.5
      ) {
        return m;
      }
    }
    return null;
  }

  public placeSubway(start: GridCoord, end: GridCoord): SubwayLine | null {
    if (this.subwaysRemaining <= 0) return null;
    if (start.x === end.x && start.y === end.y) return null;

    const usedNumbers = new Set(this.subways.map((s) => s.number));
    let num = 1;
    while (usedNumbers.has(num)) num++;

    const subway: SubwayLine = {
      id: `subway_${num}_${Date.now()}`,
      number: num,
      start: { ...start },
      end: { ...end },
      trainProgress: 0.1,
      direction: 1,
      dwellTimer: 0,
      passengers: 0,
    };

    this.subways.push(subway);
    this.subwaysRemaining--;
    sound.playMotorwayPlacement();
    return subway;
  }

  public removeSubway(subwayId: string): boolean {
    const idx = this.subways.findIndex((s) => s.id === subwayId);
    if (idx !== -1) {
      this.subways.splice(idx, 1);
      this.subwaysRemaining++;
      sound.playEraseRoad();
      return true;
    }
    return false;
  }

  public getSubwayNear(x: number, y: number): SubwayLine | null {
    for (const s of this.subways) {
      // 1. Station portal hit-tests
      if (
        (Math.abs(s.start.x - x) <= 1 && Math.abs(s.start.y - y) <= 1) ||
        (Math.abs(s.end.x - x) <= 1 && Math.abs(s.end.y - y) <= 1)
      ) {
        return s;
      }
      // 2. Line segment distance hit-test (allows selecting/erasing along the underground tube)
      const dx = s.end.x - s.start.x;
      const dy = s.end.y - s.start.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq > 0) {
        const t = Math.max(0, Math.min(1, ((x - s.start.x) * dx + (y - s.start.y) * dy) / lenSq));
        const projX = s.start.x + t * dx;
        const projY = s.start.y + t * dy;
        if (Math.hypot(x - projX, y - projY) <= 0.85) {
          return s;
        }
      }
    }
    return null;
  }
}
