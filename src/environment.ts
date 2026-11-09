import { CONFIG } from './config';
import { mix } from './buildingArt';

export interface GridBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';
export type WeatherId = 'clear' | 'rain' | 'mist' | 'snow' | 'blossoms' | 'leaves';
export type LightingMode = 'auto' | 'day' | 'dusk' | 'night';

export interface SolarState {
  /** 0..24 hour clock */
  hour: number;
  /** Label for HUD (e.g. 'Dawn', 'Morning', 'Midday', 'Dusk', 'Night') */
  phaseLabel: string;
  /** Icon for HUD */
  phaseIcon: string;
  /** 0 = full day, 1 = full night (smoothly interpolated across dawn/dusk) */
  nightFactor: number;
  /** 0..1 peak at dawn (05:00-07:45) and dusk (17:15-20:15) */
  goldenHourFactor: number;
  /** true when dawn rather than dusk */
  isDawn: boolean;
  /** Shadow X offset per unit of building height */
  shadowDx: number;
  /** Shadow Y offset per unit of building height */
  shadowDy: number;
  /** Overall shadow opacity multiplier */
  shadowAlpha: number;
  /** Warm/cool directional sunlight tint color */
  sunTint: string;
  /** Strength of directional sun tint (0..1) */
  sunTintStrength: number;
}

export interface SeasonPalette {
  id: SeasonId;
  label: string;
  icon: string;
  dayBackground: string;
  nightBackground: string;
  dayWater: string;
  dayWaterDeep: string;
  dayWaterShore: string;
  dayWaterBank: string;
  nightWater: string;
  dayHillContours: [string, string, string];
  nightHillContours: [string, string, string];
  dayTreeShades: [string, string, string, string];
  nightTreeShades: [string, string, string, string];
  snowCover: number; // 0..1
  chimneySmokeIntensity: number; // 0..1
}

export const SEASON_PALETTES: Record<SeasonId, SeasonPalette> = {
  spring: {
    id: 'spring',
    label: 'Spring',
    icon: '🌸',
    dayBackground: '#F2EFE6',
    nightBackground: '#181D27',
    dayWater: '#76C7E0',
    dayWaterDeep: '#5EB8D4',
    dayWaterShore: '#DCE8DC',
    dayWaterBank: '#B4DFEC',
    nightWater: '#113247',
    dayHillContours: ['#E6E3D6', '#DCE2D0', '#CFDAC0'],
    nightHillContours: ['#1E2532', '#232C3B', '#283345'],
    dayTreeShades: ['#74C69D', '#F783AC', '#62965A', '#FAA2C1'], // Lush greens + cherry blossom pink!
    nightTreeShades: ['#234233', '#4A2538', '#2A4D3C', '#3F2232'],
    snowCover: 0,
    chimneySmokeIntensity: 0.25,
  },
  summer: {
    id: 'summer',
    label: 'Summer',
    icon: '☀️',
    dayBackground: '#F0ECE1',
    nightBackground: '#171C26',
    dayWater: '#5BC0BE',
    dayWaterDeep: '#45A29E',
    dayWaterShore: '#E2E4D5',
    dayWaterBank: '#A8E0DF',
    nightWater: '#113044',
    dayHillContours: ['#E5DFD0', '#D7DFC6', '#C6D4B3'],
    nightHillContours: ['#1E2532', '#232C3B', '#283345'],
    dayTreeShades: ['#52B788', '#40916C', '#2D6A4F', '#74C69D'],
    nightTreeShades: ['#1E3B2D', '#183024', '#244736', '#2B5440'],
    snowCover: 0,
    chimneySmokeIntensity: 0.0,
  },
  autumn: {
    id: 'autumn',
    label: 'Autumn',
    icon: '🍂',
    dayBackground: '#EFE7DA',
    nightBackground: '#1A1B25',
    dayWater: '#5C9EAD',
    dayWaterDeep: '#478494',
    dayWaterShore: '#E3D7C5',
    dayWaterBank: '#A5C9D4',
    nightWater: '#122A3A',
    dayHillContours: ['#E6DAC8', '#DCC9B2', '#D0B89C'],
    nightHillContours: ['#21202D', '#272636', '#2E2D40'],
    dayTreeShades: ['#E07A5F', '#F4A261', '#D62828', '#E9C46A'], // Terracotta, amber, crimson, gold
    nightTreeShades: ['#4A251D', '#52361E', '#42161A', '#4D3F1E'],
    snowCover: 0,
    chimneySmokeIntensity: 0.65,
  },
  winter: {
    id: 'winter',
    label: 'Winter',
    icon: '❄️',
    dayBackground: '#EDF2F7',
    nightBackground: '#141B29',
    dayWater: '#669BBC',
    dayWaterDeep: '#5082A3',
    dayWaterShore: '#E2E8F0',
    dayWaterBank: '#BFD7EA',
    nightWater: '#0F2537',
    dayHillContours: ['#E2E8F0', '#D5DFEB', '#C6D4E3'],
    nightHillContours: ['#1B2436', '#212B40', '#28344C'],
    dayTreeShades: ['#5C8D76', '#A8DADC', '#6B9080', '#CBD5E1'], // Frosted pine & snow-tipped evergreens
    nightTreeShades: ['#1D3228', '#2C424E', '#23382D', '#334155'],
    snowCover: 0.85,
    chimneySmokeIntensity: 1.0,
  },
};

