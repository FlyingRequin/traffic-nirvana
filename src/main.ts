import { StatusBar } from '@capacitor/status-bar';
import { RoadNetwork } from './roadNetwork';
import { LevelProgression } from './levelProgression';
import { TrafficSimulation } from './traffic';
import { GameRenderer } from './renderer';
import { sound } from './sound';
import { DifficultyMode, GameMode, GridCoord, MapId, UpgradeOption } from './types';

type ToolType = 'draw' | 'erase' | 'motorway' | 'roundabout' | 'traffic_light' | 'subway' | 'blueprint';

class MiniMotorwaysGame {
  public canvas: HTMLCanvasElement;
  public roadNetwork: RoadNetwork;
  public level: LevelProgression;
  public traffic: TrafficSimulation;
  public renderer: GameRenderer;
  public currentMapId: MapId = 'river_valley';

  // Interaction State
  private currentTool: ToolType = 'draw';
  private isPointerDown: boolean = false;
  private activePointerButton: number = 0;
  private lastDragCoord: GridCoord | null = null;
  private hoverCoord: GridCoord | null = null;
  private dragPath: GridCoord[] = [];
  private motorwayStartCoord: GridCoord | null = null;

  // DOM Elements
  private scoreEl: HTMLElement;
  private dayEl: HTMLElement;
  private weekEl: HTMLElement;
  private clockHandEl: HTMLElement;
  private dayProgressFillEl: HTMLElement;
  private roadsCountEl: HTMLElement;
  private bridgesCountEl: HTMLElement;
  private tunnelsCountEl: HTMLElement;
  private roundaboutsCountEl: HTMLElement;
  private lightsCountEl: HTMLElement;
  private motorwaysCountEl: HTMLElement;
  private subwaysCountEl: HTMLElement;
  private btnPause: HTMLElement;
  private btnSpeed1: HTMLElement;
  private btnSpeed2: HTMLElement;
  private btnSpeed4: HTMLElement;
  private isPanningCamera: boolean = false;
  private lastPanScreen: { x: number; y: number } = { x: 0, y: 0 };
  private activeTouchPointers: Map<number, { x: number; y: number }> = new Map();
  private lastPinchDist: number = 0;
  private lastPinchMid: { x: number; y: number } = { x: 0, y: 0 };
  private toolDrawBtn: HTMLElement;
  private toolRoundaboutBtn: HTMLElement;
  private toolTrafficLightBtn: HTMLElement;
  private toolMotorwayBtn: HTMLElement;
  private toolSubwayBtn: HTMLElement;
  private toolBlueprintBtn: HTMLElement;
  private toolEraseBtn: HTMLElement;
  private blueprintCountBadge: HTMLElement;
  private blueprintBar: HTMLElement;
  private blueprintCostText: HTMLElement;
  private btnBlueprintCommit: HTMLElement;
  private btnBlueprintDiscard: HTMLElement;
  private calendarPill: HTMLElement;
  private zenPill: HTMLElement;
  private symphonyPill: HTMLElement;
  private symphonyClockEl: HTMLElement;
  private symphonyPhaseEl: HTMLElement;
  private symphonyFlowLabelEl: HTMLElement;
  private symphonyFlowBarEl: HTMLElement;
  private symphonyMultiplierEl: HTMLElement;
  private timetableTicker: HTMLElement;
  private tickerTextEl: HTMLElement;
  private diffPill: HTMLElement;
  private selectedGameMode: GameMode = 'standard';
  private selectedDifficulty: DifficultyMode = 'normal';
  private toastEl: HTMLElement;
  private upgradeModal: HTMLElement;
  private upgradeOptionsContainer: HTMLElement;
  private gameOverModal: HTMLElement;
  private finalScoreEl: HTMLElement;
  private finalDaysEl: HTMLElement;
  private btnRestart: HTMLElement;
  private startScreen: HTMLElement;
  private pauseMenu: HTMLElement;
  private postcardModal: HTMLElement;
  private postcardImg: HTMLImageElement;
  private currentPostcardUrl: string = '';
  private inMenu: boolean = true;
  private wasPausedBeforeMenu: boolean = false;

  private toastTimeout: number | null = null;
  private toastQueue: string[] = [];
  private isShowingToast: boolean = false;
  private lastTime: number = 0;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

    this.scoreEl = document.getElementById('score-display')!;
    this.dayEl = document.getElementById('day-display')!;
    this.weekEl = document.getElementById('week-display')!;
    this.clockHandEl = document.getElementById('clock-hand')!;
    this.dayProgressFillEl = document.getElementById('day-progress-fill')!;
    this.roadsCountEl = document.getElementById('roads-count')!;
    this.bridgesCountEl = document.getElementById('bridges-count')!;
    this.tunnelsCountEl = document.getElementById('tunnels-count')!;
    this.roundaboutsCountEl = document.getElementById('roundabouts-count')!;
    this.lightsCountEl = document.getElementById('lights-count')!;
    this.motorwaysCountEl = document.getElementById('motorways-count')!;
    this.subwaysCountEl = document.getElementById('subways-count')!;
    this.btnPause = document.getElementById('btn-pause')!;
    this.btnSpeed1 = document.getElementById('btn-speed-1')!;
    this.btnSpeed2 = document.getElementById('btn-speed-2')!;
    this.btnSpeed4 = document.getElementById('btn-speed-4')!;
    this.toolDrawBtn = document.getElementById('tool-draw')!;
    this.toolRoundaboutBtn = document.getElementById('tool-roundabout')!;
    this.toolTrafficLightBtn = document.getElementById('tool-traffic-light')!;
    this.toolMotorwayBtn = document.getElementById('tool-motorway')!;
    this.toolSubwayBtn = document.getElementById('tool-subway')!;
    this.toolBlueprintBtn = document.getElementById('tool-blueprint')!;
    this.toolEraseBtn = document.getElementById('tool-erase')!;
    this.blueprintCountBadge = document.getElementById('blueprint-count')!;
    this.blueprintBar = document.getElementById('blueprint-bar')!;
    this.blueprintCostText = document.getElementById('blueprint-cost')!;
    this.btnBlueprintCommit = document.getElementById('btn-blueprint-commit')!;
    this.btnBlueprintDiscard = document.getElementById('btn-blueprint-discard')!;
    this.calendarPill = document.getElementById('calendar-pill')!;
    this.zenPill = document.getElementById('zen-pill')!;
    this.symphonyPill = document.getElementById('symphony-pill')!;
    this.symphonyClockEl = document.getElementById('symphony-clock')!;
    this.symphonyPhaseEl = document.getElementById('symphony-phase')!;
    this.symphonyFlowLabelEl = document.getElementById('symphony-flow-label')!;
    this.symphonyFlowBarEl = document.getElementById('symphony-flow-bar')!;
    this.symphonyMultiplierEl = document.getElementById('symphony-multiplier')!;
    this.timetableTicker = document.getElementById('timetable-ticker')!;
    this.tickerTextEl = document.getElementById('ticker-text')!;
    this.diffPill = document.getElementById('diff-pill')!;
    this.toastEl = document.getElementById('toast')!;
    this.upgradeModal = document.getElementById('upgrade-modal')!;
    this.upgradeOptionsContainer = document.getElementById('upgrade-options-container')!;
    this.gameOverModal = document.getElementById('game-over-modal')!;
    this.finalScoreEl = document.getElementById('final-score')!;
    this.finalDaysEl = document.getElementById('final-days')!;
    this.btnRestart = document.getElementById('btn-restart')!;
    this.startScreen = document.getElementById('start-screen')!;
    this.pauseMenu = document.getElementById('pause-menu')!;
    this.postcardModal = document.getElementById('postcard-modal')!;
    this.postcardImg = document.getElementById('postcard-preview-img') as HTMLImageElement;
    this.loadSettings();

