export type BuildingColor = 'red' | 'blue' | 'yellow' | 'green' | 'purple';

export type MapId = 'river_valley' | 'twin_islands' | 'alpine_pass';

export type GameMode = 'standard' | 'zen' | 'symphony';

export type DifficultyMode = 'relaxed' | 'normal' | 'rush_hour';

export type RhythmPhase = 'morning_rush' | 'midday_market' | 'evening_rush' | 'night_respite';

export interface RhythmEvent {
  id: string;
  hour: number; // 0..24
  minute: number; // 0..59
  phase: RhythmPhase;
  title: string;
  description: string;
  icon: string;
  targetType: 'station' | 'market' | 'suburb' | 'all';
  color?: BuildingColor;
  advanceNoticeLead: number; // seconds before event to trigger heads-up warning
}

export interface SymphonyFlowStats {
  flowPercentage: number; // 0..100% of vehicles moving smoothly
  activeVehicles: number;
  stalledVehicles: number;
  flowStreak: number; // seconds of sustained harmony
  harmonicMultiplier: number; // 1.0x .. 3.5x
  rank: 'S' | 'A' | 'B' | 'C';
}

export interface StationRushQueueItem {
  destId: string;
  pinsLeft: number;
  intervalTimer: number;
}

export interface GridCoord {
  x: number;
  y: number;
}

export interface WorldPoint {
  x: number;
  y: number;
  isMotorway?: boolean;
}

export type TileType = 'grass' | 'water' | 'hill' | 'mountain' | 'rail';

export type Direction8 = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export interface RoadTile {
  x: number;
  y: number;
  isBridge: boolean;
  isTunnel: boolean;
  isRailCrossing: boolean;
  hasTrafficLight: boolean;
  lightGreenAxis: 'ns' | 'ew';
  lightTimer: number;
  lightHoldTimer?: number;
  isRoundabout: boolean;
  roundaboutCenter?: GridCoord;
  connections: Record<Direction8, boolean>;
  isDemolishing?: boolean;
  demolishAnim?: number;
  congestionAccum?: number;
}

export interface Motorway {
  id: string;
  number: number;
  start: GridCoord;
  end: GridCoord;
  color: string;
}

export interface SubwayLine {
  id: string;
  number: number;
  start: GridCoord;
  end: GridCoord;
  trainProgress: number; // 0..1 along line
  direction: 1 | -1;
  dwellTimer?: number; // Station dwell pause in seconds (train stopped at platform)
  passengers?: number; // Commuters currently onboard
  passengerColor?: BuildingColor; // Color of commuters onboard
}

export interface SurfaceTrain {
  path: WorldPoint[];
  distance: number; // current distance in tiles along track
  totalLength: number; // total track length in tiles
  speed: number; // tiles per second
  active: boolean;
  cooldown: number; // seconds until next train enters
  stationStopTimer?: number; // seconds remaining while stopped at Central Station
  hasStoppedThisRun?: boolean;
  hasWarnedThisRun?: boolean;
}

export interface Roundabout {
  id: string;
  center: GridCoord; // occupies 3x3 around center
}

export interface House {
  id: string;
  x: number;
  y: number;
  color: BuildingColor;
  tier: 1 | 2 | 3; // 1 = House (2 cars), 2 = Apartment (4 cars), 3 = High-Rise (6 cars)
  driveway: GridCoord; // adjacent tile where driveway exits
  totalCars: number;
  availableCars: number;
  spawnAnimation: number;
  lastDispatchTime?: number; // Simulation timestamp of last car dispatch
  totalDispatches?: number; // Total cars dispatched over lifetime
}

export interface Destination {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: BuildingColor;
  isCircular: boolean; // Upgraded high-demand hub
  isTrainStation?: boolean; // Commuter Train Station hub along the rail line
  entrance: GridCoord; // Road tile adjacent to parking lot
  pins: number;
  maxPins: number;
  pinAnimations: number[]; // spring scale per pin
  spawnAccumulator: number;
  spawnInterval: number;
  overflowTimer: number;
  maxOverflowTime: number;
  claimedPins: number;
  spawnAnimation: number;
  activeParkingStalls: boolean[]; // 4 visual parking stalls inside lot
  gracePeriodTimer?: number; // Initial calm connection period before urgent overflow
}

export type CarState = 'to_dest' | 'at_dest' | 'returning' | 'home';

export interface Car {
  id: string;
  numericId: number;
  color: BuildingColor;
  homeHouseId: string;
  destId: string;
  state: CarState;

  // Continuous world coordinates (in tile units, e.g., 5.5 is center of tile 5)
  x: number;
  y: number;
  angle: number;
  speed: number;
  targetSpeed: number;
  isBraking: boolean;

  // Smooth curve waypoints in tile space (already lane-offset!)
  smoothPath: WorldPoint[];
  rawGridPath: GridCoord[];
  currentPointIndex: number;

  // Motorway state
  onMotorway: boolean;
  motorwayId: string | null;

  pauseTimer: number;
  parkingStallIndex: number;
  stuckTimer?: number;
  rerouteCooldown?: number;
}

export interface FloatingText {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  opacity: number;
  scale: number;
  life: number;
  maxLife: number;
}

export interface Tree {
  x: number;
  y: number;
  radius: number;
  shadeIndex: number;
  swaySpeed: number;
  swayOffset: number;
}

export interface HillContour {
  points: WorldPoint[];
  layer: number; // 0 = outer, 1 = mid, 2 = inner peak
  isMountain?: boolean;
}

export interface UpgradeOption {
  id: string;
  title: string;
  subtitle: string;
  iconType: 'motorway' | 'roundabout' | 'bridge' | 'traffic_light' | 'tunnel' | 'subway' | 'roads';
  roadsAmount: number;
  specialAmount: number;
}

export interface ConstructionSite {
  id: string;
  type: 'house' | 'destination';
  color: BuildingColor;
  x: number;
  y: number;
  w: number;
  h: number;
  entrance: GridCoord;
  isCircular?: boolean;
  isTrainStation?: boolean;
  previewTimer: number; // Seconds remaining in construction blueprint preview
  totalDuration: number;
  label: string;
}

export interface LevelSpawnEvent {
  day: number;
  type: 'house' | 'destination';
  color: BuildingColor;
  coord: GridCoord;
  drivewayOrEntrance?: GridCoord;
  w?: number;
  h?: number;
  isCircular?: boolean;
  isTrainStation?: boolean;
}