const SEASON_ORDER: SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];

interface WeatherParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
  spin: number;
  color: string;
}

interface WaterRipple {
  x: number;
  y: number;
  age: number;
  maxAge: number;
  maxRadius: number;
}

const WORLD_WIDTH = CONFIG.GRID_COLS * CONFIG.TILE_SIZE;
const WORLD_HEIGHT = CONFIG.GRID_ROWS * CONFIG.TILE_SIZE;

export class EnvironmentSystem {
  public lightingMode: LightingMode = 'auto';
  public seasonOverride: SeasonId | 'auto' = 'auto';
  public weatherOverride: WeatherId | 'auto' = 'auto';

  private currentHour: number = 9.5;
  private currentSeason: SeasonId = 'spring';
  private targetSeason: SeasonId = 'spring';
  private seasonBlend: number = 1;

  private activeWeather: WeatherId = 'clear';
  private weatherIntensity: number = 0;
  private targetWeatherIntensity: number = 0;
  private windTime: number = 0;
  public windStrength: number = 0.25;

  private particles: WeatherParticle[] = [];
  private ripples: WaterRipple[] = [];
  private weatherChangeTimer: number = 6;

  public solar: SolarState = {
    hour: 9.5,
    phaseLabel: 'Morning',
    phaseIcon: '🌤️',
    nightFactor: 0,
    goldenHourFactor: 0,
    isDawn: false,
    shadowDx: 0.42,
    shadowDy: 0.26,
    shadowAlpha: 1,
    sunTint: '#FFFBEB',
    sunTintStrength: 0,
  };

  constructor() {
    this.initParticles(120);
  }

