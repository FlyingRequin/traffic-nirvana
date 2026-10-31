import { BuildingColor } from './types';

export interface BuildingPalette {
  main: string;
  roofLight: string;
  roofDark: string;
  wall: string;
  lot: string;
  shadow: string;
}

export const CONFIG = {
  GRID_COLS: 34,
  GRID_ROWS: 22,
  TILE_SIZE: 44,

  THEMES: {
    day: {
      BACKGROUND: '#F2EFE6',
      HILL_CONTOURS: ['#E6E3D6', '#DCE2D0', '#CFDAC0'],
      MOUNTAIN_CONTOURS: ['#D4CFC2', '#BFB8A8', '#EAECEF'],
      GRID_DOT: 'rgba(180, 174, 158, 0.45)',
      GRID_LINE: 'rgba(165, 158, 140, 0.28)',
      WATER: '#76C7E0',
      WATER_DEEP: '#5EB8D4',
      WATER_SHORE: '#DCE8DC',
      WATER_BANK: '#B4DFEC',
      WATER_RIPPLE: 'rgba(255, 255, 255, 0.45)',
      ROAD_CASING: '#2C313A',
      ROAD_ASPHALT: '#434A57',
      ROAD_LANE: 'rgba(255, 255, 255, 0.26)',
      PARKING_LOT: '#3A404C',
      DRIVEWAY: '#434A57',
      TREE_SHADES: ['#8AB882', '#75A86D', '#62965A', '#99C490'],
      RAIL_TIE: '#8E7B68',
      RAIL_STEEL: '#687382',
      RAIL_BALLAST: '#DED8C8',
    },
    night: {
      BACKGROUND: '#181D27',
      HILL_CONTOURS: ['#1E2532', '#232C3B', '#283345'],
      MOUNTAIN_CONTOURS: ['#252D3D', '#313B4F', '#4A5873'],
      GRID_DOT: 'rgba(255, 255, 255, 0.12)',
      GRID_LINE: 'rgba(255, 255, 255, 0.08)',
      WATER: '#113247',
      WATER_DEEP: '#0C2536',
      WATER_SHORE: '#1B2838',
      WATER_BANK: '#163E57',
      WATER_RIPPLE: 'rgba(118, 199, 224, 0.2)',
      ROAD_CASING: '#10141B',
      ROAD_ASPHALT: '#2B3343',
      ROAD_LANE: 'rgba(255, 255, 255, 0.22)',
      PARKING_LOT: '#232A38',
      DRIVEWAY: '#2B3343',
      TREE_SHADES: ['#234233', '#1D382B', '#2A4D3C', '#183024'],
      RAIL_TIE: '#3D3732',
      RAIL_STEEL: '#586478',
      RAIL_BALLAST: '#1E2430',
    },
  },

  COLORS: {
    ROAD_PREVIEW: 'rgba(67, 74, 87, 0.55)',
    ROAD_ERASE_PREVIEW: 'rgba(235, 77, 75, 0.55)',

    // Bridge
    BRIDGE_DECK: '#555E6E',
    BRIDGE_RAIL: '#D2D7DF',
    BRIDGE_PIER: '#8C96A6',
    BRIDGE_SHADOW: 'rgba(0, 0, 0, 0.22)',

    // Tunnel
    TUNNEL_PORTAL: '#7F8C9A',
    TUNNEL_ARCH: '#D2D7DF',
    TUNNEL_UNDERGROUND: 'rgba(44, 49, 58, 0.36)',

    // Motorway (Express Highway Flyover)
    MOTORWAY_CASING: '#2C2270',
    MOTORWAY_ASPHALT: '#5442D6',
    MOTORWAY_LANE: '#F7D794',
    MOTORWAY_SHADOW: 'rgba(15, 12, 45, 0.30)',
    MOTORWAY_SHIELD_BG: '#F39C12',
    MOTORWAY_SHIELD_BORDER: '#FFFFFF',

    // Subway (Underground Metro Transit)
    SUBWAY_LINE_OUTER: 'rgba(15, 165, 155, 0.42)',
    SUBWAY_LINE_INNER: 'rgba(31, 209, 195, 0.75)',
    SUBWAY_STATION_BG: '#0E7C74',
    SUBWAY_STATION_RING: '#2CE5D5',
    SUBWAY_TRAIN: '#FFFFFF',

    // Surface Commuter Train
    TRAIN_BODY: '#E2E8F0',
    TRAIN_STRIPE: '#E84855',
    TRAIN_ROOF: '#94A3B8',
    TRAIN_WINDOW: '#1E293B',

    // Roundabout Island
    ROUNDABOUT_GRASS: '#8AB882',
    ROUNDABOUT_CURB: '#D2D7DF',

    BUILDINGS: {
      red: {
        main: '#E84855',
        roofLight: '#F26470',
        roofDark: '#C4323F',
        wall: '#9E222D',
        lot: '#E8DEC8',
        shadow: 'rgba(40, 20, 25, 0.22)',
      },
      blue: {
        main: '#2B85E4',
        roofLight: '#4FA0F5',
        roofDark: '#1B65B5',
        wall: '#124985',
        lot: '#DCE4EC',
        shadow: 'rgba(20, 30, 50, 0.22)',
      },
      yellow: {
        main: '#F4B924',
        roofLight: '#FAD05A',
        roofDark: '#D4960B',
        wall: '#A37000',
        shadow: 'rgba(45, 35, 15, 0.22)',
        lot: '#EFE8D4',
      },
      green: {
        main: '#1FB58F',
        roofLight: '#3FD1AC',
        roofDark: '#128C6D',
        wall: '#0B634C',
        lot: '#DCECE4',
        shadow: 'rgba(15, 40, 30, 0.22)',
      },
      purple: {
        main: '#8E54E9',
        roofLight: '#A879F5',
        roofDark: '#6B35C2',
        wall: '#4D2096',
        lot: '#E6DFEE',
        shadow: 'rgba(30, 20, 45, 0.22)',
      },
    } as Record<BuildingColor, BuildingPalette>,

    UI_TIMER_WARNING: '#F39C12',
    UI_TIMER_DANGER: '#E84855',
    TAILLIGHT: '#FF2E2E',
    HEADLIGHT_DAY: 'rgba(255, 255, 230, 0.0)',
    HEADLIGHT_NIGHT: 'rgba(255, 248, 195, 0.42)',
  },

  GAMEPLAY: {
    DAY_DURATION_SECONDS: 11,
    INITIAL_ROADS: 45,
    INITIAL_BRIDGES: 2,
    INITIAL_TUNNELS: 2,
    INITIAL_MOTORWAYS: 1,
    INITIAL_SUBWAYS: 1,
    INITIAL_ROUNDABOUTS: 1,
    INITIAL_TRAFFIC_LIGHTS: 2,

    MAX_PINS_PER_DESTINATION: 7,
    OVERFLOW_WARNING_THRESHOLD: 4,
    MAX_OVERFLOW_SECONDS: 15,

    BASE_CAR_SPEED: 2.35, // tiles per second (tuned so rush-hour queues & intersection jams form naturally)
    MOTORWAY_SPEED_MULTIPLIER: 2.4,
    CAR_ACCELERATION: 7.5,
    HEADWAY_DISTANCE: 0.68, // same-lane distance in tiles
    LANE_OFFSET: 0.125, // right-hand lane offset in tile units

    DESTINATION_VISIT_DURATION: 0.85,
    SUBWAY_CATCHMENT_RADIUS: 2.6, // compact walking radius around Subway stations in tiles
  },
};
