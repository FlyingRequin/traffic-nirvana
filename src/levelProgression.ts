import { BuildingColor, Destination, DifficultyMode, GameMode, House, StationRushQueueItem, UpgradeOption } from './types';
import { CONFIG } from './config';
import { sound } from './sound';

export interface MapBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export class LevelProgression {
  public gameMode: GameMode = 'standard';
  public difficultyMode: DifficultyMode = 'normal';
  public currentDay: number = 1;
  public dayTimer: number = 0;
  public isPaused: boolean = false;
  public gameSpeed: number = 1.0;
  public score: number = 0;
  public gameOver: boolean = false;
  public failedDestId: string | null = null;
  public failureReason: string = '';
  public upgradePending: boolean = false;
  public screenShake: number = 0;

  public houses: House[] = [];
  public destinations: Destination[] = [];
  private pendingStationRushes: StationRushQueueItem[] = [];

  // Dynamic playable bounds that start framed on the inner neighborhood and expand outward over time
  public activeBounds: MapBounds = {
    minX: 2,
    maxX: 25,
    minY: 1,
    maxY: 16,
  };

  // Optional terrain/road check injected by main game so procedural spawns never land on water or roads
  public canPlaceOnTile: ((x: number, y: number) => boolean) | null = null;
  public trainStationConfig: {
    getRailRow: () => number;
    getStationTileX: () => number;
    setStationTileX: (x: number) => void;
  } | null = null;

  private colorProgression: BuildingColor[] = ['red', 'blue', 'yellow', 'green', 'purple'];
  private processedProceduralDays: Set<number> = new Set();
  private onUpgradeModal: ((options: UpgradeOption[]) => void) | null = null;
  private onGameOver: (() => void) | null = null;
  private onToast: ((msg: string) => void) | null = null;
  private onBuildingSpawn: ((x: number, y: number, w: number, h: number) => void) | null = null;

  constructor(
    onUpgradeModal: (options: UpgradeOption[]) => void,
    onGameOver: () => void,
    onToast: (msg: string) => void,
    onBuildingSpawn?: (x: number, y: number, w: number, h: number) => void,
    canPlaceOnTile?: (x: number, y: number) => boolean,
    trainStationConfig?: {
      getRailRow: () => number;
      getStationTileX: () => number;
      setStationTileX: (x: number) => void;
    }
  ) {
    this.onUpgradeModal = onUpgradeModal;
    this.onGameOver = onGameOver;
    this.onToast = onToast;
    this.onBuildingSpawn = onBuildingSpawn || null;
    this.canPlaceOnTile = canPlaceOnTile || null;
    this.trainStationConfig = trainStationConfig || null;

    // Randomize the mid-game color order so every playthrough has a fresh sequence and layout
    const midColors: BuildingColor[] = ['blue', 'yellow', 'green'];
    for (let i = midColors.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [midColors[i], midColors[j]] = [midColors[j], midColors[i]];
    }
    this.colorProgression = ['red', ...midColors, 'purple'];

    this.processSpawnsForDay(1);
  }

  public getWeekNumber(): number {
    return Math.floor((this.currentDay - 1) / 7) + 1;
  }

  /**
   * Surface commuter train composition scales with progression:
   * Week 1: 2 cars (1 loco + 1 passenger coach)
   * Week 2: 3 cars (1 loco + 2 passenger coaches)
   * Week 3: 4 cars (1 loco + 3 passenger coaches)
   * Week 4: 5 cars (1 loco + 4 passenger coaches)
   * Week 5+: 6 cars (1 loco + 5 passenger coaches)
   */
  public getTrainCarCount(): number {
    const week = this.getWeekNumber();
    return Math.min(6, Math.max(2, week + 1));
  }

  public getDayOfWeekName(): string {
    const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const idx = (this.currentDay - 1) % 7;
    return days[idx];
  }

  public getDayProgress(): number {
    return Math.min(1.0, this.dayTimer / CONFIG.GAMEPLAY.DAY_DURATION_SECONDS);
  }