  private initParticles(count: number) {
    this.particles = [];
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT,
        vx: 0,
        vy: 40,
        size: 3,
        alpha: 0.5,
        phase: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 3,
        color: '#FFFFFF',
      });
    }
  }

  public cycleLightingMode(): LightingMode {
    const order: LightingMode[] = ['auto', 'day', 'dusk', 'night'];
    const nextIdx = (order.indexOf(this.lightingMode) + 1) % order.length;
    this.lightingMode = order[nextIdx];
    return this.lightingMode;
  }

  public cycleSeasonAndWeather(): { season: SeasonId | 'auto'; weather: WeatherId | 'auto'; label: string; icon: string } {
    const presets: Array<{ s: SeasonId | 'auto'; w: WeatherId | 'auto'; label: string; icon: string }> = [
      { s: 'auto', w: 'auto', label: 'Auto Seasons', icon: '🌍' },
      { s: 'spring', w: 'blossoms', label: 'Spring Blossoms', icon: '🌸' },
      { s: 'summer', w: 'clear', label: 'Summer Sun', icon: '☀️' },
      { s: 'summer', w: 'rain', label: 'Summer Rain', icon: '🌧️' },
      { s: 'autumn', w: 'leaves', label: 'Autumn Leaves', icon: '🍂' },
      { s: 'winter', w: 'snow', label: 'Winter Snow', icon: '❄️' },
      { s: 'spring', w: 'mist', label: 'Valley Mist', icon: '🌫️' },
    ];
    const curIdx = presets.findIndex(
      (o) => o.s === this.seasonOverride && o.w === this.weatherOverride
    );
    const next = presets[(curIdx + 1) % presets.length];
    this.seasonOverride = next.s;
    this.weatherOverride = next.w;
    if (next.w !== 'auto') {
      this.activeWeather = next.w;
      this.targetWeatherIntensity = next.w === 'clear' ? 0 : 0.9;
      this.weatherIntensity = next.w === 'clear' ? 0 : 0.65;
    }
    return { season: this.seasonOverride, weather: this.weatherOverride, label: next.label, icon: next.icon };
  }

  public getEffectiveSeason(): SeasonId {
    return this.seasonOverride === 'auto' ? this.targetSeason : this.seasonOverride;
  }

  public getEffectiveWeather(): WeatherId {
    return this.weatherOverride === 'auto' ? this.activeWeather : this.weatherOverride;
  }

  public update(
    dt: number,
    dayProgress: number,
    weekNumber: number,
    symphonyHour?: number | null
  ) {
    this.windTime += dt;

    // 1. Determine Season from week number (1 week per season in auto mode)
    if (this.seasonOverride === 'auto') {
      const idx = Math.max(0, weekNumber - 1) % SEASON_ORDER.length;
      const desired = SEASON_ORDER[idx];
      if (desired !== this.targetSeason) {
        this.currentSeason = this.targetSeason;
        this.targetSeason = desired;
        this.seasonBlend = 0;
      }
      this.seasonBlend = Math.min(1, this.seasonBlend + dt * 0.25);
    } else {
      this.currentSeason = this.seasonOverride;
      this.targetSeason = this.seasonOverride;
      this.seasonBlend = 1;
    }

    // 2. Determine Solar Hour (0..24)
    if (this.lightingMode === 'day') {
      this.currentHour = 11.0;
    } else if (this.lightingMode === 'dusk') {
      this.currentHour = 18.4;
    } else if (this.lightingMode === 'night') {
      this.currentHour = 23.0;
    } else {
      if (typeof symphonyHour === 'number') {
        this.currentHour = symphonyHour;
      } else {
        // Map each in-game day (0..1) smoothly through Dawn (06:00) -> Noon (12:00) -> Dusk (18:30) -> Night (22:30)
        this.currentHour = (5.8 + dayProgress * 24.0) % 24.0;
      }
    }

    this.computeSolarState(this.currentHour);

    // 3. Determine Weather
    const effSeason = this.getEffectiveSeason();
    if (this.weatherOverride !== 'auto') {
      this.activeWeather = this.weatherOverride;
      this.targetWeatherIntensity = this.activeWeather === 'clear' ? 0 : 0.9;
    } else {
      this.weatherChangeTimer -= dt;
      if (this.weatherChangeTimer <= 0) {
        this.weatherChangeTimer = 15 + Math.random() * 14;
        this.pickAutoWeather(effSeason, this.currentHour);
      }
    }

    const rampSpeed = 0.35;
    if (this.weatherIntensity < this.targetWeatherIntensity) {
      this.weatherIntensity = Math.min(
        this.targetWeatherIntensity,
        this.weatherIntensity + dt * rampSpeed
      );
    } else {
      this.weatherIntensity = Math.max(
        this.targetWeatherIntensity,
        this.weatherIntensity - dt * rampSpeed
      );
    }

    // 4. Wind modulation
    const baseWind =
      this.activeWeather === 'rain' || this.activeWeather === 'leaves' ? 0.95 : 0.35;
    this.windStrength =
      baseWind + Math.sin(this.windTime * 0.7) * 0.22 + Math.sin(this.windTime * 1.9) * 0.14;

    // 5. Update weather particles & ripples
    this.updateParticles(dt, effSeason);
  }

  private pickAutoWeather(season: SeasonId, hour: number) {
    if (hour >= 5.0 && hour <= 8.0 && Math.random() < 0.5) {
      this.activeWeather = 'mist';
      this.targetWeatherIntensity = 0.75;
      return;
    }
    const r = Math.random();
    if (season === 'spring') {
      if (r < 0.55) {
        this.activeWeather = 'blossoms';
        this.targetWeatherIntensity = 0.85;
      } else if (r < 0.78) {
        this.activeWeather = 'rain';
        this.targetWeatherIntensity = 0.75;
      } else {
        this.activeWeather = 'clear';
        this.targetWeatherIntensity = 0;
      }
    } else if (season === 'summer') {
      if (r < 0.32) {
        this.activeWeather = 'rain';
        this.targetWeatherIntensity = 0.85;
      } else {
        this.activeWeather = 'clear';
        this.targetWeatherIntensity = 0;
      }
    } else if (season === 'autumn') {
      if (r < 0.6) {
        this.activeWeather = 'leaves';
        this.targetWeatherIntensity = 0.88;
      } else if (r < 0.82) {
        this.activeWeather = 'rain';
        this.targetWeatherIntensity = 0.8;
      } else {
        this.activeWeather = 'mist';
        this.targetWeatherIntensity = 0.65;
      }
    } else {
      if (r < 0.75) {
        this.activeWeather = 'snow';
        this.targetWeatherIntensity = 0.9;
      } else {
        this.activeWeather = 'mist';
        this.targetWeatherIntensity = 0.6;
      }
    }
  }

  private computeSolarState(h: number) {
    let nightFactor = 0;
    let goldenHourFactor = 0;
    let isDawn = false;
    let phaseLabel = 'Daylight';
    let phaseIcon = '☀️';

    if (h >= 5.0 && h < 8.0) {
      const t = (h - 5.0) / 3.0;
      nightFactor = 1 - this.smoothstep(t);
      goldenHourFactor = Math.sin(t * Math.PI);
      isDawn = true;
      phaseLabel = 'Dawn';
      phaseIcon = '🌅';
    } else if (h >= 8.0 && h < 17.0) {
      nightFactor = 0;
      goldenHourFactor = 0;
      if (h < 11.0) {
        phaseLabel = 'Morning';
        phaseIcon = '🌤️';
      } else if (h < 14.5) {
        phaseLabel = 'Midday';
        phaseIcon = '☀️';
      } else {
        phaseLabel = 'Afternoon';
        phaseIcon = '☀️';
      }
    } else if (h >= 17.0 && h < 20.4) {
      const t = (h - 17.0) / 3.4;
      nightFactor = this.smoothstep(t);
      goldenHourFactor = Math.sin(t * Math.PI);
      isDawn = false;
      phaseLabel = 'Golden Dusk';
      phaseIcon = '🌇';
    } else {
      nightFactor = 1;
      goldenHourFactor = 0;
      phaseLabel = 'Night';
      phaseIcon = '🌙';
    }

    let shadowDx = 0.52;
    let shadowDy = 0.3;
    let shadowAlpha = 1.0;

    if (h >= 5.0 && h <= 20.4) {
      const dayNorm = (h - 5.0) / 15.4;
      const sunProgress = (dayNorm - 0.5) * 2; // -1 at Dawn (East sun -> West shadow), 0 at Noon, +1 at Dusk (West sun -> East shadow)
      shadowDx = 0.18 + sunProgress * 0.78;
      const altitude = Math.cos(sunProgress * (Math.PI * 0.44));
      shadowDy = 0.18 + (1 - altitude) * 0.34;
      shadowAlpha = 0.85 + goldenHourFactor * 0.28;
    } else {
      shadowDx = 0.45;
      shadowDy = 0.28;
      shadowAlpha = 0.68;
    }

    if (this.activeWeather === 'rain' || this.activeWeather === 'snow') {
      shadowAlpha *= 1 - this.weatherIntensity * 0.32;
    }

    const sunTint = isDawn ? '#FDBA74' : '#F59E0B';
    const sunTintStrength = goldenHourFactor * 0.38;

    this.solar = {
      hour: h,
      phaseLabel,
      phaseIcon,
      nightFactor,
      goldenHourFactor,
      isDawn,
      shadowDx,
      shadowDy,
      shadowAlpha,
      sunTint,
      sunTintStrength,
    };
  }

  private smoothstep(t: number): number {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
  }

  public getDynamicTheme(): typeof CONFIG.THEMES.day {
    const sA = SEASON_PALETTES[this.currentSeason];
    const sB = SEASON_PALETTES[this.targetSeason];
    const sb = this.seasonBlend;
    const nf = this.solar.nightFactor;
    const gf = this.solar.goldenHourFactor;

    const baseDay = CONFIG.THEMES.day;
    const baseNight = CONFIG.THEMES.night;

    const dayBg = mix(sA.dayBackground, sB.dayBackground, sb);
    const nightBg = mix(sA.nightBackground, sB.nightBackground, sb);
    let bg = mix(dayBg, nightBg, nf);
    if (gf > 0.01) {
      const goldenBg = this.solar.isDawn ? '#F4DFCD' : '#EBC9AC';
      bg = mix(bg, goldenBg, gf * 0.3);
    }

    const dayWater = mix(sA.dayWater, sB.dayWater, sb);
    const nightWater = mix(sA.nightWater, sB.nightWater, sb);
    let water = mix(dayWater, nightWater, nf);
    if (gf > 0.01) {
      water = mix(water, this.solar.isDawn ? '#E5989B' : '#E08A6B', gf * 0.25);
    }

    const dayWaterDeep = mix(sA.dayWaterDeep, sB.dayWaterDeep, sb);
    const waterDeep = mix(dayWaterDeep, baseNight.WATER_DEEP, nf);

    const dayWaterShore = mix(sA.dayWaterShore, sB.dayWaterShore, sb);
    const waterShore = mix(dayWaterShore, baseNight.WATER_SHORE, nf);

    const dayWaterBank = mix(sA.dayWaterBank, sB.dayWaterBank, sb);
    const waterBank = mix(dayWaterBank, baseNight.WATER_BANK, nf);

    const hillContours = [0, 1, 2].map((i) => {
      const dH = mix(sA.dayHillContours[i], sB.dayHillContours[i], sb);
      const nH = mix(sA.nightHillContours[i], sB.nightHillContours[i], sb);
      return mix(dH, nH, nf);
    });

    const snow = this.getSnowCover();
    const mountainContours = [0, 1, 2].map((i) => {
      const dayM = snow > 0.25 && i >= 1 ? mix(baseDay.MOUNTAIN_CONTOURS[i], '#F8FAFC', snow * 0.55) : baseDay.MOUNTAIN_CONTOURS[i];
      return mix(dayM, baseNight.MOUNTAIN_CONTOURS[i], nf);
    });

    const treeShades = [0, 1, 2, 3].map((i) => {
      const dT = mix(sA.dayTreeShades[i], sB.dayTreeShades[i], sb);
      const nT = mix(sA.nightTreeShades[i], sB.nightTreeShades[i], sb);
      return mix(dT, nT, nf);
    });

    const wetDarken =
      this.getEffectiveWeather() === 'rain' && this.weatherIntensity > 0.15
        ? this.weatherIntensity * 0.35
        : 0;
    const dayRoadAsphalt = wetDarken > 0 ? mix(baseDay.ROAD_ASPHALT, '#28303D', wetDarken) : baseDay.ROAD_ASPHALT;

    return {
      BACKGROUND: bg,
      HILL_CONTOURS: hillContours,
      MOUNTAIN_CONTOURS: mountainContours,
      GRID_DOT: nf > 0.5 ? baseNight.GRID_DOT : baseDay.GRID_DOT,
      GRID_LINE: nf > 0.5 ? baseNight.GRID_LINE : baseDay.GRID_LINE,
      WATER: water,
      WATER_DEEP: waterDeep,
      WATER_SHORE: waterShore,
      WATER_BANK: waterBank,
      WATER_RIPPLE: nf > 0.5 ? baseNight.WATER_RIPPLE : baseDay.WATER_RIPPLE,
      ROAD_CASING: mix(baseDay.ROAD_CASING, baseNight.ROAD_CASING, nf),
      ROAD_ASPHALT: mix(dayRoadAsphalt, baseNight.ROAD_ASPHALT, nf),
      ROAD_LANE: nf > 0.5 ? baseNight.ROAD_LANE : baseDay.ROAD_LANE,
      PARKING_LOT: mix(baseDay.PARKING_LOT, baseNight.PARKING_LOT, nf),
      DRIVEWAY: mix(dayRoadAsphalt, baseNight.DRIVEWAY, nf),
      TREE_SHADES: treeShades,
      RAIL_TIE: mix(baseDay.RAIL_TIE, baseNight.RAIL_TIE, nf),
      RAIL_STEEL: mix(baseDay.RAIL_STEEL, baseNight.RAIL_STEEL, nf),
      RAIL_BALLAST: mix(baseDay.RAIL_BALLAST, baseNight.RAIL_BALLAST, nf),
    };
  }

  public getSnowCover(): number {
    const sA = SEASON_PALETTES[this.currentSeason].snowCover;
    const sB = SEASON_PALETTES[this.targetSeason].snowCover;
    return sA + (sB - sA) * this.seasonBlend;
  }

  public getSmokeIntensity(): number {
    const sA = SEASON_PALETTES[this.currentSeason].chimneySmokeIntensity;
    const sB = SEASON_PALETTES[this.targetSeason].chimneySmokeIntensity;
    const seasonal = sA + (sB - sA) * this.seasonBlend;
    return Math.min(1, seasonal + this.solar.nightFactor * 0.65 + this.solar.goldenHourFactor * 0.35);
  }

  private updateParticles(dt: number, season: SeasonId) {
    const w = WORLD_WIDTH;
    const h = WORLD_HEIGHT;
    const weather = this.getEffectiveWeather();

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.phase += dt * p.spin;

      if (weather === 'rain') {
        p.vx = 65 * this.windStrength;
        p.vy = 460 + (i % 5) * 35;
      } else if (weather === 'snow') {
        p.vx = 24 * this.windStrength + Math.sin(p.phase) * 18;
        p.vy = 42 + (i % 4) * 12;
      } else if (weather === 'blossoms') {
        p.vx = 32 * this.windStrength + Math.cos(p.phase * 1.3) * 22;
        p.vy = 28 + Math.sin(p.phase) * 10;
        p.color = i % 3 === 0 ? '#FFDEEB' : i % 3 === 1 ? '#FAA2C1' : '#FCC2D7';
      } else if (weather === 'leaves') {
        p.vx = 45 * this.windStrength + Math.cos(p.phase * 1.5) * 28;
        p.vy = 36 + Math.sin(p.phase) * 14;
        p.color = i % 3 === 0 ? '#F4A261' : i % 3 === 1 ? '#E76F51' : '#E9C46A';
      } else if (weather === 'mist') {
        p.vx = 14 + (i % 3) * 5;
        p.vy = Math.sin(p.phase * 0.4) * 3;
      } else {
        p.vx = Math.cos(p.phase * 0.7) * 10;
        p.vy = Math.sin(p.phase * 0.9) * 8;
        p.color = season === 'summer' && this.solar.nightFactor > 0.5 ? '#FDE047' : '#FFFFFF';
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.x > w + 40) p.x = -30;
      if (p.x < -40) p.x = w + 30;
      if (p.y > h + 40) {
        p.y = -20;
        p.x = Math.random() * w;
      }
      if (p.y < -40) p.y = h + 20;
    }

    if (weather === 'rain' && this.weatherIntensity > 0.15) {
      if (this.ripples.length < 30 && Math.random() < 0.45) {
        this.ripples.push({
          x: Math.random() * w,
          y: Math.random() * h,
          age: 0,
          maxAge: 0.65 + Math.random() * 0.45,
          maxRadius: 7 + Math.random() * 9,
        });
      }
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      this.ripples[i].age += dt;
      if (this.ripples[i].age >= this.ripples[i].maxAge) {
        this.ripples.splice(i, 1);
      }
    }
  }

  /**
   * Renders animated river current flow lines and winter ice edges along river channels.
   */
  public renderRiverFlow(
    ctx: CanvasRenderingContext2D,
    riverChannels: { x: number; y: number }[][],
    tileSize: number
  ) {
    if (!riverChannels || riverChannels.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const isNight = this.solar.nightFactor > 0.5;
    const flowColor = isNight
      ? 'rgba(148, 163, 184, 0.14)'
      : this.solar.goldenHourFactor > 0.2
      ? 'rgba(254, 215, 170, 0.34)'
      : 'rgba(255, 255, 255, 0.28)';

    const offsets = [-14, 0, 14];
    for (const pts of riverChannels) {
      if (pts.length < 2) continue;

      for (let oi = 0; oi < offsets.length; oi++) {
        const off = offsets[oi];
        ctx.beginPath();
        ctx.moveTo(pts[0].x * tileSize + off, pts[0].y * tileSize + off * 0.35);
        for (let i = 1; i < pts.length; i++) {
          const xc = ((pts[i - 1].x + pts[i].x) / 2) * tileSize + off;
          const yc = ((pts[i - 1].y + pts[i].y) / 2) * tileSize + off * 0.35;
          ctx.quadraticCurveTo(
            pts[i - 1].x * tileSize + off,
            pts[i - 1].y * tileSize + off * 0.35,
            xc,
            yc
          );
        }
        ctx.strokeStyle = flowColor;
        ctx.lineWidth = oi === 1 ? 2.2 : 1.5;
        ctx.setLineDash([16, 28]);
        ctx.lineDashOffset = -(this.windTime * (15 + oi * 4) + oi * 18);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  /**
   * Renders world-space weather overlays, solar golden-hour atmosphere, mist banks,
   * blossoms, autumn leaves, snow, or rain streaks.
   */
  public renderAtmosphereAndWeather(
    ctx: CanvasRenderingContext2D,
    bounds: GridBounds
  ) {
    const ts = CONFIG.TILE_SIZE;
    const bx = (bounds.minX - 4) * ts;
    const by = (bounds.minY - 4) * ts;
    const bw = (bounds.maxX - bounds.minX + 8) * ts;
    const bh = (bounds.maxY - bounds.minY + 8) * ts;

    ctx.save();

    // 1. Directional Solar Gradient Wash during Dawn / Golden Hour / Dusk
    if (this.solar.goldenHourFactor > 0.02) {
      const gf = this.solar.goldenHourFactor;
      const grad = this.solar.isDawn
        ? ctx.createLinearGradient(bx + bw, by, bx, by + bh)
        : ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      if (this.solar.isDawn) {
        grad.addColorStop(0, `rgba(251, 146, 60, ${(gf * 0.15).toFixed(3)})`);
        grad.addColorStop(0.55, `rgba(244, 114, 182, ${(gf * 0.06).toFixed(3)})`);
        grad.addColorStop(1, `rgba(99, 102, 241, ${(gf * 0.07).toFixed(3)})`);
      } else {
        grad.addColorStop(0, `rgba(245, 158, 11, ${(gf * 0.17).toFixed(3)})`);
        grad.addColorStop(0.5, `rgba(234, 88, 12, ${(gf * 0.08).toFixed(3)})`);
        grad.addColorStop(1, `rgba(49, 46, 129, ${(gf * 0.11).toFixed(3)})`);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(bx, by, bw, bh);
    }

    const weather = this.getEffectiveWeather();
    const intensity =
      this.weatherOverride !== 'auto'
        ? weather === 'clear'
          ? 0
          : 0.88
        : this.weatherIntensity;

    // 2. Summer Night Fireflies when Clear
    if (weather === 'clear' && this.solar.nightFactor > 0.45 && this.getEffectiveSeason() === 'summer') {
      const fireflyAlpha = (this.solar.nightFactor - 0.45) * 1.5;
      for (let i = 0; i < 32; i++) {
        const p = this.particles[i];
        const pulse = (Math.sin(this.windTime * 3.2 + p.phase) + 1) * 0.5;
        ctx.fillStyle = `rgba(253, 224, 71, ${(pulse * fireflyAlpha * 0.65).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.8 + pulse * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (intensity <= 0.02 || weather === 'clear') {
      ctx.restore();
      return;
    }

    // 3. Weather-specific particles
    if (weather === 'rain') {
      ctx.fillStyle = `rgba(30, 41, 59, ${(intensity * 0.11).toFixed(3)})`;
      ctx.fillRect(bx, by, bw, bh);

      ctx.strokeStyle = `rgba(186, 230, 253, ${(intensity * 0.34).toFixed(3)})`;
      ctx.lineWidth = 1.1;
      for (const r of this.ripples) {
        const prog = r.age / r.maxAge;
        const rad = r.maxRadius * prog;
        ctx.globalAlpha = (1 - prog) * intensity * 0.55;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, rad, rad * 0.6, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      ctx.strokeStyle = `rgba(186, 230, 253, ${(intensity * 0.44).toFixed(3)})`;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * 0.032, p.y + p.vy * 0.032);
      }
      ctx.stroke();
    } else if (weather === 'snow') {
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        const r = 1.6 + (i % 3) * 0.9;
        ctx.fillStyle = `rgba(255, 255, 255, ${(intensity * (0.55 + (i % 4) * 0.1)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (weather === 'blossoms' || weather === 'leaves') {
      const count = Math.floor(this.particles.length * 0.72);
      for (let i = 0; i < count; i++) {
        const p = this.particles[i];
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.phase);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = intensity * 0.85;
        const rx = weather === 'blossoms' ? 3.2 : 4.2;
        const ry = weather === 'blossoms' ? 2.0 : 2.4;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (weather === 'mist') {
      for (let i = 0; i < 16; i++) {
        const p = this.particles[i];
        const bandW = 240 + (i % 4) * 70;
        const bandH = 65 + (i % 3) * 25;
        const grad = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, bandW * 0.5);
        const mistAlpha = intensity * 0.16;
        grad.addColorStop(0, `rgba(241, 245, 249, ${mistAlpha.toFixed(3)})`);
        grad.addColorStop(1, 'rgba(241, 245, 249, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, bandW * 0.5, bandH * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }
}