    this.roadNetwork = new RoadNetwork(this.currentMapId);
    this.level = new LevelProgression(
      (options) => this.showUpgradeModal(options),
      () => this.showGameOver(),
      (msg) => this.showToast(msg),
      (bx, by, bw, bh) => {
        for (let dy = 0; dy < bh; dy++) {
          for (let dx = 0; dx < bw; dx++) {
            this.roadNetwork.clearTreesNear(bx + dx, by + dy, 0.9);
          }
        }
      },
      (x, y) => this.roadNetwork.getTileType(x, y) === 'grass' && !this.roadNetwork.hasRoad(x, y),
      {
        getRailRow: () => this.roadNetwork.railRow,
        getStationTileX: () => this.roadNetwork.stationTileX,
        setStationTileX: (x) => {
          this.roadNetwork.stationTileX = x;
        },
      }
    );
    this.roadNetwork.defaultOccupiedCheck = (x, y) => this.level.isOccupied(x, y);
    (window as any).game = this;
    this.level.gameMode = this.selectedGameMode;
    this.level.difficultyMode = this.selectedDifficulty;
    this.calendarPill.classList.toggle('hidden', this.selectedGameMode === 'symphony');
    this.zenPill.classList.toggle('hidden', this.selectedGameMode !== 'zen');
    this.symphonyPill.classList.toggle('hidden', this.selectedGameMode !== 'symphony');
    this.diffPill.classList.toggle('hidden', this.selectedDifficulty !== 'rush_hour');
    if (this.selectedGameMode === 'zen') {
      this.roadNetwork.roadsRemaining += 20;
    }
    this.roadNetwork.onTrainStationArrival = () => this.level.triggerTrainStationRush();
    this.roadNetwork.onTrainApproaching = () => this.level.triggerTrainApproachingNotice();
    this.roadNetwork.getTrainCarCount = () => this.level.getTrainCarCount();
    this.level.onGrantBonusRoads = (count: number) => {
      this.roadNetwork.roadsRemaining += count;
      this.updateHUD();
    };
    this.level.onDispatchSurfaceTrain = () => {
      if (!this.roadNetwork.surfaceTrain.active) {
        this.roadNetwork.surfaceTrain.active = true;
        this.roadNetwork.surfaceTrain.distance = 0;
        this.roadNetwork.surfaceTrain.hasStoppedThisRun = false;
        this.roadNetwork.surfaceTrain.stationStopTimer = 0;
      }
    };
    this.traffic = new TrafficSimulation(
      this.roadNetwork,
      () => this.level.houses,
      () => this.level.destinations,
      (points) => {
        this.level.score += points;
        this.updateHUD();
      }
    );
    this.traffic.getGameMode = () => this.level.gameMode;
    this.traffic.getHarmonicMultiplier = () => this.level.symphonyFlowStats.harmonicMultiplier;
    this.traffic.onUpdateFlowStats = (ratio, active, stalled, dt) => {
      this.level.updateSymphonyFlow(ratio, active, stalled, dt);
    };
    this.renderer = new GameRenderer(
      this.canvas,
      this.roadNetwork,
      this.traffic,
      this.level
    );

    this.bindEvents();
    this.renderer.resize();
    this.updateHUD();
    void StatusBar.hide().catch(() => {});