  public update(dt: number) {
    if (this.isPaused || this.gameOver || this.upgradePending) return;

    const scaledDt = dt * this.gameSpeed;
    this.dayTimer += scaledDt;

    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - dt * 2.0);
    }

    for (const h of this.houses) {
      if (h.spawnAnimation < 1) {
        h.spawnAnimation = Math.min(1, h.spawnAnimation + dt * 3.8);
      }
    }
    for (const d of this.destinations) {
      if (d.spawnAnimation < 1) {
        d.spawnAnimation = Math.min(1, d.spawnAnimation + dt * 3.2);
      }
      for (let i = 0; i < d.pinAnimations.length; i++) {
        if (d.pinAnimations[i] < 1) {
          d.pinAnimations[i] = Math.min(1, d.pinAnimations[i] + dt * 5.0);
        }
      }
    }

    if (this.dayTimer >= CONFIG.GAMEPLAY.DAY_DURATION_SECONDS) {
      this.dayTimer = 0;
      this.currentDay++;

      this.expandMapBoundsForDay(this.currentDay);

      if ((this.currentDay - 1) % 7 === 0) {
        // Scale up existing store demand each week
        for (const d of this.destinations) {
          d.spawnInterval = Math.max(1.85, d.spawnInterval * 0.88);
        }
        this.triggerWeeklyUpgrade();
      } else {
        this.processSpawnsForDay(this.currentDay);
      }
    }

    // Process spaced train station rush waves (Feature #4)
    if (this.pendingStationRushes.length > 0) {
      for (const rush of this.pendingStationRushes) {
        rush.intervalTimer -= scaledDt;
        if (rush.intervalTimer <= 0) {
          rush.intervalTimer = 0.65;
          const dest = this.destinations.find((d) => d.id === rush.destId);
          if (dest && dest.pins < dest.maxPins) {
            dest.pins++;
            dest.pinAnimations.push(0.05);
            sound.playPinSpawn();
          }
          rush.pinsLeft--;
        }
      }
      this.pendingStationRushes = this.pendingStationRushes.filter((r) => r.pinsLeft > 0);
    }

    this.updateDestinations(scaledDt);
  }

  /**
   * Gradually expands the active city map bounds outward as days progress so the city
   * organically grows while remaining framed inside the viewport.
   */
  private expandMapBoundsForDay(day: number) {
    const prevW = this.activeBounds.maxX - this.activeBounds.minX;
    const prevH = this.activeBounds.maxY - this.activeBounds.minY;

    // Stepwise outward expansion from 24x16 (Day 1) to full 34x22 (Day 24+)
    const progress = Math.min(1.0, Math.max(0, (day - 2) / 22));
    this.activeBounds = {
      minX: Math.max(0, Math.round(2 * (1 - progress))),
      maxX: Math.min(CONFIG.GRID_COLS - 1, Math.round(25 + (CONFIG.GRID_COLS - 1 - 25) * progress)),
      minY: Math.max(0, Math.round(1 * (1 - progress))),
      maxY: Math.min(CONFIG.GRID_ROWS - 1, Math.round(16 + (CONFIG.GRID_ROWS - 1 - 16) * progress)),
    };

    const newW = this.activeBounds.maxX - this.activeBounds.minX;
    const newH = this.activeBounds.maxY - this.activeBounds.minY;
    if ((newW > prevW || newH > prevH) && day % 6 === 0 && this.onToast) {
      this.onToast('City limits expanded to accommodate new suburbs & stores!');
    }
  }

  /**
   * Computes residential car supply vs. store demand weight for a given color so
   * new houses and apartment upgrades always prioritize colors with the highest store demand.
   */
  public getColorSupplyRatio(color: BuildingColor): number {
    const colorDests = this.destinations.filter((d) => d.color === color);
    if (colorDests.length === 0) return 999;

    const demandWeight = colorDests.reduce(
      (sum, d) => sum + (d.isCircular || d.isTrainStation ? 1.55 : 1.0),
      0
    );
    const carSupply = this.houses
      .filter((h) => h.color === color)
      .reduce((sum, h) => sum + h.totalCars, 0);

    return carSupply / demandWeight;
  }

  /**
   * Returns the active color with the lowest car-supply-to-store-demand ratio.
   */
  public getMostUnderservedColor(): BuildingColor | null {
    const activeColors = Array.from(new Set(this.destinations.map((d) => d.color)));
    if (activeColors.length === 0) return null;

    activeColors.sort((a, b) => this.getColorSupplyRatio(a) - this.getColorSupplyRatio(b));
    return activeColors[0];
  }

  private processSpawnsForDay(day: number) {
    if (this.processedProceduralDays.has(day)) return;
    this.processedProceduralDays.add(day);

    let spawnedMilestoneToday = false;

    // --- MILESTONE NEW COLOR & TRAIN STATION SPAWNS (100% Randomized Positions Each Game!) ---
    if (day === 1) {
      // Day 1: Initial Red Store + 2 Red Houses in a separated suburb cluster
      this.spawnColorStoreAndSuburb(this.colorProgression[0], 2, false);
      spawnedMilestoneToday = true;
    } else if (day === 2) {
      this.spawnProceduralHouse(this.colorProgression[0]);
      spawnedMilestoneToday = true;
    } else if (day === 3) {
      this.spawnProceduralHouse(this.colorProgression[0]);
      this.spawnProceduralHouse(this.colorProgression[0]);
      spawnedMilestoneToday = true;
    } else if (day === 4) {
      // Day 4: Central Commuter Train Station along the randomized rail line + extra Red house
      this.spawnProceduralTrainStation(this.colorProgression[0]);
      this.spawnProceduralHouse(this.colorProgression[0]);
      spawnedMilestoneToday = true;
    } else if (day === 5) {
      // Day 5: 2nd Color Store + 2 Clustered Suburb Houses
      this.spawnColorStoreAndSuburb(this.colorProgression[1], 2, true);
      spawnedMilestoneToday = true;
    } else if (day === 10) {
      // Day 10: 3rd Color Store + 2 Clustered Suburb Houses
      this.spawnColorStoreAndSuburb(this.colorProgression[2], 2, true);
      spawnedMilestoneToday = true;
    } else if (day === 15) {
      // Day 15: 4th Color Store + 2 Clustered Suburb Houses
      this.spawnColorStoreAndSuburb(this.colorProgression[3], 2, true);
      spawnedMilestoneToday = true;
    } else if (day === 21) {
      // Day 21: 5th Color (Purple) Store + 2 Clustered Suburb Houses
      this.spawnColorStoreAndSuburb(this.colorProgression[4], 2, true);
      spawnedMilestoneToday = true;
    }

    // 1. Periodic Store Upgrades (Square -> Circular High-Demand Hub)
    if (day >= 9 && (day === 9 || day === 14 || (day >= 19 && (day - 19) % 5 === 0))) {
      this.upgradeExistingStore();
    }

    // 1b. Periodic Residential Density Upgrades (House -> Apartment -> High-Rise Skyscraper)
    if (day >= 6 && (day - 6) % 4 === 0) {
      this.upgradeExistingHouse();
    }

    // 2. Procedural Additional Stores on Days 13, 17, 25, 29, 33...
    if (day === 13 || day === 17 || (day >= 25 && (day - 25) % 4 === 0)) {
      const unlockedCount = day >= 21 ? 5 : day >= 15 ? 4 : day >= 10 ? 3 : 2;
      const availableColors = this.colorProgression.slice(0, unlockedCount);

      const colorCounts = new Map<BuildingColor, number>();
      for (const c of availableColors) colorCounts.set(c, 0);
      for (const d of this.destinations) {
        colorCounts.set(d.color, (colorCounts.get(d.color) || 0) + 1);
      }

      const sortedColors = [...availableColors].sort((a, b) => {
        const diff = (colorCounts.get(a) || 0) - (colorCounts.get(b) || 0);
        if (diff !== 0) return diff;
        return this.getColorSupplyRatio(b) - this.getColorSupplyRatio(a);
      });
      const chosenColor = sortedColors[0];

      const spawnedDest = this.spawnProceduralDestination(chosenColor, true);
      if (spawnedDest) {
        while (this.getColorSupplyRatio(chosenColor) < 4.5) {
          const h = this.spawnProceduralHouse(chosenColor);
          if (!h) break;
        }
      }
    }

    // 3. Procedural New Houses (Suburb Growth) balanced strictly toward underserved store colors!
    if (!spawnedMilestoneToday && day >= 2) {
      const count = day >= 8 ? 2 : 1;
      for (let c = 0; c < count; c++) {
        const underservedColor = this.getMostUnderservedColor();
        if (underservedColor) {
          this.spawnProceduralHouse(underservedColor);
        }
      }
    }
  }

  /**
   * Spawns a randomized Store for `color` and a separated Suburb Cluster of `houseCount` houses
   * (placed 8..16 tiles away so each color creates a genuine routing challenge across the map).
   */
  private spawnColorStoreAndSuburb(
    color: BuildingColor,
    houseCount: number,
    notify: boolean
  ) {
    const dest = this.spawnProceduralDestination(color, notify);
    const refX = dest ? dest.x : 18;
    const refY = dest ? dest.y : 6;

    // Pick a suburb seed house separated by 8..16 tiles from the store
    let seedHouse: House | null = null;
    const orthoDirs = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];

    for (let attempt = 0; attempt < 120; attempt++) {
      const gx =
        this.activeBounds.minX +
        1 +
        Math.floor(
          Math.random() * Math.max(1, this.activeBounds.maxX - this.activeBounds.minX - 2)
        );
      const gy =
        this.activeBounds.minY +
        1 +
        Math.floor(
          Math.random() * Math.max(1, this.activeBounds.maxY - this.activeBounds.minY - 2)
        );

      const distToStore = Math.hypot(gx - refX, gy - refY);
      if (attempt < 90 && (distToStore < 8.5 || distToStore > 16.5)) continue;
      if (!this.isTileFreeForSpawn(gx, gy)) continue;

      const nearDest = this.destinations.some(
        (d) => gx >= d.x - 1 && gx <= d.x + d.w && gy >= d.y - 1 && gy <= d.y + d.h
      );
      if (nearDest) continue;

      let chosenDriveway: { x: number; y: number } | null = null;
      for (const { dx, dy } of orthoDirs) {
        if (this.isTileFreeForSpawn(gx + dx, gy + dy)) {
          chosenDriveway = { x: gx + dx, y: gy + dy };
          break;
        }
      }
      if (!chosenDriveway) continue;

      seedHouse = this.createHouse(color, gx, gy, chosenDriveway);
      break;
    }

    if (!seedHouse) {
      seedHouse = this.spawnProceduralHouse(color);
    }

    for (let i = 1; i < houseCount; i++) {
      this.spawnProceduralHouse(color);
    }
  }

  /**
   * Spawns the Central Commuter Train Station right along the randomized rail corridor (`y = railRow + 1`)
   * and updates the train stop coordinate so the commuter train stops directly at its platform.
   */
  private spawnProceduralTrainStation(color: BuildingColor): Destination | null {
    const railRow = this.trainStationConfig ? this.trainStationConfig.getRailRow() : 8;
    const preferredX = this.trainStationConfig ? this.trainStationConfig.getStationTileX() : 16;
    const sy = railRow + 1;

    const candidates: number[] = [preferredX];
    const otherXs: number[] = [];
    for (let x = this.activeBounds.minX + 2; x <= this.activeBounds.maxX - 4; x++) {
      if (x !== preferredX) otherXs.push(x);
    }
    // Shuffle fallback trackside X positions
    for (let i = otherXs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [otherXs[i], otherXs[j]] = [otherXs[j], otherXs[i]];
    }
    candidates.push(...otherXs);

    for (const sx of candidates) {
      let clear = true;
      for (let dy = 0; dy <= 2; dy++) {
        for (let dx = -1; dx <= 2; dx++) {
          if (!this.isTileFreeForSpawn(sx + dx, sy + dy)) {
            clear = false;
            break;
          }
        }
        if (!clear) break;
      }
      const tooCloseToDest = this.destinations.some(
        (d) => Math.hypot(d.x - sx, d.y - sy) < 4.0
      );
      if (clear && !tooCloseToDest) {
        if (this.trainStationConfig) {
          this.trainStationConfig.setStationTileX(sx);
        }
        return this.createDestination(
          color,
          sx,
          sy,
          2,
          2,
          false,
          { x: sx + 1, y: sy + 2 },
          true,
          true
        );
      }
    }

    // Fallback if entire rail row was covered by roads
    return this.createDestination(
      color,
      preferredX,
      sy,
      2,
      2,
      false,
      { x: preferredX + 1, y: sy + 2 },
      true,
      true
    );
  }

  private findValidFootprintNear(
    startX: number,
    startY: number,
    w: number,
    h: number
  ): { x: number; y: number } {
    const isFootprintValid = (tx: number, ty: number) => {
      for (let dy = 0; dy <= h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (this.isOccupied(tx + dx, ty + dy)) return false;
          if (this.canPlaceOnTile && !this.canPlaceOnTile(tx + dx, ty + dy)) return false;
        }
      }
      return true;
    };

    if (isFootprintValid(startX, startY)) {
      return { x: startX, y: startY };
    }

    for (let radius = 1; radius <= 8; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = startX + dx;
          const ny = startY + dy;
          if (
            nx >= 2 &&
            nx + w < CONFIG.GRID_COLS - 2 &&
            ny >= 2 &&
            ny + h < CONFIG.GRID_ROWS - 2 &&
            isFootprintValid(nx, ny)
          ) {
            return { x: nx, y: ny };
          }
        }
      }
    }
    return { x: startX, y: startY };
  }

  private createDestination(
    color: BuildingColor,
    x: number,
    y: number,
    w: number,
    h: number,
    isCircular: boolean,
    customEntrance?: { x: number; y: number },
    notify: boolean = true,
    isTrainStation: boolean = false
  ): Destination {
    const validPos = this.findValidFootprintNear(x, y, w, h);
    const fx = validPos.x;
    const fy = validPos.y;
    const entrance =
      fx === x && fy === y && customEntrance
        ? customEntrance
        : { x: fx + 1, y: fy + h };

    const dest: Destination = {
      id: `dest_${color}_${fx}_${fy}_${Date.now()}`,
      x: fx,
      y: fy,
      w,
      h,
      color,
      isCircular,
      isTrainStation,
      entrance,
      pins: 1,
      maxPins:
        isCircular || isTrainStation
          ? CONFIG.GAMEPLAY.MAX_PINS_PER_DESTINATION + 3
          : CONFIG.GAMEPLAY.MAX_PINS_PER_DESTINATION,
      pinAnimations: [0.05],
      spawnAccumulator: 0,
      spawnInterval: isTrainStation
        ? 12.5
        : Math.max(2.1, 6.2 - this.getWeekNumber() * 0.55),
      overflowTimer: 0,
      maxOverflowTime: CONFIG.GAMEPLAY.MAX_OVERFLOW_SECONDS,
      claimedPins: 0,
      spawnAnimation: 0.05,
      activeParkingStalls: [false, false, false, false],
    };
    this.destinations.push(dest);
    if (this.onBuildingSpawn) {
      this.onBuildingSpawn(dest.x, dest.y, dest.w, dest.h);
    }
    if (notify && this.onToast) {
      if (isTrainStation) {
        this.onToast(
          `🚆 Central Train Station opened! Expect passenger rushes when the train arrives!`
        );
      } else {
        this.onToast(`New ${color.toUpperCase()} store opened!`);
      }
    }
    return dest;
  }

  private createHouse(
    color: BuildingColor,
    x: number,
    y: number,
    customDriveway?: { x: number; y: number }
  ): House {
    const validPos = this.findValidFootprintNear(x, y, 1, 1);
    const fx = validPos.x;
    const fy = validPos.y;
    const driveway =
      fx === x && fy === y && customDriveway
        ? customDriveway
        : { x: fx + 1, y: fy };

    const house: House = {
      id: `house_${color}_${fx}_${fy}_${Date.now()}_${Math.random()}`,
      x: fx,
      y: fy,
      color,
      tier: 1,
      driveway,
      totalCars: 2,
      availableCars: 2,
      spawnAnimation: 0.05,
    };
    this.houses.push(house);
    if (this.onBuildingSpawn) {
      this.onBuildingSpawn(house.x, house.y, 1, 1);
    }
    return house;
  }

  /**
   * Upgrades an existing house into a Tier 2 Mid-Rise Apartment (4 cars)
   * or Tier 2 Apartment into a Tier 3 High-Rise Skyscraper (6 cars).
   */
  public upgradeExistingHouse(): House | null {
    // Prioritize upgrading houses belonging to the most underserved store color!
    const sortByUnderserved = (a: House, b: House) =>
      this.getColorSupplyRatio(a.color) - this.getColorSupplyRatio(b.color);

    const tier2Houses = this.houses.filter((h) => h.tier === 2).sort(sortByUnderserved);
    const tier1Houses = this.houses.filter((h) => h.tier === 1).sort(sortByUnderserved);

    let target: House | null = null;
    if (tier2Houses.length >= 2 && (this.currentDay >= 14 || tier1Houses.length === 0)) {
      target = tier2Houses[0];
      target.tier = 3;
      target.totalCars = 6;
      target.availableCars += 2;
      target.spawnAnimation = 0.22;
      sound.playMotorwayPlacement();
      if (this.onToast) {
        this.onToast(
          `${target.color.toUpperCase()} apartment evolved into a High-Rise Skyscraper (6 cars)!`
        );
      }
      return target;
    } else if (tier1Houses.length > 0) {
      target = tier1Houses[0];
      target.tier = 2;
      target.totalCars = 4;
      target.availableCars += 2;
      target.spawnAnimation = 0.22;
      sound.playMotorwayPlacement();
      if (this.onToast) {
        this.onToast(
          `${target.color.toUpperCase()} house upgraded into a Mid-Rise Apartment (4 cars)!`
        );
      }
      return target;
    }
    return null;
  }

  /**
   * Upgrades an existing rectangular store into a Circular High-Demand Hub,
   * just like stores evolving in Mini Motorways.
   */
  private upgradeExistingStore() {
    const candidates = this.destinations.filter((d) => !d.isCircular && !d.isTrainStation);
    if (candidates.length === 0) return;

    const target = candidates[0];
    target.isCircular = true;
    target.spawnAnimation = 0.22; // trigger spring pop animation
    target.maxPins = CONFIG.GAMEPLAY.MAX_PINS_PER_DESTINATION + 3;
    target.spawnInterval = Math.max(2.1, target.spawnInterval * 0.72);
    sound.playMotorwayPlacement();

    if (this.onToast) {
      this.onToast(
        `${target.color.toUpperCase()} store upgraded to a Circular High-Demand Hub!`
      );
    }
  }

  /**
   * Triggered whenever the Surface Commuter Train pulls into the Central Station platform:
   * scales passenger rush with the number of passenger coaches (carCount - 1)!
   * Feature #4: Commuters disembark smoothly in spaced waves rather than an instant 5-pin surge.
   */
  public triggerTrainStationRush() {
    const stations = this.destinations.filter((d) => d.isTrainStation);
    if (stations.length === 0) return;

    const coachCount = Math.max(1, this.getTrainCarCount() - 1);
    const rushCount = Math.min(5, coachCount);
    let totalAdded = 0;

    for (const station of stations) {
      const added = Math.min(rushCount, station.maxPins - station.pins);
      if (added <= 0) continue;

      // First commuter disembarks immediately
      station.pins++;
      station.pinAnimations.push(0.05);
      station.spawnAnimation = 0.65;
      totalAdded += added;

      // Remaining commuters disembark in rhythmic spaced waves
      if (added > 1) {
        this.pendingStationRushes.push({
          destId: station.id,
          pinsLeft: added - 1,
          intervalTimer: 0.65,
        });
      }
    }

    if (totalAdded > 0) {
      sound.playPinSpawn();
      if (this.onToast) {
        this.onToast(
          `🚆 Commuter express arrived with ${coachCount} passenger coach${coachCount > 1 ? 'es' : ''}! (${totalAdded} passengers disembarking in spaced waves)`
        );
      }
    }
  }

  private isTileFreeForSpawn(x: number, y: number): boolean {
    if (
      x < this.activeBounds.minX + 1 ||
      x > this.activeBounds.maxX - 1 ||
      y < this.activeBounds.minY + 1 ||
      y > this.activeBounds.maxY - 1
    ) {
      return false;
    }
    if (this.isOccupied(x, y)) return false;
    // Also never spawn a building directly on top of another building's designated driveway or entrance tile
    for (const h of this.houses) {
      if (h.driveway.x === x && h.driveway.y === y) return false;
    }
    for (const d of this.destinations) {
      if (d.entrance.x === x && d.entrance.y === y) return false;
    }
    if (this.canPlaceOnTile && !this.canPlaceOnTile(x, y)) return false;
    return true;
  }

  private spawnProceduralDestination(
    color: BuildingColor,
    notify: boolean = true
  ): Destination | null {
    const w = 2;
    const h = 2;

    for (let attempt = 0; attempt < 150; attempt++) {
      const gx =
        this.activeBounds.minX +
        2 +
        Math.floor(
          Math.random() * Math.max(1, this.activeBounds.maxX - this.activeBounds.minX - 5)
        );
      const gy =
        this.activeBounds.minY +
        2 +
        Math.floor(
          Math.random() * Math.max(1, this.activeBounds.maxY - this.activeBounds.minY - 5)
        );

      // Ensure 2x2 footprint + 1-tile perimeter buffer is completely clear of water, roads, and buildings
      let clear = true;
      for (let dy = -1; dy <= h; dy++) {
        for (let dx = -1; dx <= w; dx++) {
          if (!this.isTileFreeForSpawn(gx + dx, gy + dy)) {
            clear = false;
            break;
          }
        }
        if (!clear) break;
      }
      if (!clear) continue;

      // Also keep a minimum spacing from other destinations so stores don't crowd each other
      const tooCloseToDest = this.destinations.some(
        (d) => Math.hypot(d.x - gx, d.y - gy) < 5.0
      );
      if (tooCloseToDest) continue;

      // Keep new stores reasonably separated from existing same-color houses
      const tooCloseToSameColorHouse =
        attempt < 110 &&
        this.houses.some((house) => house.color === color && Math.hypot(house.x - gx, house.y - gy) < 6.0);
      if (tooCloseToSameColorHouse) continue;

      return this.createDestination(
        color,
        gx,
        gy,
        w,
        h,
        false,
        { x: gx + 1, y: gy + h },
        notify
      );
    }
    return null;
  }

  private spawnProceduralHouse(color: BuildingColor): House | null {
    const sameColorHouses = this.houses.filter((h) => h.color === color);
    const orthoDirs = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];

    for (let attempt = 0; attempt < 100; attempt++) {
      let gx: number;
      let gy: number;

      // 65% of attempts try to grow an existing same-color suburb cluster
      if (sameColorHouses.length > 0 && attempt < 65) {
        const anchor = sameColorHouses[Math.floor(Math.random() * sameColorHouses.length)];
        const offsetX = Math.floor(Math.random() * 7) - 3;
        const offsetY = Math.floor(Math.random() * 7) - 3;
        gx = anchor.x + offsetX;
        gy = anchor.y + offsetY;
      } else {
        gx =
          this.activeBounds.minX +
          1 +
          Math.floor(
            Math.random() * Math.max(1, this.activeBounds.maxX - this.activeBounds.minX - 2)
          );
        gy =
          this.activeBounds.minY +
          1 +
          Math.floor(
            Math.random() * Math.max(1, this.activeBounds.maxY - this.activeBounds.minY - 2)
          );
      }

      if (!this.isTileFreeForSpawn(gx, gy)) continue;

      // Do not place directly against a destination's walls
      const nearDest = this.destinations.some(
        (d) => gx >= d.x - 1 && gx <= d.x + d.w && gy >= d.y - 1 && gy <= d.y + d.h
      );
      if (nearDest) continue;

      // Find a valid adjacent driveway tile (either an existing road or a free grass tile)
      let chosenDriveway: { x: number; y: number } | null = null;
      for (const { dx, dy } of orthoDirs) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (this.isTileFreeForSpawn(nx, ny)) {
          chosenDriveway = { x: nx, y: ny };
          break;
        }
      }
      if (!chosenDriveway) continue;

      return this.createHouse(color, gx, gy, chosenDriveway);
    }

    return null;
  }

  private updateDestinations(dt: number) {
    let anyCritical = false;
    const isZen = this.gameMode === 'zen';

    for (const dest of this.destinations) {
      dest.spawnAccumulator += dt;

      // Dynamic Population Demand Scaling (Option #2)
      let effectiveInterval = dest.spawnInterval;
      if (this.difficultyMode === 'rush_hour') {
        const pop = this.houses
          .filter((h) => h.color === dest.color)
          .reduce((sum, h) => sum + h.totalCars, 0);
        // Scales demand dynamically with residential population, keeping 60-80% of cars in active motion!
        const popFactor = Math.max(1.0, 1.0 + (pop - 4) * 0.08);
        effectiveInterval = Math.max(1.15, dest.spawnInterval / popFactor);
      } else if (this.difficultyMode === 'relaxed') {
        effectiveInterval = dest.spawnInterval * 1.35;
      }

      if (dest.spawnAccumulator >= effectiveInterval) {
        dest.spawnAccumulator = 0;
        if (dest.pins < dest.maxPins) {
          dest.pins++;
          dest.pinAnimations.push(0.05);
          sound.playPinSpawn();
        }
      }

      // Feature #1: Zen Sandbox Mode - no overflow timers, warning ticks, or game-over threats
      if (isZen) {
        dest.overflowTimer = 0;
        continue;
      }

      if (dest.pins >= CONFIG.GAMEPLAY.OVERFLOW_WARNING_THRESHOLD) {
        dest.overflowTimer += dt;
        sound.playWarningTick();

        if (dest.overflowTimer / dest.maxOverflowTime > 0.72) {
          anyCritical = true;
        }

        if (dest.overflowTimer >= dest.maxOverflowTime) {
          this.triggerGameOver(dest);
          return;
        }
      } else {
        if (dest.overflowTimer > 0) {
          dest.overflowTimer = Math.max(0, dest.overflowTimer - dt * 1.6);
        }
      }
    }

    if (anyCritical) {
      this.screenShake = Math.min(1.0, this.screenShake + dt * 1.8);
    }
  }

  private triggerWeeklyUpgrade() {
    this.upgradePending = true;
    sound.playWeekComplete();

    const week = this.getWeekNumber();
    const isZen = this.gameMode === 'zen';
    const extraRoads = isZen ? 15 : 0;

    const allBundles: UpgradeOption[] = [
      {
        id: 'bundle_subway',
        title: '1 Subway Line & 1 Tunnel',
        subtitle: `+ ${25 + extraRoads} Road Tiles`,
        iconType: 'subway',
        roadsAmount: 25 + extraRoads,
        specialAmount: 1,
      },
      {
        id: 'bundle_motorway',
        title: '1 Motorway & 1 Bridge',
        subtitle: `+ ${25 + extraRoads} Road Tiles`,
        iconType: 'motorway',
        roadsAmount: 25 + extraRoads,
        specialAmount: 1,
      },
      {
        id: 'bundle_tunnel',
        title: '2 Mountain Tunnels & 1 Bridge',
        subtitle: `+ ${30 + extraRoads} Road Tiles`,
        iconType: 'tunnel',
        roadsAmount: 30 + extraRoads,
        specialAmount: 2,
      },
      {
        id: 'bundle_roundabout',
        title: '1 Roundabout & 2 Traffic Lights',
        subtitle: `+ ${30 + extraRoads} Road Tiles`,
        iconType: 'roundabout',
        roadsAmount: 30 + extraRoads,
        specialAmount: 1,
      },
    ];

    const idxA = (week - 1) % allBundles.length;
    const idxB = week % allBundles.length;
    const options: UpgradeOption[] = [allBundles[idxA], allBundles[idxB]];

    if (this.onUpgradeModal) {
      this.onUpgradeModal(options);
    }
  }

  public completeUpgrade() {
    this.upgradePending = false;
    this.processSpawnsForDay(this.currentDay);
  }

  public triggerGameOver(failedDest?: Destination) {
    if (this.gameMode === 'zen' || this.gameOver) return;
    this.gameOver = true;
    if (failedDest) {
      this.failedDestId = failedDest.id;
      const bType = failedDest.isTrainStation
        ? 'Central Train Station'
        : failedDest.isCircular
          ? 'Circular Hub Store'
          : 'Store';
      this.failureReason = `The ${failedDest.color.toUpperCase()} ${bType} at (${failedDest.x}, ${failedDest.y}) overflowed with ${failedDest.pins} waiting pins!`;
    } else {
      this.failureReason = 'Too few cars were able to reach a destination in time.';
    }
    sound.playGameOver();
    if (this.onGameOver) {
      this.onGameOver();
    }
  }

  public isOccupied(x: number, y: number): boolean {
    for (const h of this.houses) {
      if (h.x === x && h.y === y) return true;
    }
    for (const d of this.destinations) {
      if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) {
        return true;
      }
    }
    return false;
  }
}
