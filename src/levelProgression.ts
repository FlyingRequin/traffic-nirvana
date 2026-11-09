import {
  BuildingColor,
  ConstructionSite,
  Destination,
  DifficultyMode,
  GameMode,
  GridCoord,
  House,
  RhythmEvent,
  RhythmPhase,
  StationRushQueueItem,
  SymphonyFlowStats,
  UpgradeOption,
} from './types';
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
  public constructionSites: ConstructionSite[] = [];
  public calmReliefTimer: number = 0;
  private activeStationRushActive: boolean = false;
  private pendingStationRushes: StationRushQueueItem[] = [];

  // City Symphony: Daily Rhythms & Flow Harmony State
  public symphonyFlowStats: SymphonyFlowStats = {
    flowPercentage: 100,
    activeVehicles: 0,
    stalledVehicles: 0,
    flowStreak: 0,
    harmonicMultiplier: 1.0,
    rank: 'S',
  };
  public activeRhythmPhase: RhythmPhase = 'morning_rush';
  public upcomingRhythmEvent: RhythmEvent | null = null;
  public activeRhythmEvent: RhythmEvent | null = null;
  public advanceNoticeGivenFor: Set<string> = new Set();
  public executedEventsForDay: Set<string> = new Set();
  public onRhythmNotice: ((event: RhythmEvent, isAdvanceNotice: boolean) => void) | null = null;
  public onPhaseComplete: ((phase: RhythmPhase, stats: SymphonyFlowStats) => void) | null = null;
  public onGrantBonusRoads: ((count: number) => void) | null = null;
  public onDispatchSurfaceTrain: (() => void) | null = null;
  private flowBreakdownTimer: number = 0;
  private prevRhythmPhase: RhythmPhase = 'morning_rush';

  // Dynamic playable bounds that start framed on the inner neighborhood and expand outward over time
  public activeBounds: MapBounds = {
    minX: 2,
    maxX: 25,
    minY: 1,
    maxY: 16,
  };

  // Optional terrain/road check injected by main game so procedural spawns never land on water or roads
  public canPlaceOnTile: ((x: number, y: number) => boolean) | null = null;
  public getInventoryState:
    | (() => {
        bridges: number;
        tunnels: number;
        roundabouts: number;
        lights: number;
        motorways: number;
        subways: number;
        arterialLevel: number;
        mapId: string;
      })
    | null = null;
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

  public getDayDurationSeconds(): number {
    return this.gameMode === 'symphony' ? 24 : CONFIG.GAMEPLAY.DAY_DURATION_SECONDS;
  }

  public getDayProgress(): number {
    return Math.min(1.0, this.dayTimer / this.getDayDurationSeconds());
  }

  public getCityTime24(): {
    hour: number;
    minute: number;
    timeString: string;
    phase: RhythmPhase;
    phaseTitle: string;
    phaseIcon: string;
    progress: number;
  } {
    const progress = this.getDayProgress();
    // 0.0 -> 06:00 (dawn), 0.5 -> 18:00 (dusk), 1.0 -> 06:00 (next day)
    const totalMinutes = (6 * 60 + progress * 24 * 60) % (24 * 60);
    const hour24 = Math.floor(totalMinutes / 60);
    const minute = Math.floor(totalMinutes % 60);

    const period = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    const timeString = `${hour12.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} ${period}`;

    let phase: RhythmPhase = 'morning_rush';
    let phaseTitle = 'Morning Suburb Commute';
    let phaseIcon = '🌅';

    const decimalHour = hour24 + minute / 60;
    if (decimalHour >= 6.0 && decimalHour < 10.5) {
      phase = 'morning_rush';
      phaseTitle = 'Morning Commute';
      phaseIcon = '🌅';
    } else if (decimalHour >= 10.5 && decimalHour < 15.5) {
      phase = 'midday_market';
      phaseTitle = 'Midday Market Surge';
      phaseIcon = '🛍️';
    } else if (decimalHour >= 15.5 && decimalHour < 20.5) {
      phase = 'evening_rush';
      phaseTitle = 'Evening Rush & Rail';
      phaseIcon = '🌆';
    } else {
      phase = 'night_respite';
      phaseTitle = 'Nocturnal Respite';
      phaseIcon = '🌙';
    }

    return {
      hour: hour24,
      minute,
      timeString,
      phase,
      phaseTitle,
      phaseIcon,
      progress,
    };
  }

  public getDailyRhythmSchedule(): RhythmEvent[] {
    return [
      {
        id: 'morning_rush_start',
        hour: 6,
        minute: 30,
        phase: 'morning_rush',
        title: 'Morning Suburb Wake-Up',
        description: 'Residential suburbs wake up! High demand from homes to workplaces.',
        icon: '🌅',
        targetType: 'suburb',
        advanceNoticeLead: 4.5,
      },
      {
        id: 'morning_train_arrival',
        hour: 8,
        minute: 30,
        phase: 'morning_rush',
        title: 'Commuter Express Inbound',
        description: 'Express train arriving at Central Station! Station surge expected.',
        icon: '🚆',
        targetType: 'station',
        advanceNoticeLead: 4.5,
      },
      {
        id: 'midday_market_peak',
        hour: 12,
        minute: 30,
        phase: 'midday_market',
        title: 'Midday Commercial Peak',
        description: 'High-demand retail & market trade across commercial hubs.',
        icon: '🛍️',
        targetType: 'market',
        advanceNoticeLead: 4.5,
      },
      {
        id: 'evening_rush_start',
        hour: 17,
        minute: 30,
        phase: 'evening_rush',
        title: 'Evening Return & Rail Inbound',
        description: 'Commuters returning to neighborhoods + evening express train.',
        icon: '🌆',
        targetType: 'station',
        advanceNoticeLead: 4.5,
      },
      {
        id: 'night_respite_start',
        hour: 20,
        minute: 30,
        phase: 'night_respite',
        title: 'Nocturnal Respite & Planning',
        description: 'Grid calms. +8 Bonus Roads granted for Blueprint drafting!',
        icon: '🌙',
        targetType: 'all',
        advanceNoticeLead: 4.5,
      },
    ];
  }

  public updateSymphonyFlow(flowRatio: number, activeCars: number, stalledCars: number, dt: number) {
    if (this.gameMode !== 'symphony') return;

    const flowPct = activeCars === 0 ? 100 : Math.round(flowRatio * 100);
    this.symphonyFlowStats.flowPercentage = flowPct;
    this.symphonyFlowStats.activeVehicles = activeCars;
    this.symphonyFlowStats.stalledVehicles = stalledCars;

    if (flowPct >= 80) {
      this.symphonyFlowStats.flowStreak += dt;
      // Multiplier builds up to 3.5x after 18 seconds of continuous harmony
      this.symphonyFlowStats.harmonicMultiplier = Math.min(
        3.5,
        1.0 + (this.symphonyFlowStats.flowStreak / 18.0) * 2.5
      );
      this.flowBreakdownTimer = Math.max(0, this.flowBreakdownTimer - dt * 2.0);
    } else if (flowPct < 55) {
      this.symphonyFlowStats.flowStreak = Math.max(0, this.symphonyFlowStats.flowStreak - dt * 1.5);
      this.symphonyFlowStats.harmonicMultiplier = Math.max(
        1.0,
        this.symphonyFlowStats.harmonicMultiplier - dt * 0.25
      );
      this.flowBreakdownTimer += dt;
      if (this.flowBreakdownTimer >= 11.0) {
        this.flowBreakdownTimer = 0;
        sound.playFlowBreakdownAlert();
        if (this.onToast) {
          this.onToast('⚠️ Gridlock forming — flow harmony slipping below 55%!');
        }
      }
    }

    if (flowPct >= 90) this.symphonyFlowStats.rank = 'S';
    else if (flowPct >= 80) this.symphonyFlowStats.rank = 'A';
    else if (flowPct >= 65) this.symphonyFlowStats.rank = 'B';
    else this.symphonyFlowStats.rank = 'C';
  }

  public triggerCalmRelief(reason: string) {
    if (this.calmReliefTimer > 0) return;
    this.calmReliefTimer = 8.5;
    sound.playReliefResolution();
    if (this.onToast) {
      this.onToast(`✨ Flow Restored: ${reason}! Enjoy the calm rhythm.`);
    }
  }

  public triggerTrainApproachingNotice() {
    sound.playWaveAdvanceWarning();
    sound.playCrossingBell();
    if (this.onToast) {
      this.onToast('🚆 Central Express arriving in 5s — peak station rush approaching!');
    }
  }

  public scheduleConstructionSite(
    type: 'house' | 'destination',
    color: BuildingColor,
    x: number,
    y: number,
    w: number,
    h: number,
    entrance: GridCoord,
    label: string,
    previewDuration = 4.5,
    isCircular = false,
    isTrainStation = false
  ): ConstructionSite {
    const site: ConstructionSite = {
      id: `cs_${Date.now()}_${Math.random()}`,
      type,
      color,
      x,
      y,
      w,
      h,
      entrance,
      isCircular,
      isTrainStation,
      previewTimer: previewDuration,
      totalDuration: previewDuration,
      label,
    };
    this.constructionSites.push(site);
    sound.playBlueprintDraft();
    return site;
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

    // Update construction site blueprint previews (Feature #3: Preparation rhythm)
    for (let i = this.constructionSites.length - 1; i >= 0; i--) {
      const site = this.constructionSites[i];
      site.previewTimer -= scaledDt;
      if (site.previewTimer <= 0) {
        this.constructionSites.splice(i, 1);
        sound.playBlueprintCommit();
        if (site.type === 'destination') {
          const dest = this.createDestination(
            site.color,
            site.x,
            site.y,
            site.w,
            site.h,
            site.isCircular ?? false,
            site.entrance,
            true,
            site.isTrainStation ?? false
          );
          dest.gracePeriodTimer = 9.0;
          if (this.onToast) {
            this.onToast(`🎉 Grand Opening: New ${site.color.toUpperCase()} Store open! (9s connection window)`);
          }
        } else {
          this.createHouse(site.color, site.x, site.y, site.entrance);
          if (this.onToast) {
            this.onToast(`🏠 New ${site.color.toUpperCase()} Home completed!`);
          }
        }
      }
    }

    // Check station rush wave completion and trigger calm relief
    if (this.activeStationRushActive && this.pendingStationRushes.length === 0) {
      const station = this.destinations.find((d) => d.isTrainStation);
      if (!station || station.pins <= 1) {
        this.activeStationRushActive = false;
        this.triggerCalmRelief('Station commuter rush cleared');
      }
    }

    // City Symphony Timetable & Advance Notice Processing
    if (this.gameMode === 'symphony') {
      const cityTime = this.getCityTime24();
      this.activeRhythmPhase = cityTime.phase;

      // Check phase transition
      if (this.prevRhythmPhase !== cityTime.phase) {
        const finishedPhase = this.prevRhythmPhase;
        this.prevRhythmPhase = cityTime.phase;

        // Check if player maintained harmony in the completed phase
        if (this.symphonyFlowStats.flowPercentage >= 75 || this.symphonyFlowStats.flowStreak >= 8.0) {
          const bonus = Math.round(5 * this.symphonyFlowStats.harmonicMultiplier);
          this.score += bonus;
          sound.playFlowStateCrescendo();
          if (this.onToast) {
            this.onToast(`🎶 Flow Harmony Bonus! +${bonus} points (${this.symphonyFlowStats.rank}-Rank)`);
          }
        }

        if (cityTime.phase === 'night_respite') {
          if (this.onGrantBonusRoads) {
            this.onGrantBonusRoads(8);
          }
          if (this.onToast) {
            this.onToast('🌙 Nocturnal Respite: +8 Bonus Roads awarded for blueprint planning!');
          }
        }

        if (this.onPhaseComplete) {
          this.onPhaseComplete(finishedPhase, { ...this.symphonyFlowStats });
        }
      }

      // Check daily rhythm schedule
      const schedule = this.getDailyRhythmSchedule();
      const currentDaySeconds = this.dayTimer;
      const dayDuration = this.getDayDurationSeconds();
      const progress = currentDaySeconds / dayDuration;
      const currentDecHour = (6 + progress * 24) % 24;

      let nextUpcoming: RhythmEvent | null = null;
      let minTimeToEvent = 9999;

      for (const ev of schedule) {
        const evDecHour = ev.hour + ev.minute / 60;
        let hourDiff = evDecHour - currentDecHour;
        if (hourDiff < -0.1) hourDiff += 24;

        const secondsUntil = (hourDiff / 24) * dayDuration;

        if (secondsUntil >= 0 && secondsUntil < minTimeToEvent) {
          minTimeToEvent = secondsUntil;
          nextUpcoming = ev;
        }

        // Advance notice trigger (e.g. 4.5s before event)
        const advanceKey = `${this.currentDay}_${ev.id}_adv`;
        if (
          secondsUntil <= ev.advanceNoticeLead &&
          secondsUntil > 0 &&
          !this.advanceNoticeGivenFor.has(advanceKey)
        ) {
          this.advanceNoticeGivenFor.add(advanceKey);
          sound.playWaveAdvanceWarning();
          if (this.onRhythmNotice) {
            this.onRhythmNotice(ev, true);
          }
        }

        // Actual event execution trigger
        const execKey = `${this.currentDay}_${ev.id}_exec`;
        if (secondsUntil <= 0.35 && !this.executedEventsForDay.has(execKey)) {
          this.executedEventsForDay.add(execKey);
          this.activeRhythmEvent = ev;
          if (this.onRhythmNotice) {
            this.onRhythmNotice(ev, false);
          }

          // Trigger surface commuter train if station event
          if (ev.targetType === 'station' && this.onDispatchSurfaceTrain) {
            this.onDispatchSurfaceTrain();
          }
        }
      }

      this.upcomingRhythmEvent = nextUpcoming;
    }

    const dayDuration = this.getDayDurationSeconds();
    if (this.dayTimer >= dayDuration) {
      this.dayTimer = 0;
      this.currentDay++;
      this.advanceNoticeGivenFor.clear();
      this.executedEventsForDay.clear();

      this.expandMapBoundsForDay(this.currentDay);

      if ((this.currentDay - 1) % 7 === 0) {
        // Scale up existing store demand each week & consolidate suburban sprawl into vertical towers!
        for (const d of this.destinations) {
          d.spawnInterval = Math.max(1.85, d.spawnInterval * 0.88);
        }
        this.consolidateSprawlIntoTowers(false);
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

    const demandWeight = colorDests.reduce((sum, d) => {
      const tier = d.tier || (d.isCircular ? 3 : 1);
      const w = d.isTrainStation ? 1.55 : tier === 4 ? 1.85 : tier === 3 ? 1.55 : tier === 2 ? 1.25 : 1.0;
      return sum + w;
    }, 0);
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
      // Day 1: Central Commuter Train Station right along the rail corridor
      this.spawnProceduralTrainStation(this.colorProgression[0]);
      // Day 1: Initial Store + 2 Houses in a separated suburb cluster
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
      // Day 4: Additional commuter houses to support growing station demand
      this.spawnProceduralHouse(this.colorProgression[0]);
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

    // 1. Periodic Store Upgrades (promotes Tier 1 -> Tier 2 -> Tier 3 -> Tier 4 as the city ages)
    if (day >= 8 && (day - 8) % 5 === 0) {
      this.upgradeExistingStore(undefined, false, day >= 23 ? 4 : 3);
    }

    // 1b. Continuous Residential Pyramid Upgrades (maintains ~45% Houses, ~35% Apartments, ~20% Skyscrapers)
    if (day >= 5 && (day - 5) % 2 === 0) {
      const mostNeeded = this.getMostUnderservedColor();
      this.upgradeExistingHouse(mostNeeded || undefined);
    }

    // 2. Continuous Procedural Store Expansion on Days 12, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52...
    const nonStationStores = this.destinations.filter((d) => !d.isTrainStation).length;
    if (
      nonStationStores < 22 &&
      (day === 12 || day === 16 || day === 19 || (day >= 22 && (day - 22) % 3 === 0))
    ) {
      const unlockedCount = day >= 21 ? 5 : day >= 15 ? 4 : day >= 10 ? 3 : 2;
      const availableColors = this.colorProgression.slice(0, unlockedCount);

      const colorCounts = new Map<BuildingColor, number>();
      for (const c of availableColors) colorCounts.set(c, 0);
      for (const d of this.destinations) {
        if (!d.isTrainStation) {
          colorCounts.set(d.color, (colorCounts.get(d.color) || 0) + 1);
        }
      }

      // Prioritize colors that have high car supply ratio or fewer stores
      const sortedColors = [...availableColors].sort((a, b) => {
        const ratioDiff = this.getColorSupplyRatio(b) - this.getColorSupplyRatio(a);
        if (Math.abs(ratioDiff) > 1.0) return ratioDiff;
        return (colorCounts.get(a) || 0) - (colorCounts.get(b) || 0);
      });
      const chosenColor = sortedColors[0];

      this.spawnProceduralDestination(chosenColor, true);
      this.spawnProceduralHouse(chosenColor);
    }

    // 3. Unconditional Daily Suburb & City Growth (city never freezes!)
    if (!spawnedMilestoneToday && day >= 2) {
      const week = this.getWeekNumber();
      const targetRatioCap = 7.2 + week * 0.95;
      const count = day >= 10 ? 2 : 1;

      for (let c = 0; c < count; c++) {
        const underservedColor = this.getMostUnderservedColor();
        if (!underservedColor) break;
        const supplyRatio = this.getColorSupplyRatio(underservedColor);

        if (supplyRatio < targetRatioCap) {
          this.spawnProceduralHouse(underservedColor);
        } else if (c === 0) {
          // All existing stores are well-supplied: open a new store or expand suburbs!
          if (day % 2 === 0 && nonStationStores < 22) {
            this.spawnProceduralDestination(underservedColor, true);
          }
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
      tier: isCircular ? 3 : 1,
      servicedCount: 0,
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
   * Upgrades an existing house into a Tier 2 Mid-Rise Apartment (3 cars)
   * or Tier 2 Apartment into a Tier 3 High-Rise Skyscraper (5 cars) while
   * strictly preserving a Golden Urban Skyline Pyramid (~45% T1 Houses, ~35% T2 Apartments, ~20% T3 Skyscrapers)
   * and promoting buildings closest to the neighborhood core first!
   */
  public upgradeExistingHouse(
    preferredColor?: BuildingColor,
    silent: boolean = false,
    forceConsolidate: boolean = false
  ): House | null {
    const pool = preferredColor
      ? this.houses.filter((h) => h.color === preferredColor)
      : this.houses;
    if (pool.length === 0) return null;

    // Compute centroid of pool so inner-core buildings densify into Apartments & Skyscrapers first
    const cx = pool.reduce((s, h) => s + h.x, 0) / pool.length;
    const cy = pool.reduce((s, h) => s + h.y, 0) / pool.length;

    const sortByCoreAndNeed = (a: House, b: House) => {
      const ratioDiff = this.getColorSupplyRatio(a.color) - this.getColorSupplyRatio(b.color);
      if (Math.abs(ratioDiff) > 0.4) return ratioDiff;
      return Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy);
    };

    const tier3Houses = pool.filter((h) => h.tier === 3);
    const tier2Houses = pool.filter((h) => h.tier === 2).sort(sortByCoreAndNeed);
    const tier1Houses = pool.filter((h) => h.tier === 1).sort(sortByCoreAndNeed);

    // Golden Pyramid Rule:
    // Promote T2 -> T3 Skyscraper once a color has at least 2 T2 Apartments and more T2s than T3s
    const canPromoteToTier3 =
      tier2Houses.length >= 1 &&
      (this.currentDay >= 9 || forceConsolidate) &&
      (tier2Houses.length >= Math.max(2, tier3Houses.length + 1) ||
        (forceConsolidate && tier1Houses.length === 0));

    // Promote T1 -> T2 Apartment whenever there are at least 2 T1 Houses
    const canPromoteToTier2 =
      tier1Houses.length >= 1 &&
      (forceConsolidate || tier1Houses.length >= Math.max(2, Math.floor(tier2Houses.length * 0.85)));

    let target: House | null = null;
    if (canPromoteToTier3) {
      target = tier2Houses[0];
      target.tier = 3;
      target.totalCars = 5;
      target.availableCars += 2;
      target.spawnAnimation = 0.22;
      this.tryMergeNearbyTier1Sprawl(target);
      if (!silent) {
        sound.playMotorwayPlacement();
        if (this.onToast) {
          this.onToast(
            `🏙️ ${target.color.toUpperCase()} Apartment evolved into a High-Rise Skyscraper (5 cars)!`
          );
        }
      }
      return target;
    } else if (canPromoteToTier2) {
      target = tier1Houses[0];
      target.tier = 2;
      target.totalCars = 3;
      target.availableCars += 1;
      target.spawnAnimation = 0.22;
      this.tryMergeNearbyTier1Sprawl(target);
      if (!silent) {
        sound.playMotorwayPlacement();
        if (this.onToast) {
          this.onToast(
            `🏢 ${target.color.toUpperCase()} House densified into a Mid-Rise Apartment (3 cars)!`
          );
        }
      }
      return target;
    }
    return null;
  }

  /**
   * Only absorbs a nearby idle Tier-1 house when the city grid is genuinely saturated (80+ lots)
   * so normal progression from Week 1 to Week 12+ continuously expands neighborhoods outward AND upward!
   */
  private tryMergeNearbyTier1Sprawl(upgradedHouse: House): boolean {
    if (this.houses.length < 80) return false;
    const sameColor = this.houses.filter((h) => h.color === upgradedHouse.color);
    const sameColorT1 = sameColor.filter((h) => h.tier === 1);
    if (sameColor.length < 14 || sameColorT1.length <= 6) return false;

    const mergeCandidate = sameColorT1.find(
      (h) =>
        h.id !== upgradedHouse.id &&
        h.availableCars === h.totalCars &&
        Math.hypot(h.x - upgradedHouse.x, h.y - upgradedHouse.y) <= 4.5
    );
    if (!mergeCandidate) return false;

    const idx = this.houses.indexOf(mergeCandidate);
    if (idx !== -1) {
      this.houses.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Sweeps across the city and consolidates crowded Tier-1 house clusters into
   * a balanced pyramid of Mid-Rise Apartments (Tier 2) and High-Rise Skyscrapers (Tier 3).
   */
  public consolidateSprawlIntoTowers(announce: boolean = true): number {
    let upgradedCount = 0;
    const colors: BuildingColor[] = ['red', 'blue', 'yellow', 'green', 'purple'];

    for (const color of colors) {
      const colorHouses = this.houses.filter((h) => h.color === color);
      const t1Count = colorHouses.filter((h) => h.tier === 1).length;
      if (announce ? colorHouses.length < 2 : t1Count <= 4) continue;

      // Consolidate excess Tier-1 sprawl while preserving the suburban pyramid
      const targetUpgrades = announce
        ? Math.max(1, Math.floor(colorHouses.length * 0.3))
        : Math.max(1, Math.floor((t1Count - 4) * 0.25));
      for (let i = 0; i < targetUpgrades; i++) {
        const res = this.upgradeExistingHouse(color, true, announce);
        if (res) upgradedCount++;
      }
    }

    // Only advance commercial stores during manual densification button clicks
    if (announce) {
      const upgradeableStores = this.destinations.filter(
        (d) => !d.isTrainStation && (d.tier || (d.isCircular ? 3 : 1)) < 4
      );
      if (upgradeableStores.length > 0) {
        if (this.upgradeExistingStore(undefined, true, 4)) {
          upgradedCount++;
        }
      }
      // Also seed fresh urban expansion if the city has room for more stores/suburbs
      const nonStationStores = this.destinations.filter((d) => !d.isTrainStation).length;
      if (this.currentDay >= 15 && nonStationStores < 22) {
        const expColor = colors[Math.floor(Math.random() * colors.length)];
        this.spawnProceduralDestination(expColor, this.currentDay >= 24 && Math.random() < 0.45);
        this.spawnProceduralHouse(expColor);
        upgradedCount++;
      }
    }

    if (upgradedCount > 0 && announce) {
      sound.playMotorwayPlacement();
      if (this.onToast) {
        this.onToast(
          `🏙️ Urban Densification: ${upgradedCount} lots & hubs consolidated into Mid-Rises & Skyscrapers!`
        );
      }
    }
    return upgradedCount;
  }

  /**
   * Advances a commercial store through its 4 architectural & capacity tiers:
   * Tier 1: Corner Market -> Tier 2: Department Galleria -> Tier 3: Geodesic Rotunda Hub -> Tier 4: Mega-Commerce Arcology Tower
   */
  public upgradeExistingStore(
    targetDest?: Destination,
    silent: boolean = false,
    maxAllowedTier: 2 | 3 | 4 = 4
  ): Destination | null {
    const getStoreTier = (d: Destination): 1 | 2 | 3 | 4 =>
      d.tier || (d.isCircular ? 3 : 1);

    const nonStationStores = this.destinations.filter((d) => !d.isTrainStation);
    const tier4Count = nonStationStores.filter((d) => getStoreTier(d) === 4).length;
    const maxTier4Allowed = Math.max(1, Math.floor(nonStationStores.length * 0.38));

    let target = targetDest || null;
    if (!target) {
      const candidates = nonStationStores
        .filter((d) => {
          const ct = getStoreTier(d);
          if (ct >= maxAllowedTier) return false;
          if (ct === 3 && tier4Count >= maxTier4Allowed) return false;
          return true;
        })
        .sort((a, b) => {
          const tierDiff = getStoreTier(a) - getStoreTier(b);
          if (tierDiff !== 0) return tierDiff;
          return (b.servicedCount || 0) - (a.servicedCount || 0);
        });
      if (candidates.length === 0) return null;
      target = candidates[0];
    }

    const currentTier = getStoreTier(target);
    if (currentTier >= maxAllowedTier || target.isTrainStation) return null;
    if (currentTier === 3 && tier4Count >= maxTier4Allowed && !targetDest) return null;

    const nextTier = (currentTier + 1) as 2 | 3 | 4;
    target.tier = nextTier;
    target.isCircular = nextTier === 3;
    target.spawnAnimation = 0.25; // trigger spring pop animation
    target.maxPins = CONFIG.GAMEPLAY.MAX_PINS_PER_DESTINATION + (nextTier - 1);
    target.spawnInterval = Math.max(2.05, target.spawnInterval * 0.9);

    if (!silent) {
      sound.playMotorwayPlacement();
      if (this.onToast) {
        const tierNames: Record<2 | 3 | 4, string> = {
          2: '🛍️ Tier 2 Multi-Story Department Galleria',
          3: '🏛️ Tier 3 Geodesic Rotunda Exchange Hub',
          4: '🏙️ Tier 4 Mega-Commerce Arcology Tower',
        };
        this.onToast(
          `${target.color.toUpperCase()} Store evolved into a ${tierNames[nextTier]}!`
        );
      }
    }
    return target;
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
      this.activeStationRushActive = true;
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
      x < Math.max(1, this.activeBounds.minX) ||
      x > Math.min(CONFIG.GRID_COLS - 2, this.activeBounds.maxX) ||
      y < Math.max(1, this.activeBounds.minY) ||
      y > Math.min(CONFIG.GRID_ROWS - 2, this.activeBounds.maxY)
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

    const canFitStoreAt = (gx: number, gy: number, strictBuffer: boolean): { x: number; y: number } | null => {
      // Check 2x2 core building footprint
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (!this.isTileFreeForSpawn(gx + dx, gy + dy)) return null;
        }
      }
      if (strictBuffer) {
        // Also require 1-tile perimeter buffer in early attempts
        for (let dy = -1; dy <= h; dy++) {
          for (let dx = -1; dx <= w; dx++) {
            if (!this.isTileFreeForSpawn(gx + dx, gy + dy)) return null;
          }
        }
        return { x: gx + 1, y: gy + h };
      }

      // In compact infill mode, accept either a South entrance (gy + h) or North entrance (gy - 1)
      if (this.isTileFreeForSpawn(gx + 1, gy + h)) {
        return { x: gx + 1, y: gy + h };
      }
      if (this.isTileFreeForSpawn(gx, gy + h)) {
        return { x: gx, y: gy + h };
      }
      if (this.isTileFreeForSpawn(gx + 1, gy - 1)) {
        return { x: gx + 1, y: gy - 1 };
      }
      return null;
    };

    const placeOrScheduleStore = (gx: number, gy: number, entrance: { x: number; y: number }) => {
      if (this.currentDay > 1) {
        this.scheduleConstructionSite(
          'destination',
          color,
          gx,
          gy,
          w,
          h,
          entrance,
          `New ${color.toUpperCase()} Store`,
          4.8
        );
        if (this.onToast && notify) {
          this.onToast(
            `🏗️ Survey Underway: New ${color.toUpperCase()} Commercial Center planned! Prepare road connections.`
          );
        }
        return null;
      }

      return this.createDestination(color, gx, gy, w, h, false, entrance, notify);
    };

    const minX = Math.max(1, this.activeBounds.minX);
    const maxX = Math.min(CONFIG.GRID_COLS - 3, this.activeBounds.maxX - 1);
    const minY = Math.max(1, this.activeBounds.minY);
    const maxY = Math.min(CONFIG.GRID_ROWS - 3, this.activeBounds.maxY - 1);

    // Pass 1 & 2: Randomized search (strict spacing first, then compact urban infill)
    for (let attempt = 0; attempt < 220; attempt++) {
      const strict = attempt < 110;
      const gx = minX + Math.floor(Math.random() * Math.max(1, maxX - minX + 1));
      const gy = minY + Math.floor(Math.random() * Math.max(1, maxY - minY + 1));

      const entrance = canFitStoreAt(gx, gy, strict);
      if (!entrance) continue;

      const minDestDist = strict ? 4.4 : 2.8;
      const tooCloseToDest = this.destinations.some(
        (d) => Math.hypot(d.x - gx, d.y - gy) < minDestDist
      );
      if (tooCloseToDest) continue;

      const tooCloseToSite = this.constructionSites.some(
        (s) => Math.hypot(s.x - gx, s.y - gy) < minDestDist
      );
      if (tooCloseToSite) continue;

      if (
        strict &&
        this.houses.some((house) => house.color === color && Math.hypot(house.x - gx, house.y - gy) < 4.8)
      ) {
        continue;
      }

      return placeOrScheduleStore(gx, gy, entrance);
    }

    // Pass 3: Exhaustive Grid Scan across the entire map so Twin Islands / Alpine Pass never run out of store sites!
    let bestSpot: { gx: number; gy: number; entrance: { x: number; y: number }; score: number } | null = null;
    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const entrance = canFitStoreAt(gx, gy, false);
        if (!entrance) continue;

        let minDistToExisting = 999;
        for (const d of this.destinations) {
          minDistToExisting = Math.min(minDistToExisting, Math.hypot(d.x - gx, d.y - gy));
        }
        for (const s of this.constructionSites) {
          minDistToExisting = Math.min(minDistToExisting, Math.hypot(s.x - gx, s.y - gy));
        }
        if (minDistToExisting < 2.6) continue;

        if (!bestSpot || minDistToExisting > bestSpot.score) {
          bestSpot = { gx, gy, entrance, score: minDistToExisting };
        }
      }
    }

    if (bestSpot) {
      return placeOrScheduleStore(bestSpot.gx, bestSpot.gy, bestSpot.entrance);
    }

    // Fallback Vertical Store Densification when late-game 34x22 grid is saturated:
    const upgradeCandidate =
      this.destinations.find((d) => d.color === color && !d.isCircular && !d.isTrainStation) ||
      this.destinations.find((d) => !d.isCircular && !d.isTrainStation) ||
      this.destinations.find((d) => d.color === color && !d.isTrainStation);
    if (upgradeCandidate) {
      if (!upgradeCandidate.isCircular) {
        upgradeCandidate.isCircular = true;
      }
      upgradeCandidate.maxPins = Math.min(12, upgradeCandidate.maxPins + 2);
      upgradeCandidate.spawnInterval = Math.max(1.75, upgradeCandidate.spawnInterval * 0.85);
      upgradeCandidate.gracePeriodTimer = 6.0;
      if (this.onToast && notify) {
        this.onToast(
          `🏢 Downtown Densification: ${upgradeCandidate.color.toUpperCase()} Store expanded into High-Capacity Hub!`
        );
      }
    }
    return null;
  }

  private spawnProceduralHouse(color: BuildingColor): House | null {
    const sameColorHouses = this.houses.filter((h) => h.color === color);
    const upgradableSameColor = sameColorHouses.filter((h) => (h.tier || 1) < 3);

    // Balanced Horizontal + Vertical Growth:
    // ~38% of spawns upgrade an existing building into a Mid-Rise Apartment or High-Rise Skyscraper,
    // while ~62% place a new house lot so the city continuously expands across all 4 quadrants of the map!
    if (upgradableSameColor.length > 0) {
      const densityChance =
        this.houses.length >= 65
          ? 0.58
          : sameColorHouses.length >= 5 || this.houses.length >= 22
          ? 0.36
          : 0;
      if (Math.random() < densityChance) {
        const upgraded = this.upgradeExistingHouse(color, false);
        if (upgraded) return upgraded;
      }
    }

    const orthoDirs = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];

    const minX = Math.max(1, this.activeBounds.minX);
    const maxX = Math.min(CONFIG.GRID_COLS - 2, this.activeBounds.maxX);
    const minY = Math.max(1, this.activeBounds.minY);
    const maxY = Math.min(CONFIG.GRID_ROWS - 2, this.activeBounds.maxY);

    for (let attempt = 0; attempt < 130; attempt++) {
      let gx: number;
      let gy: number;

      // 52% of attempts grow an existing same-color cluster; 48% seed new outer suburbs across the map!
      const clusterThreshold = sameColorHouses.length >= 6 ? 48 : 65;
      if (sameColorHouses.length > 0 && attempt < clusterThreshold) {
        const anchor = sameColorHouses[Math.floor(Math.random() * sameColorHouses.length)];
        const offsetX = Math.floor(Math.random() * 9) - 4;
        const offsetY = Math.floor(Math.random() * 9) - 4;
        gx = anchor.x + offsetX;
        gy = anchor.y + offsetY;
      } else {
        gx = minX + Math.floor(Math.random() * Math.max(1, maxX - minX + 1));
        gy = minY + Math.floor(Math.random() * Math.max(1, maxY - minY + 1));
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

    return this.upgradeExistingHouse(color, false, true);
  }

  private updateDestinations(dt: number) {
    let anyCritical = false;
    const isZen = this.gameMode === 'zen';

    for (const dest of this.destinations) {
      dest.spawnAccumulator += dt;

      // Feature #3: Store Connection Grace Period (Freeze overflow timers during initial connection window)
      if (dest.gracePeriodTimer && dest.gracePeriodTimer > 0) {
        dest.gracePeriodTimer = Math.max(0, dest.gracePeriodTimer - dt);
        dest.overflowTimer = 0;
      }

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

      // Feature #3: Calm Relief Period (Relaxes demand during breathing cycle)
      if (this.calmReliefTimer > 0) {
        effectiveInterval *= 1.35;
      }

      // City Symphony Daily Rhythm Demand Modulation
      if (this.gameMode === 'symphony') {
        if (this.activeRhythmPhase === 'morning_rush' && dest.isTrainStation) {
          effectiveInterval *= 0.82; // Higher morning rush at commuter station
        } else if (
          this.activeRhythmPhase === 'midday_market' &&
          (dest.isCircular || !dest.isTrainStation)
        ) {
          effectiveInterval *= 0.78; // Lively midday market shopping peak
        } else if (this.activeRhythmPhase === 'evening_rush') {
          effectiveInterval *= 0.85; // Evening rush peak
        } else if (this.activeRhythmPhase === 'night_respite') {
          effectiveInterval *= 1.65; // Calm nocturnal drift for blueprint drafting
        }
      }

      if (dest.spawnAccumulator >= effectiveInterval) {
        dest.spawnAccumulator = 0;
        if (dest.pins < dest.maxPins) {
          dest.pins++;
          dest.pinAnimations.push(0.05);
          sound.playPinSpawn();
        }
      }

      // Feature #1: Zen Sandbox Mode & Store Connection Grace Period - no overflow timers or game-overs
      if (isZen || (dest.gracePeriodTimer && dest.gracePeriodTimer > 0)) {
        dest.overflowTimer = 0;
        continue;
      }

      if (dest.pins >= CONFIG.GAMEPLAY.OVERFLOW_WARNING_THRESHOLD) {
        const flowDampening =
          this.gameMode === 'symphony' && this.symphonyFlowStats.flowPercentage >= 75
            ? 0.65
            : 1.0;
        dest.overflowTimer += dt * flowDampening;
        sound.playWarningTick();

        if (dest.overflowTimer / dest.maxOverflowTime > 0.72) {
          anyCritical = true;
        }

        if (dest.overflowTimer >= dest.maxOverflowTime) {
          this.triggerGameOver(dest);
          return;
        }
      } else {
        if (dest.overflowTimer > 3.0 && dest.pins <= 1) {
          dest.overflowTimer = 0;
          this.triggerCalmRelief('Commercial Hub Rescued');
        } else if (dest.overflowTimer > 0) {
          dest.overflowTimer = Math.max(0, dest.overflowTimer - dt * 1.6);
        }
      }
    }

    if (this.calmReliefTimer > 0) {
      this.calmReliefTimer = Math.max(0, this.calmReliefTimer - dt);
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
        subtitle: `+ ${25 + extraRoads} Road Tiles (Metro Transit)`,
        iconType: 'subway',
        roadsAmount: 25 + extraRoads,
        specialAmount: 1,
      },
      {
        id: 'bundle_motorway',
        title: '1 Motorway & 1 Bridge',
        subtitle: `+ ${25 + extraRoads} Road Tiles (Express Flyover)`,
        iconType: 'motorway',
        roadsAmount: 25 + extraRoads,
        specialAmount: 1,
      },
      {
        id: 'bundle_bridge_lights',
        title: '2 River Bridges & 2 Smart Lights',
        subtitle: `+ ${28 + extraRoads} Road Tiles (Island & River Link)`,
        iconType: 'bridge',
        roadsAmount: 28 + extraRoads,
        specialAmount: 2,
      },
      {
        id: 'bundle_roundabout',
        title: '1 Roundabout & 2 Traffic Lights',
        subtitle: `+ ${30 + extraRoads} Road Tiles (Flow Control)`,
        iconType: 'roundabout',
        roadsAmount: 30 + extraRoads,
        specialAmount: 1,
      },
      {
        id: 'bundle_tunnel',
        title: '2 Mountain Tunnels & 1 Bridge',
        subtitle: `+ ${30 + extraRoads} Road Tiles (Alpine Bore)`,
        iconType: 'tunnel',
        roadsAmount: 30 + extraRoads,
        specialAmount: 2,
      },
      {
        id: 'bundle_arterial_expansion',
        title: 'Arterial Highway Expansion',
        subtitle: `+ ${45 + extraRoads} Roads, 1 Bridge & +1 Arterial Speed Boost Tier!`,
        iconType: 'roads',
        roadsAmount: 45 + extraRoads,
        specialAmount: 1,
      },
    ];

    // Pick 3 distinct, context-aware upgrade cards so players never get RNG-locked by rivers or mountains:
    // Slot 1: Heavy Rapid Transit (Motorway Flyover or Subway Metro)
    // Slot 2: Flow & Arterial Engineering (Arterial Boost Expansion or Roundabout + Smart Lights)
    // Slot 3: Terrain & Expansion Relief (Prioritizes Bridges or Tunnels when inventory is low!)
    const inv = this.getInventoryState ? this.getInventoryState() : null;
    const picked: UpgradeOption[] = [];

    // Slot 1: Heavy Rapid Transit
    const transitOptions = [allBundles[0], allBundles[1]]; // Subway vs Motorway
    if (inv && inv.motorways === 0 && inv.subways > 0) {
      picked.push(allBundles[1]);
    } else if (inv && inv.subways === 0 && inv.motorways > 0) {
      picked.push(allBundles[0]);
    } else {
      picked.push(transitOptions[(week + Math.floor(Math.random() * 2)) % 2]);
    }

    // Slot 2: Flow & Arterial Engineering
    const flowOptions = [allBundles[3], allBundles[5]]; // Roundabout vs Arterial Boost
    if (inv && inv.roundabouts === 0 && week % 2 === 1) {
      picked.push(allBundles[3]);
    } else {
      picked.push(flowOptions[(week + Math.floor(Math.random() * 2)) % 2]);
    }

    // Slot 3: Terrain & Bottleneck Relief
    if (inv && inv.mapId === 'alpine_pass' && inv.tunnels <= 1) {
      picked.push(allBundles[4]); // 2 Mountain Tunnels & 1 Bridge
    } else if (inv && inv.bridges <= 1) {
      picked.push(allBundles[2]); // 2 River Bridges & 2 Smart Lights
    } else {
      const remaining = allBundles.filter((b) => !picked.some((p) => p.id === b.id));
      picked.push(remaining[Math.floor(Math.random() * remaining.length)]);
    }

    if (this.onUpgradeModal) {
      this.onUpgradeModal(picked);
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
    for (const s of this.constructionSites) {
      if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) {
        return true;
      }
      if (x === s.entrance.x && y === s.entrance.y) {
        return true;
      }
    }
    return false;
  }
}