    // Boot into the setup screen with a live (paused) preview of the chosen city
    this.renderer.isNightMode = this.prefNight;
    document.body.classList.toggle('night-mode', this.prefNight);
    this.level.isPaused = true;
    document.body.classList.add('in-menu');
    this.syncMenuUI();

    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.gameLoop(t));
  }

  private bindEvents() {
    window.addEventListener('resize', () => this.renderer.resize());
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') {
        this.hoverCoord = null;
        this.isPanningCamera = false;
      }
    });
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.renderer.zoomAt(factor, e.clientX, e.clientY);
        this.updateHUD();
      },
      { passive: false }
    );

    // Setup screen: city picker
    document.querySelectorAll<HTMLElement>('.map-card').forEach((card) => {
      card.addEventListener('click', () => {
        sound.unlockAudio();
        const mapId = card.dataset.map as MapId;
        if (mapId !== this.currentMapId) {
          this.currentMapId = mapId;
          this.restartGame(false);
          this.level.isPaused = true;
          this.saveSettings();
        }
        this.syncMenuUI();
      });
    });

    // Setup screen: game mode picker (Feature #1)
    document.querySelectorAll<HTMLElement>('.mode-card').forEach((card) => {
      card.addEventListener('click', () => {
        sound.unlockAudio();
        document.querySelectorAll('.mode-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        const mode = card.dataset.mode as GameMode;
        if (mode) this.selectedGameMode = mode;
      });
    });

    // Setup screen: difficulty picker (Option #2)
    document.querySelectorAll<HTMLElement>('.diff-card').forEach((card) => {
      card.addEventListener('click', () => {
        sound.unlockAudio();
        document.querySelectorAll('.diff-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        const diff = card.dataset.diff as DifficultyMode;
        if (diff) this.selectedDifficulty = diff;
      });
    });

    // Settings toggles (exist on both setup screen and pause menu)
    document.querySelectorAll<HTMLElement>('.toggle-row').forEach((row) => {
      row.addEventListener('click', () => {
        sound.unlockAudio();
        if (row.dataset.opt === 'night') this.toggleTheme();
        else if (row.dataset.opt === 'sound') this.toggleSound();
      });
    });

    document.getElementById('btn-start')!.addEventListener('click', () => this.startFromMenu());
    document.getElementById('btn-daily-challenge')?.addEventListener('click', () => this.startDailyChallenge());
    document.getElementById('btn-solar')?.addEventListener('click', () => this.cycleSolarLighting());
    document.getElementById('btn-weather')?.addEventListener('click', () => this.cycleSeasonWeather());
    document.getElementById('btn-art-style')?.addEventListener('click', () => this.cycleArtStyle());
    document.getElementById('btn-arterial')?.addEventListener('click', () => this.upgradeArterialBoost(false));
    document.getElementById('btn-densify')?.addEventListener('click', () => this.triggerManualDensification());
    document.getElementById('btn-menu')!.addEventListener('click', () => this.openPauseMenu());
    document.getElementById('btn-resume')!.addEventListener('click', () => this.closePauseMenu());
    document.getElementById('btn-recenter')!.addEventListener('click', () => {
      this.renderer.resetCamera();
      this.closePauseMenu();
    });
    document.getElementById('btn-restart-city')!.addEventListener('click', () => {
      this.pauseMenu.classList.add('hidden');
      this.restartGame();
    });
    document.querySelectorAll<HTMLElement>('.btn-main-menu').forEach((btn) =>
      btn.addEventListener('click', () => this.showStartScreen())
    );

    // Heatmap & Postcard Photo Mode handlers
    document.getElementById('btn-toggle-heatmap')?.addEventListener('click', () => this.toggleHeatmap());
    document.getElementById('btn-pause-heatmap')?.addEventListener('click', () => this.toggleHeatmap());
    document.getElementById('btn-export-postcard')?.addEventListener('click', () => this.showPostcardModal());
    document.getElementById('btn-pause-postcard')?.addEventListener('click', () => this.showPostcardModal());
    document.getElementById('btn-close-postcard')?.addEventListener('click', () => this.closePostcardModal());
    document.getElementById('btn-copy-postcard')?.addEventListener('click', () => this.copyPostcard());
    document.getElementById('btn-download-postcard')?.addEventListener('click', () => this.downloadPostcard());

    this.toolDrawBtn.addEventListener('click', () => this.setTool('draw'));
    this.toolRoundaboutBtn.addEventListener('click', () => this.setTool('roundabout'));
    this.toolTrafficLightBtn.addEventListener('click', () => this.setTool('traffic_light'));
    this.toolMotorwayBtn.addEventListener('click', () => this.setTool('motorway'));
    this.toolSubwayBtn.addEventListener('click', () => this.setTool('subway'));
    this.toolBlueprintBtn.addEventListener('click', () => this.toggleBlueprintMode());
    this.toolEraseBtn.addEventListener('click', () => this.setTool('erase'));

    this.btnBlueprintCommit.addEventListener('click', () => this.commitBlueprint());
    this.btnBlueprintDiscard.addEventListener('click', () => this.discardBlueprint());

    this.btnPause.addEventListener('click', () => this.togglePause());
    this.btnSpeed1.addEventListener('click', () => this.setSpeed(1));
    this.btnSpeed2.addEventListener('click', () => this.setSpeed(2));
    this.btnSpeed4.addEventListener('click', () => this.setSpeed(4));
    this.btnRestart.addEventListener('click', () => this.restartGame());

    window.addEventListener('keydown', (e) => {
      if (this.inMenu) {
        if (e.key === 'Enter') this.startFromMenu();
        return;
      }
      if (e.key === 'Escape') {
        if (!this.postcardModal.classList.contains('hidden')) {
          this.closePostcardModal();
          return;
        }
        if (this.roadNetwork.blueprintRoads.size > 0 || this.currentTool === 'blueprint') {
          this.discardBlueprint();
          return;
        }
        if (this.pauseMenu.classList.contains('hidden')) this.openPauseMenu();
        else this.closePauseMenu();
        return;
      }
      if (!this.pauseMenu.classList.contains('hidden')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePause();
      } else if (e.key === 'Enter') {
        if (this.roadNetwork.blueprintRoads.size > 0 || this.currentTool === 'blueprint') {
          this.commitBlueprint();
        }
      } else if (e.key === '1') {
        this.setSpeed(1);
      } else if (e.key === '2') {
        this.setSpeed(2);
      } else if (e.key === '3' || e.key === '4') {
        this.setSpeed(4);
      } else if (e.key === 'h' || e.key === 'H') {
        this.toggleHeatmap();
      } else if (e.key === 'p' || e.key === 'P') {
        this.showPostcardModal();
      } else if (e.key === 'b' || e.key === 'B') {
        this.toggleBlueprintMode();
      } else if (e.key === 'd' || e.key === 'D') {
        this.setTool('draw');
      } else if (e.key === 'r' || e.key === 'R') {
        this.setTool('roundabout');
      } else if (e.key === 't' || e.key === 'T') {
        this.setTool('traffic_light');
      } else if (e.key === 'w' || e.key === 'W') {
        this.setTool('motorway');
      } else if (e.key === 's' || e.key === 'S') {
        this.setTool('subway');
      } else if (e.key === 'e' || e.key === 'E') {
        this.setTool('erase');
      } else if (e.key === 'n' || e.key === 'N') {
        this.cycleSolarLighting();
      } else if (e.key === 'k' || e.key === 'K') {
        this.cycleSeasonWeather();
      } else if (e.key === 'v' || e.key === 'V') {
        this.cycleArtStyle();
      } else if (e.key === 'a' || e.key === 'A') {
        this.upgradeArterialBoost(false);
      } else if (e.key === 'u' || e.key === 'U') {
        this.triggerManualDensification();
      } else if (e.key === 'm' || e.key === 'M') {
        this.toggleSound();
      } else if (e.key === '=' || e.key === '+') {
        this.renderer.zoomAt(1.18);
        this.updateHUD();
      } else if (e.key === '-' || e.key === '_') {
        this.renderer.zoomAt(1 / 1.18);
        this.updateHUD();
      } else if (e.key === '0') {
        this.renderer.resetCamera();
        this.updateHUD();
      }
    });
  }

  public switchMap(mapId: MapId) {
    this.currentMapId = mapId;
    this.restartGame();
  }

  // ------------------------------------------------------------ Menus & setup
  private static readonly MAP_NAMES: Record<MapId, string> = {
    river_valley: 'River Valley',
    twin_islands: 'Twin Islands',
    alpine_pass: 'Alpine Pass',
  };

  private prefNight: boolean = false;

  private loadSettings() {
    try {
      const raw = localStorage.getItem('tn-settings');
      if (!raw) return;
      const st = JSON.parse(raw);
      if (st.map && st.map in MiniMotorwaysGame.MAP_NAMES) this.currentMapId = st.map;
      if (typeof st.sound === 'boolean') sound.enabled = st.sound;
      if (typeof st.night === 'boolean') this.prefNight = st.night;
    } catch {
      /* ignore corrupt settings */
    }
  }

  private saveSettings() {
    try {
      localStorage.setItem(
        'tn-settings',
        JSON.stringify({ map: this.currentMapId, sound: sound.enabled, night: this.renderer.isNightMode })
      );
    } catch {
      /* storage unavailable */
    }
  }

  private getBestScores(): Record<string, number> {
    try {
      return JSON.parse(localStorage.getItem('tn-best') || '{}');
    } catch {
      return {};
    }
  }

  private recordBestScore() {
    const best = this.getBestScores();
    if ((best[this.currentMapId] ?? 0) < this.level.score) {
      best[this.currentMapId] = this.level.score;
      try {
        localStorage.setItem('tn-best', JSON.stringify(best));
      } catch {
        /* storage unavailable */
      }
    }
  }

  /** Sync map cards, toggles, best scores and labels with current state. */
  private syncMenuUI() {
    document.querySelectorAll<HTMLElement>('.map-card').forEach((card) => {
      card.classList.toggle('selected', card.dataset.map === this.currentMapId);
    });
    document.querySelectorAll<HTMLElement>('.toggle-row').forEach((row) => {
      const on = row.dataset.opt === 'night' ? this.renderer.isNightMode : sound.enabled;
      row.classList.toggle('on', on);
    });
    const best = this.getBestScores();
    document.querySelectorAll<HTMLElement>('.map-best').forEach((el) => {
      const mapKey = el.dataset.best || '';
      const v = best[mapKey] ?? 0;
      if (v > 0) {
        const medal =
          v >= 4000 ? '💎 Nirvana' : v >= 2500 ? '🥇 Gold' : v >= 1200 ? '🥈 Silver' : v >= 500 ? '🥉 Bronze' : '🏁';
        el.innerText = `${medal} · Best: ${v} trips`;
      } else {
        el.innerText = 'Not played yet (🥉 500)';
      }
    });
    const dailyBtnLbl = document.getElementById('daily-challenge-label');
    if (dailyBtnLbl) {
      const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dailyBtnLbl.innerText = `📅 Daily Challenge (${today})`;
    }
    const nameEl = document.getElementById('pause-map-name');
    if (nameEl) nameEl.innerText = MiniMotorwaysGame.MAP_NAMES[this.currentMapId];
  }

  private showStartScreen() {
    this.inMenu = true;
    this.gameOverModal.classList.add('hidden');
    this.pauseMenu.classList.add('hidden');
    this.upgradeModal.classList.add('hidden');
    // Fresh city in the background as a live preview
    this.restartGame(false);
    this.level.isPaused = true;
    document.body.classList.add('in-menu');
    this.startScreen.classList.remove('hidden');
    this.syncMenuUI();
  }

  public startFromMenu() {
    if (!this.inMenu) return;
    sound.unlockAudio();
    this.inMenu = false;
    this.startScreen.classList.add('hidden');
    document.body.classList.remove('in-menu');
    this.level.gameMode = this.selectedGameMode;
    this.level.difficultyMode = this.selectedDifficulty;
    this.calendarPill.classList.toggle('hidden', this.selectedGameMode === 'symphony');
    this.zenPill.classList.toggle('hidden', this.selectedGameMode !== 'zen');
    this.symphonyPill.classList.toggle('hidden', this.selectedGameMode !== 'symphony');
    this.diffPill.classList.toggle('hidden', this.selectedDifficulty !== 'rush_hour');
    if (this.selectedGameMode === 'zen') {
      this.roadNetwork.roadsRemaining += 20;
    }
    this.level.isPaused = false;
    this.setSpeed(1);
    this.renderer.resetCamera();
    this.saveSettings();
    const modeName = this.selectedGameMode === 'zen' ? ' (Zen Mode)' : '';
    this.showToast(`Welcome to ${MiniMotorwaysGame.MAP_NAMES[this.currentMapId]}${modeName} — drag from a house to a matching store!`);
  }

  private openPauseMenu() {
    if (this.inMenu || this.level.gameOver) return;
    this.wasPausedBeforeMenu = this.level.isPaused;
    this.level.isPaused = true;
    this.syncMenuUI();
    this.pauseMenu.classList.remove('hidden');
  }

  private closePauseMenu() {
    this.pauseMenu.classList.add('hidden');
    this.level.isPaused = this.wasPausedBeforeMenu;
  }

  private setTool(tool: ToolType) {
    this.currentTool = tool;
    this.toolDrawBtn.classList.toggle('active', tool === 'draw');
    this.toolRoundaboutBtn.classList.toggle('active', tool === 'roundabout');
    this.toolTrafficLightBtn.classList.toggle('active', tool === 'traffic_light');
    this.toolMotorwayBtn.classList.toggle('active', tool === 'motorway');
    this.toolSubwayBtn.classList.toggle('active', tool === 'subway');
    this.toolBlueprintBtn.classList.toggle('active', tool === 'blueprint');
    this.toolEraseBtn.classList.toggle('active', tool === 'erase');

    if (tool === 'blueprint') {
      if (!this.level.isPaused) {
        this.togglePause();
      }
      this.blueprintBar.classList.remove('hidden');
      this.showToast('📐 Blueprint Mode: Plan roads freely without consuming tiles. Press [Enter] or Commit to build!');
    } else {
      if (this.roadNetwork.blueprintRoads.size === 0) {
        this.blueprintBar.classList.add('hidden');
      }
    }

    if (tool === 'motorway') {
      this.showToast('Click and drag between two points to build an express Motorway!');
    } else if (tool === 'subway') {
      this.showToast('Click and drag between a suburb/High-Rise and a Store to build an underground Subway Line!');
    } else if (tool === 'roundabout') {
      this.showToast('Click on the map to place a 3x3 rotary Roundabout!');
    } else if (tool === 'traffic_light') {
      this.showToast('Click on any road intersection to toggle a Traffic Light!');
    }
  }

  private toggleBlueprintMode() {
    if (this.currentTool === 'blueprint') {
      this.setTool('draw');
    } else {
      this.setTool('blueprint');
    }
    this.updateHUD();
  }

  private commitBlueprint() {
    const res = this.roadNetwork.commitBlueprint((x, y) => this.level.isOccupied(x, y));
    if (res.success) {
      this.showToast(`✨ Blueprint committed! Constructed ${res.placed} road tiles.`);
      this.setTool('draw');
    } else {
      this.showToast(res.reason || 'Cannot commit blueprint.');
    }
    this.updateHUD();
  }

  private discardBlueprint() {
    this.roadNetwork.discardBlueprint();
    this.showToast('Blueprint drafts cleared.');
    this.setTool('draw');
    this.updateHUD();
  }

  private toggleTheme() {
    this.cycleSolarLighting();
  }

  private cycleSolarLighting() {
    const mode = this.renderer.env.cycleLightingMode();
    sound.triggerHaptic('light');
    document.body.classList.toggle('night-mode', mode === 'night');
    const labels: Record<string, string> = {
      auto: '🌅 Auto Solar Cycle (Dawn → Day → Dusk → Night)',
      day: '☀️ Daylight Locked',
      dusk: '🌇 Golden Hour Dusk Locked',
      night: '🌙 Nocturnal Night Locked',
    };
    this.showToast(labels[mode] || 'Solar mode updated');
    this.updateHUD();
    this.syncMenuUI();
    this.saveSettings();
  }

  private cycleSeasonWeather() {
    const res = this.renderer.env.cycleSeasonAndWeather();
    sound.triggerHaptic('light');
    this.showToast(`${res.icon} Atmosphere: ${res.label}`);
    this.updateHUD();
  }

  private cycleArtStyle() {
    const styles: Array<'diorama' | 'clay' | 'modern'> = ['diorama', 'clay', 'modern'];
    const next = styles[(styles.indexOf(this.renderer.artStyle) + 1) % styles.length];
    this.renderer.artStyle = next;
    sound.triggerHaptic('light');
    const labels: Record<string, string> = {
      diorama: '🏠 Architectural Style: Crisp 3D Diorama',
      clay: '🧸 Architectural Style: Cozy Clay Toy',
      modern: '🏢 Architectural Style: Modern Glass & Cantilever',
    };
    this.showToast(labels[next]);
    this.updateHUD();
  }

  private upgradeArterialBoost(fromWeeklyBundle: boolean) {
    if (!fromWeeklyBundle) {
      const roadCost = 15;
      if (this.roadNetwork.arterialLevel >= 3) {
        this.showToast('⚡ Smart Super-Arterial is already at Maximum Tier (Lv.3 — +50% Speed)!');
        return;
      }
      if (this.roadNetwork.roadsRemaining < roadCost) {
        this.showToast(`⚠️ Need ${roadCost} spare Road Tiles to upgrade Arterial Highway Tier (or pick it in Weekly Upgrades)!`);
        return;
      }
      this.roadNetwork.roadsRemaining -= roadCost;
    }

    this.roadNetwork.arterialLevel = Math.min(4, this.roadNetwork.arterialLevel + 1);
    const lvl = this.roadNetwork.arterialLevel;
    sound.triggerHaptic('medium');
    if (lvl === 1) {
      this.showToast('🛣️ Arterial Highway Lv.1: +20% Corridor Speed & Twin Amber Center Stripes!');
    } else if (lvl === 2) {
      this.showToast('⚡ Express Boulevard Lv.2: +35% Speed, Priority Intersections & Cat’s-Eye LED Studs!');
    } else {
      this.showToast(`🚀 Smart Super-Arterial Lv.${lvl}: +50% Speed, Boulevard Streetlamps & Slipstream Wake!`);
    }
    this.updateHUD();
  }

  private triggerManualDensification() {
    sound.triggerHaptic('medium');
    const count = this.level.consolidateSprawlIntoTowers(true);
    if (count === 0) {
      const u1 = this.level.upgradeExistingHouse(undefined, false);
      const u2 = this.level.upgradeExistingHouse(undefined, true);
      if (!u1 && !u2) {
        this.showToast('🏙️ All current residential buildings are already at maximum Skyscraper density!');
      }
    }
    this.updateHUD();
  }

  public startDailyChallenge() {
    const now = new Date();
    const daySeed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    const maps: MapId[] = ['river_valley', 'twin_islands', 'alpine_pass'];
    const seasons: Array<'spring' | 'summer' | 'autumn' | 'winter'> = ['spring', 'summer', 'autumn', 'winter'];
    const weathers: Array<'blossoms' | 'rain' | 'leaves' | 'snow' | 'mist'> = ['blossoms', 'rain', 'leaves', 'snow', 'mist'];

    this.currentMapId = maps[daySeed % maps.length];
    this.selectedGameMode = daySeed % 2 === 0 ? 'symphony' : 'standard';
    this.selectedDifficulty = 'rush_hour';

    const dailySeason = seasons[(daySeed >> 2) % seasons.length];
    const dailyWeather = weathers[(daySeed >> 3) % weathers.length];

    this.inMenu = false;
    this.startScreen.classList.add('hidden');
    document.body.classList.remove('in-menu');
    this.restartGame(false);

    this.renderer.env.seasonOverride = dailySeason;
    this.renderer.env.weatherOverride = dailyWeather;
    this.renderer.env.lightingMode = 'auto';
    this.level.isPaused = false;
    this.setSpeed(1);
    this.renderer.resetCamera();
    this.updateHUD();

    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    this.showToast(
      `📅 Daily Challenge (${dateStr}): ${MiniMotorwaysGame.MAP_NAMES[this.currentMapId]} · ${dailySeason.toUpperCase()} · RUSH HOUR!`
    );
  }

  private togglePause() {
    this.level.isPaused = !this.level.isPaused;
    this.btnPause.classList.toggle('active', this.level.isPaused);
    if (!this.level.isPaused) {
      this.btnSpeed1.classList.toggle('active', this.level.gameSpeed === 1);
      this.btnSpeed2.classList.toggle('active', this.level.gameSpeed === 2);
      this.btnSpeed4.classList.toggle('active', this.level.gameSpeed === 4);
    } else {
      this.btnSpeed1.classList.remove('active');
      this.btnSpeed2.classList.remove('active');
      this.btnSpeed4.classList.remove('active');
    }
  }

  private setSpeed(speed: number) {
    this.level.isPaused = false;
    this.level.gameSpeed = speed;
    this.btnPause.classList.remove('active');
    this.btnSpeed1.classList.toggle('active', speed === 1);
    this.btnSpeed2.classList.toggle('active', speed === 2);
    this.btnSpeed4.classList.toggle('active', speed === 4);
  }

  private toggleSound() {
    sound.enabled = !sound.enabled;
    this.syncMenuUI();
    this.saveSettings();
  }

  private onPointerDown(e: PointerEvent) {
    sound.unlockAudio();

    if (e.pointerType === 'touch') {
      this.activeTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activeTouchPointers.size >= 2) {
        // Switch immediately into 2-finger pinch-to-zoom & pan gesture
        this.isPointerDown = false;
        this.lastDragCoord = null;
        this.dragPath = [];
        this.motorwayStartCoord = null;
        const pts = Array.from(this.activeTouchPointers.values());
        this.lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        this.lastPinchMid = {
          x: (pts[0].x + pts[1].x) * 0.5,
          y: (pts[0].y + pts[1].y) * 0.5,
        };
        return;
      }
    }

    // Middle-click or Alt+Left-click pans the camera when zoomed
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.isPanningCamera = true;
      this.lastPanScreen = { x: e.clientX, y: e.clientY };
      return;
    }

    if (this.level.gameOver || this.level.upgradePending) return;

    this.isPointerDown = true;
    this.activePointerButton = e.button;
    const coord = this.renderer.screenToGrid(e.clientX, e.clientY);
    this.lastDragCoord = coord;
    this.dragPath = [coord];

    // Right-click or Erase tool
    if (e.button === 2 || this.currentTool === 'erase') {
      const nearSubway = this.roadNetwork.getSubwayNear(coord.x, coord.y);
      if (nearSubway) {
        this.roadNetwork.removeSubway(nearSubway.id);
        this.showToast('Subway line reclaimed.');
        this.updateHUD();
        return;
      }

      const nearMotorway = this.roadNetwork.getMotorwayNear(coord.x, coord.y);
      if (nearMotorway) {
        this.roadNetwork.removeMotorway(nearMotorway.id);
        this.showToast('Motorway reclaimed.');
      } else {
        this.roadNetwork.removeRoad(coord.x, coord.y, (x, y) => this.traffic.isCarOnTile(x, y));
      }
      this.updateHUD();
      return;
    }

    if (this.currentTool === 'roundabout') {
      const ok = this.roadNetwork.placeRoundabout(coord.x, coord.y, (x, y) =>
        this.level.isOccupied(x, y)
      );
      if (ok) {
        this.showToast('Roundabout placed!');
        this.setTool('draw');
      } else {
        this.showToast('Cannot place Roundabout here (needs 3x3 clear land & 1 Roundabout).');
      }
      this.updateHUD();
      return;
    }

    if (this.currentTool === 'traffic_light') {
      const res = this.roadNetwork.toggleTrafficLight(coord.x, coord.y);
      if (res === 'placed') {
        this.showToast('Traffic Light installed on road!');
        this.setTool('draw');
      } else if (res === 'removed') {
        this.showToast('Traffic Light reclaimed.');
      } else {
        this.showToast('Click on an existing road tile to place a Traffic Light.');
      }
      this.updateHUD();
      return;
    }

    if (this.currentTool === 'motorway') {
      const existing = this.roadNetwork.getMotorwayNear(coord.x, coord.y);
      if (existing) {
        const dStart = Math.hypot(existing.start.x - coord.x, existing.start.y - coord.y);
        const dEnd = Math.hypot(existing.end.x - coord.x, existing.end.y - coord.y);
        this.motorwayStartCoord = dStart < dEnd ? { ...existing.end } : { ...existing.start };
        this.roadNetwork.removeMotorway(existing.id);
        this.updateHUD();
        return;
      }
      if (this.roadNetwork.motorwaysRemaining <= 0) {
        this.showToast('No Motorways remaining! Click an existing Motorway ramp to move it.');
        return;
      }
      this.motorwayStartCoord = coord;
      return;
    }

    if (this.currentTool === 'subway') {
      const existingSub = this.roadNetwork.getSubwayNear(coord.x, coord.y);
      if (existingSub) {
        const dStart = Math.hypot(existingSub.start.x - coord.x, existingSub.start.y - coord.y);
        const dEnd = Math.hypot(existingSub.end.x - coord.x, existingSub.end.y - coord.y);
        this.motorwayStartCoord =
          dStart < dEnd ? { ...existingSub.end } : { ...existingSub.start };
        this.roadNetwork.removeSubway(existingSub.id);
        this.updateHUD();
        return;
      }
      if (this.roadNetwork.subwaysRemaining <= 0) {
        this.showToast('No Subway lines remaining! Click an existing Subway station to move it.');
        return;
      }
      const tile = this.roadNetwork.getTileType(coord.x, coord.y);
      if (tile === 'water') {
        this.showToast('⚠️ Subway station cannot be placed in water!');
        return;
      }
      if (tile === 'mountain') {
        this.showToast('⚠️ Subway station cannot be placed on steep mountain peaks!');
        return;
      }
      if (this.level.isOccupied(coord.x, coord.y)) {
        this.showToast('⚠️ Subway station entrance cannot overlap existing buildings!');
        return;
      }
      this.motorwayStartCoord = coord;
      return;
    }

    if (this.currentTool === 'blueprint') {
      if (e.button === 2) {
        this.roadNetwork.removeBlueprintRoad(coord.x, coord.y);
      } else {
        this.roadNetwork.placeBlueprintRoad(coord.x, coord.y, (x, y) => this.level.isOccupied(x, y));
      }
      this.updateHUD();
      return;
    }

    // Also allow grabbing a motorway endpoint directly in draw mode if clicking right on its ramp with Shift
    const nearMotorwayEndpoint = this.roadNetwork.motorways.find(
      (m) =>
        (m.start.x === coord.x && m.start.y === coord.y) ||
        (m.end.x === coord.x && m.end.y === coord.y)
    );
    if (nearMotorwayEndpoint && e.shiftKey) {
      const isStart =
        nearMotorwayEndpoint.start.x === coord.x && nearMotorwayEndpoint.start.y === coord.y;
      this.motorwayStartCoord = isStart
        ? { ...nearMotorwayEndpoint.end }
        : { ...nearMotorwayEndpoint.start };
      this.roadNetwork.removeMotorway(nearMotorwayEndpoint.id);
      this.setTool('motorway');
      this.updateHUD();
      return;
    }

    this.roadNetwork.placeRoad(coord.x, coord.y, (x, y) => this.level.isOccupied(x, y));
    this.updateHUD();
  }

  private onPointerMove(e: PointerEvent) {
    if (e.pointerType === 'touch' && this.activeTouchPointers.has(e.pointerId)) {
      this.activeTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activeTouchPointers.size >= 2) {
        const pts = Array.from(this.activeTouchPointers.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const midX = (pts[0].x + pts[1].x) * 0.5;
        const midY = (pts[0].y + pts[1].y) * 0.5;

        if (this.lastPinchDist > 8 && dist > 8) {
          const factor = dist / this.lastPinchDist;
          this.renderer.zoomAt(factor, midX, midY);
        }
        const panDx = midX - this.lastPinchMid.x;
        const panDy = midY - this.lastPinchMid.y;
        if (Math.abs(panDx) > 0.2 || Math.abs(panDy) > 0.2) {
          this.renderer.panBy(panDx, panDy);
        }

        this.lastPinchDist = dist;
        this.lastPinchMid = { x: midX, y: midY };
        this.updateHUD();
        return;
      }
    }

    if (this.isPanningCamera) {
      const dx = e.clientX - this.lastPanScreen.x;
      const dy = e.clientY - this.lastPanScreen.y;
      this.lastPanScreen = { x: e.clientX, y: e.clientY };
      this.renderer.panBy(dx, dy);
      return;
    }

    const coord = this.renderer.screenToGrid(e.clientX, e.clientY);
    this.hoverCoord = coord;

    if (!this.isPointerDown || !this.lastDragCoord) return;
    if (
      this.currentTool === 'motorway' ||
      this.currentTool === 'subway' ||
      this.currentTool === 'roundabout' ||
      this.currentTool === 'traffic_light'
    ) {
      return;
    }

    if (this.currentTool === 'blueprint') {
      if (coord.x !== this.lastDragCoord.x || coord.y !== this.lastDragCoord.y) {
        if (this.activePointerButton === 2) {
          this.roadNetwork.eraseBlueprintLine(this.lastDragCoord, coord);
        } else {
          this.roadNetwork.drawBlueprintLine(this.lastDragCoord, coord, (x, y) =>
            this.level.isOccupied(x, y)
          );
        }
        this.lastDragCoord = coord;
        this.dragPath.push(coord);
        this.updateHUD();
      }
      return;
    }

    const isErase = this.activePointerButton === 2 || this.currentTool === 'erase';

    if (coord.x !== this.lastDragCoord.x || coord.y !== this.lastDragCoord.y) {
      if (isErase) {
        this.roadNetwork.eraseLineOfRoads(this.lastDragCoord, coord, (x, y) =>
          this.traffic.isCarOnTile(x, y)
        );
      } else {
        this.roadNetwork.drawLineOfRoads(this.lastDragCoord, coord, (x, y) =>
          this.level.isOccupied(x, y)
        );
      }
      this.lastDragCoord = coord;
      this.dragPath.push(coord);
      this.updateHUD();
    }
  }

  private onPointerUp(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      const wasMultiTouch = this.activeTouchPointers.size >= 2;
      this.activeTouchPointers.delete(e.pointerId);
      if (wasMultiTouch) {
        if (this.activeTouchPointers.size < 2) {
          this.lastPinchDist = 0;
        }
        return;
      }
    }

    if (this.isPanningCamera) {
      this.isPanningCamera = false;
      return;
    }
    this.isPointerDown = false;

    if (this.currentTool === 'motorway' && this.motorwayStartCoord && this.hoverCoord) {
      const dist = Math.hypot(
        this.hoverCoord.x - this.motorwayStartCoord.x,
        this.hoverCoord.y - this.motorwayStartCoord.y
      );

      if (dist >= 3) {
        const created = this.roadNetwork.placeMotorway(
          this.motorwayStartCoord,
          this.hoverCoord
        );
        if (created) {
          this.roadNetwork.placeRoad(
            this.motorwayStartCoord.x,
            this.motorwayStartCoord.y,
            (x, y) => this.level.isOccupied(x, y),
            true
          );
          this.roadNetwork.placeRoad(
            this.hoverCoord.x,
            this.hoverCoord.y,
            (x, y) => this.level.isOccupied(x, y),
            true
          );
          this.showToast(`Motorway M${created.number} connected!`);
          this.setTool('draw');
        }
      } else {
        this.showToast('Drag a longer distance to place a Motorway.');
      }
      this.motorwayStartCoord = null;
    } else if (this.currentTool === 'subway' && this.motorwayStartCoord && this.hoverCoord) {
      const dist = Math.hypot(
        this.hoverCoord.x - this.motorwayStartCoord.x,
        this.hoverCoord.y - this.motorwayStartCoord.y
      );

      if (dist >= 3) {
        const startTile = this.roadNetwork.getTileType(this.motorwayStartCoord.x, this.motorwayStartCoord.y);
        const endTile = this.roadNetwork.getTileType(this.hoverCoord.x, this.hoverCoord.y);
        const startOccupied = this.level.isOccupied(this.motorwayStartCoord.x, this.motorwayStartCoord.y);
        const endOccupied = this.level.isOccupied(this.hoverCoord.x, this.hoverCoord.y);

        if (startTile === 'water' || endTile === 'water') {
          this.showToast('⚠️ Subway station entrance cannot be placed in water!');
        } else if (startTile === 'mountain' || endTile === 'mountain') {
          this.showToast('⚠️ Subway station entrance cannot be carved into high mountain peaks!');
        } else if (startOccupied || endOccupied) {
          this.showToast('⚠️ Subway station entrance cannot overlap existing buildings!');
        } else {
          const created = this.roadNetwork.placeSubway(
            this.motorwayStartCoord,
            this.hoverCoord
          );
          if (created) {
            this.showToast(`Subway Line S${created.number} opened! Automated metro shuttle active.`);
            this.setTool('draw');
          }
        }
      } else {
        this.showToast('Drag a longer distance (at least 3 tiles) to place a Subway Line.');
      }
      this.motorwayStartCoord = null;
    }

    this.lastDragCoord = null;
    this.dragPath = [];
    sound.resetDrawStep();
    this.updateHUD();
  }

  public updateHUD() {
    this.scoreEl.innerText = `${this.level.score}`;
    this.dayEl.innerText = this.level.getDayOfWeekName();
    this.weekEl.innerText = `WK ${this.level.getWeekNumber()}`;
    const progress = this.level.getDayProgress();
    this.dayProgressFillEl.style.width = `${progress * 100}%`;
    this.clockHandEl.style.transform = `rotate(${progress * 360}deg)`;

    this.roadsCountEl.innerText = `${this.roadNetwork.roadsRemaining}`;
    this.bridgesCountEl.innerText = `${this.roadNetwork.bridgesRemaining}`;
    this.tunnelsCountEl.innerText = `${this.roadNetwork.tunnelsRemaining}`;
    this.roundaboutsCountEl.innerText = `${this.roadNetwork.roundaboutsRemaining}`;
    this.lightsCountEl.innerText = `${this.roadNetwork.trafficLightsRemaining}`;
    this.motorwaysCountEl.innerText = `${this.roadNetwork.motorwaysRemaining}`;
    this.subwaysCountEl.innerText = `${this.roadNetwork.subwaysRemaining}`;
    this.blueprintCountBadge.innerText = `${this.roadNetwork.blueprintRoads.size}`;

    // Sync Live Solar, Season/Weather & Architectural Style HUD Badges
    const solarIconEl = document.getElementById('solar-icon');
    const solarLabelEl = document.getElementById('solar-label');
    if (solarIconEl && solarLabelEl) {
      const lm = this.renderer.env.lightingMode;
      solarIconEl.innerText = this.renderer.env.solar.phaseIcon;
      solarLabelEl.innerText =
        lm === 'auto' ? this.renderer.env.solar.phaseLabel : lm.charAt(0).toUpperCase() + lm.slice(1);
    }

    const weatherIconEl = document.getElementById('weather-icon');
    const weatherLabelEl = document.getElementById('weather-label');
    if (weatherIconEl && weatherLabelEl) {
      const effSeason = this.renderer.env.getEffectiveSeason();
      const effWeather = this.renderer.env.getEffectiveWeather();
      const seasonIcons: Record<string, string> = {
        spring: '🌸',
        summer: '☀️',
        autumn: '🍂',
        winter: '❄️',
      };
      const weatherIcons: Record<string, string> = {
        clear: seasonIcons[effSeason] || '☀️',
        rain: '🌧️',
        mist: '🌫️',
        snow: '❄️',
        blossoms: '🌸',
        leaves: '🍂',
      };
      weatherIconEl.innerText = weatherIcons[effWeather] || '🌸';
      weatherLabelEl.innerText = effSeason.charAt(0).toUpperCase() + effSeason.slice(1);
    }

    const styleIconEl = document.getElementById('art-style-icon');
    const styleLabelEl = document.getElementById('art-style-label');
    if (styleIconEl && styleLabelEl) {
      const st = this.renderer.artStyle;
      styleIconEl.innerText = st === 'clay' ? '🧸' : st === 'modern' ? '🏢' : '🏠';
      styleLabelEl.innerText = st === 'clay' ? 'Clay' : st === 'modern' ? 'Modern' : 'Diorama';
    }

    const artIconEl = document.getElementById('arterial-icon');
    const artLabelEl = document.getElementById('arterial-label');
    const artBtnEl = document.getElementById('btn-arterial');
    if (artIconEl && artLabelEl && artBtnEl) {
      const lvl = this.roadNetwork.arterialLevel;
      artIconEl.innerText = lvl >= 3 ? '🚀' : lvl >= 1 ? '⚡' : '🛣️';
      const boostPct = lvl === 0 ? 0 : 5 + Math.min(4, lvl) * 15;
      artLabelEl.innerText = lvl > 0 ? `Arterial Lv.${lvl} (+${boostPct}%)` : 'Boost Roads (15)';
      artBtnEl.classList.toggle('active', lvl > 0);
    }

    const isSymphony = this.level.gameMode === 'symphony';
    this.calendarPill.classList.toggle('hidden', isSymphony);
    this.zenPill.classList.toggle('hidden', this.level.gameMode !== 'zen');
    this.symphonyPill.classList.toggle('hidden', !isSymphony);

    if (isSymphony) {
      const cityTime = this.level.getCityTime24();
      const stats = this.level.symphonyFlowStats;
      const dayDisplay = `${this.level.getDayOfWeekName()} WK ${this.level.getWeekNumber()}`;
      const dayEl = document.getElementById('symphony-day');
      if (dayEl) dayEl.innerText = dayDisplay;
      this.symphonyClockEl.innerText = cityTime.timeString;
      this.symphonyPhaseEl.innerText = `${cityTime.phaseIcon} ${cityTime.phaseTitle.toUpperCase()}`;
      this.symphonyFlowLabelEl.innerText = `${stats.flowPercentage}% Flow (${stats.rank})`;
      this.symphonyFlowBarEl.style.width = `${stats.flowPercentage}%`;
      this.symphonyMultiplierEl.innerText = `${stats.harmonicMultiplier.toFixed(1)}x`;

      const upcoming = this.level.upcomingRhythmEvent;
      if (upcoming) {
        const evDecHour = upcoming.hour + upcoming.minute / 60;
        const currentDecHour = (6 + this.level.getDayProgress() * 24) % 24;
        let diff = evDecHour - currentDecHour;
        if (diff < -0.1) diff += 24;
        const secondsUntil = (diff / 24) * this.level.getDayDurationSeconds();

        if (secondsUntil <= 6.5) {
          this.timetableTicker.classList.remove('hidden');
          const isAlert = secondsUntil <= upcoming.advanceNoticeLead;
          this.timetableTicker.classList.toggle('advance-alert', isAlert);
          this.tickerTextEl.innerText = `${upcoming.icon} Upcoming: ${upcoming.title} (${upcoming.hour.toString().padStart(2, '0')}:${upcoming.minute.toString().padStart(2, '0')})`;
        } else {
          this.timetableTicker.classList.add('hidden');
        }
      } else {
        this.timetableTicker.classList.add('hidden');
      }
    } else {
      this.timetableTicker.classList.add('hidden');
    }

    const bpCount = this.roadNetwork.blueprintRoads.size;
    if (bpCount > 0 || this.currentTool === 'blueprint') {
      this.blueprintBar.classList.remove('hidden');
      const cost = this.roadNetwork.getBlueprintCost();
      let detail = `${cost.roads} road${cost.roads !== 1 ? 's' : ''}`;
      if (cost.bridges > 0) detail += `, ${cost.bridges} bridge${cost.bridges !== 1 ? 's' : ''}`;
      if (cost.tunnels > 0) detail += `, ${cost.tunnels} tunnel${cost.tunnels !== 1 ? 's' : ''}`;
      this.blueprintCostText.innerText = `${detail} drafted (Have ${this.roadNetwork.roadsRemaining} roads)`;
    } else {
      this.blueprintBar.classList.add('hidden');
    }
  }

  private showToast(msg: string) {
    if (this.toastQueue.length > 0 && this.toastQueue[this.toastQueue.length - 1] === msg) return;
    this.toastQueue.push(msg);
    if (!this.isShowingToast) {
      this.processNextToast();
    }
  }

  private processNextToast() {
    if (this.toastQueue.length === 0) {
      this.isShowingToast = false;
      this.toastEl.classList.add('hidden');
      return;
    }

    this.isShowingToast = true;
    const msg = this.toastQueue.shift()!;
    this.toastEl.innerText = msg;
    this.toastEl.classList.remove('hidden');

    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
    this.toastTimeout = window.setTimeout(() => {
      this.toastEl.classList.add('hidden');
      window.setTimeout(() => {
        this.processNextToast();
      }, 200);
    }, 2800);
  }

  private showUpgradeModal(options: UpgradeOption[]) {
    this.upgradeOptionsContainer.innerHTML = '';

    const badgeIcons: Record<UpgradeOption['iconType'], string> = {
      motorway: 'M1',
      subway: '🚇',
      tunnel: '⛰️',
      roundabout: '🔄',
      bridge: '🌉',
      traffic_light: '🚦',
      roads: '🛣️',
    };

    options.forEach((opt) => {
      const card = document.createElement('div');
      card.className = 'upgrade-card';
      card.innerHTML = `
        <div class="upgrade-icon-badge">${badgeIcons[opt.iconType]}</div>
        <div class="upgrade-title">${opt.title}</div>
        <div class="upgrade-desc">${opt.subtitle}</div>
      `;

      card.addEventListener('click', () => {
        this.roadNetwork.roadsRemaining += opt.roadsAmount;
        if (opt.id === 'bundle_subway') {
          this.roadNetwork.subwaysRemaining += 1;
          this.roadNetwork.tunnelsRemaining += 1;
        } else if (opt.id === 'bundle_motorway') {
          this.roadNetwork.motorwaysRemaining += 1;
          this.roadNetwork.bridgesRemaining += 1;
        } else if (opt.id === 'bundle_tunnel') {
          this.roadNetwork.tunnelsRemaining += 2;
          this.roadNetwork.bridgesRemaining += 1;
        } else if (opt.id === 'bundle_roundabout') {
          this.roadNetwork.roundaboutsRemaining += 1;
          this.roadNetwork.trafficLightsRemaining += 2;
        } else if (opt.id === 'bundle_bridge_lights') {
          this.roadNetwork.bridgesRemaining += 2;
          this.roadNetwork.trafficLightsRemaining += 2;
        } else if (opt.id === 'bundle_arterial_expansion') {
          this.roadNetwork.bridgesRemaining += 1;
          this.upgradeArterialBoost(true);
        }
        this.upgradeModal.classList.add('hidden');
        this.level.completeUpgrade();
        this.updateHUD();
      });

      this.upgradeOptionsContainer.appendChild(card);
    });

    this.upgradeModal.classList.remove('hidden');
  }

  private showGameOver() {
    this.finalScoreEl.innerText = `${this.level.score}`;
    this.finalDaysEl.innerText = `${this.level.currentDay}`;
    const descEl = document.getElementById('game-over-desc');
    if (descEl && this.level.failureReason) {
      descEl.innerText = this.level.failureReason;
    }
    this.recordBestScore();
    this.gameOverModal.classList.remove('hidden');
    // Highlight bottleneck heatmap on game over so players see where the city choked
    this.renderer.showHeatmap = true;
    document.querySelectorAll('.btn-heatmap-toggle').forEach((btn) => btn.classList.add('active'));
  }

  private toggleHeatmap() {
    this.renderer.showHeatmap = !this.renderer.showHeatmap;
    sound.triggerHaptic('light');
    const active = this.renderer.showHeatmap;
    document.querySelectorAll('.btn-heatmap-toggle').forEach((btn) => {
      btn.classList.toggle('active', active);
    });
    this.showToast(active ? '🔥 Bottleneck Heatmap ON — showing vehicle delays' : 'Bottleneck Heatmap OFF');
  }

  private showPostcardModal() {
    const mapName = MiniMotorwaysGame.MAP_NAMES[this.currentMapId] || 'River Valley';
    this.currentPostcardUrl = this.renderer.generatePostcard(
      mapName,
      this.level.score,
      this.level.currentDay
    );
    this.postcardImg.src = this.currentPostcardUrl;
    this.postcardModal.classList.remove('hidden');
    sound.triggerHaptic('medium');
  }

  private closePostcardModal() {
    this.postcardModal.classList.add('hidden');
  }

  private async copyPostcard() {
    sound.triggerHaptic('light');
    try {
      const res = await fetch(this.currentPostcardUrl);
      const blob = await res.blob();
      if (navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);
        this.showToast('📋 Postcard copied to clipboard!');
        return;
      }
    } catch {
      // Fallback
    }
    this.downloadPostcard();
  }

  private downloadPostcard() {
    sound.triggerHaptic('light');
    const a = document.createElement('a');
    a.href = this.currentPostcardUrl;
    a.download = `traffic-nirvana-${this.currentMapId}-score${this.level.score}.png`;
    a.click();
    this.showToast('💾 Postcard saved to downloads!');
  }

  private restartGame(announce: boolean = true) {
    const keepNight = this.renderer.isNightMode;
    const keepArtStyle = this.renderer.artStyle;
    const keepLightingMode = this.renderer.env.lightingMode;
    const keepSeason = this.renderer.env.seasonOverride;
    const keepWeather = this.renderer.env.weatherOverride;
    this.gameOverModal.classList.add('hidden');
    this.upgradeModal.classList.add('hidden');
    this.closePostcardModal();
    this.renderer.showHeatmap = false;
    document.querySelectorAll('.btn-heatmap-toggle').forEach((btn) => btn.classList.remove('active'));

    this.roadNetwork = new RoadNetwork(this.currentMapId);
    this.level = new LevelProgression(
      (options) => this.showUpgradeModal(options),
      () => this.showGameOver(),
      (msg) => this.showToast(msg),
      (bx, by, bw, bh) => {
        for (let dy = 0; dy < bh; dy++) {
          for (let dx = 0; dx < bw; dx++) {
            this.roadNetwork.clearTreesNear(bx + dx, by + dy, 0.9);
          }
        }
      },
      (x, y) => this.roadNetwork.getTileType(x, y) === 'grass' && !this.roadNetwork.hasRoad(x, y),
      {
        getRailRow: () => this.roadNetwork.railRow,
        getStationTileX: () => this.roadNetwork.stationTileX,
        setStationTileX: (x) => {
          this.roadNetwork.stationTileX = x;
        },
      }
    );
    this.roadNetwork.defaultOccupiedCheck = (x, y) => this.level.isOccupied(x, y);
    (window as any).game = this;
    this.level.gameMode = this.selectedGameMode;
    this.level.difficultyMode = this.selectedDifficulty;
    this.calendarPill.classList.toggle('hidden', this.selectedGameMode === 'symphony');
    this.zenPill.classList.toggle('hidden', this.selectedGameMode !== 'zen');
    this.symphonyPill.classList.toggle('hidden', this.selectedGameMode !== 'symphony');
    this.diffPill.classList.toggle('hidden', this.selectedDifficulty !== 'rush_hour');
    if (this.selectedGameMode === 'zen') {
      this.roadNetwork.roadsRemaining += 20;
    }
    this.roadNetwork.onTrainStationArrival = () => this.level.triggerTrainStationRush();
    this.roadNetwork.onTrainApproaching = () => this.level.triggerTrainApproachingNotice();
    this.roadNetwork.getTrainCarCount = () => this.level.getTrainCarCount();
    this.level.onGrantBonusRoads = (count: number) => {
      this.roadNetwork.roadsRemaining += count;
      this.updateHUD();
    };
    this.level.onDispatchSurfaceTrain = () => {
      if (!this.roadNetwork.surfaceTrain.active) {
        this.roadNetwork.surfaceTrain.active = true;
        this.roadNetwork.surfaceTrain.distance = 0;
        this.roadNetwork.surfaceTrain.hasStoppedThisRun = false;
        this.roadNetwork.surfaceTrain.stationStopTimer = 0;
      }
    };
    this.traffic = new TrafficSimulation(
      this.roadNetwork,
      () => this.level.houses,
      () => this.level.destinations,
      (points) => {
        this.level.score += points;
        this.updateHUD();
      }
    );
    this.traffic.getGameMode = () => this.level.gameMode;
    this.traffic.getHarmonicMultiplier = () => this.level.symphonyFlowStats.harmonicMultiplier;
    this.traffic.onUpdateFlowStats = (ratio, active, stalled, dt) => {
      this.level.updateSymphonyFlow(ratio, active, stalled, dt);
    };
    this.renderer = new GameRenderer(
      this.canvas,
      this.roadNetwork,
      this.traffic,
      this.level
    );
    this.renderer.isNightMode = keepNight;
    this.renderer.artStyle = keepArtStyle;
    this.renderer.env.lightingMode = keepLightingMode;
    this.renderer.env.seasonOverride = keepSeason;
    this.renderer.env.weatherOverride = keepWeather;

    this.renderer.resize();
    this.updateHUD();
    this.setTool('draw');
    if (announce) {
      this.setSpeed(1);
      this.showToast(`Started new city in ${MiniMotorwaysGame.MAP_NAMES[this.currentMapId]}!`);
    }
  }

  private gameLoop(time: number) {
    const dt = Math.min(0.1, (time - this.lastTime) / 1000);
    this.lastTime = time;

    this.level.update(dt);
    if (!this.level.isPaused && !this.level.gameOver && !this.level.upgradePending) {
      const totalScaledDt = dt * this.level.gameSpeed;
      const steps = this.level.gameSpeed > 2 ? 2 : 1;
      const stepDt = totalScaledDt / steps;
      for (let s = 0; s < steps; s++) {
        this.roadNetwork.update(stepDt, (x, y) => this.traffic.getTrafficQueueAtIntersection(x, y));
        this.traffic.update(stepDt);
      }
    }

    this.updateHUD();

    this.renderer.render(
      this.hoverCoord,
      this.currentTool,
      this.dragPath,
      this.motorwayStartCoord
    );

    requestAnimationFrame((t) => this.gameLoop(t));
  }
}

declare global {
  interface Window {
    __game?: MiniMotorwaysGame;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const game = new MiniMotorwaysGame();
  window.__game = game;
  const params = new URLSearchParams(window.location.search);
  if (params.has('testFeatures')) {
    game.startFromMenu();
    // Build test intersection with road, smart traffic light, ghost demolition, and congestion
    for (let x = 8; x <= 16; x++) {
      game.roadNetwork.placeRoad(x, 11);
    }
    for (let y = 8; y <= 14; y++) {
      game.roadNetwork.placeRoad(12, y);
    }
    // Place smart traffic light at intersection (12, 11)
    game.roadNetwork.toggleTrafficLight(12, 11);
    // Mark road (10, 11) as in ghost demolition queue
    const demoRoad = game.roadNetwork.getRoad(10, 11);
    if (demoRoad) demoRoad.isDemolishing = true;
    // Set heavy congestion delay on intersection (12, 11) to showcase Bottleneck Heatmap
    const congRoad = game.roadNetwork.getRoad(12, 11);
    if (congRoad) congRoad.congestionAccum = 12.0;
    const congRoad2 = game.roadNetwork.getRoad(13, 11);
    if (congRoad2) congRoad2.congestionAccum = 6.5;

    game.renderer.showHeatmap = true;
    game.level.isPaused = true;
    if (params.has('night')) {
      game.renderer.isNightMode = true;
    }
    if (params.has('postcard')) {
      (game as any).showPostcardModal();
    }
  } else if (params.has('testTrain')) {
    game.startFromMenu();
    game.level.currentDay = 16; // Week 3 -> 4 cars
    game.roadNetwork.surfaceTrain.active = true;
    game.roadNetwork.surfaceTrain.distance = 15.5;
    game.level.isPaused = true;
    if (params.has('night')) {
      game.renderer.isNightMode = true;
    }
    (game as any).updateHUD();
  } else if (params.has('testBlueprint')) {
    game.startFromMenu();
    for (let x = 8; x <= 12; x++) {
      game.roadNetwork.placeRoad(x, 8);
    }
    game.roadNetwork.placeBlueprintRoad(13, 8);
    game.roadNetwork.placeBlueprintRoad(14, 8);
    game.roadNetwork.placeBlueprintRoad(15, 9);
    game.roadNetwork.placeBlueprintRoad(15, 10);
    game.roadNetwork.placeBlueprintRoad(16, 11);
    game.roadNetwork.placeBlueprintRoad(17, 11);
    game.roadNetwork.placeBlueprintRoad(18, 11);
    game.roadNetwork.placeBlueprintRoad(19, 10);
    (game as any).setTool('blueprint');
    game.level.isPaused = true;
    (game as any).updateHUD();
  } else if (params.has('testZen')) {
    (game as any).selectedGameMode = 'zen';
    game.startFromMenu();
    game.level.isPaused = true;
    (game as any).updateHUD();
  } else if (params.has('testSymphony')) {
    (game as any).selectedGameMode = 'symphony';
    game.startFromMenu();
    game.level.gameMode = 'symphony';
    game.level.dayTimer = 2.5; // ~08:30 AM Morning Commute
    game.level.symphonyFlowStats = {
      flowPercentage: 94,
      activeVehicles: 12,
      stalledVehicles: 1,
      flowStreak: 14.5,
      harmonicMultiplier: 2.8,
      rank: 'S',
    };
    game.level.upcomingRhythmEvent = game.level.getDailyRhythmSchedule()[1];
    game.level.isPaused = true;
    (game as any).updateHUD();
  }
});
