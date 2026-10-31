# Traffic Nirvana — Release Notes (v1.0.0)

Traffic Nirvana is a full-featured, elevated recreation and expansion of Dinosaur Polo Club's **Mini Motorways**, built from scratch in TypeScript with Canvas 2D rendering, dual-lane traffic physics, procedural map generation, interactive diorama aesthetics, and reactive generative audio.

---

## 🌟 Key Features in v1.0.0

### 1. 🏙️ 3D Diorama Architectural Art (Design A)
- **Residential Evolution**: Houses dynamically upgrade through 3 architectural tiers:
  - **Tier 1 (Suburban House)**: Pitched gabled roof, solar panels, wooden front door, chimney, and 2-car paved driveway.
  - **Tier 2 (Mid-Rise Townhouse / Apartment)**: 2-story brick facade, recessed glass balconies, air conditioning units, rooftop skylights, and 4-car resident parking.
  - **Tier 3 (High-Rise Skyscraper)**: 5-story glass-and-steel high-rise with mullion curtain walls, illuminated penthouse terrace, helipad, and 6-car resident parking lot.
- **Commercial Stores & Circular Hubs**:
  - Store buildings with display awnings, roof HVAC mechanical units, and designated parking stalls with car approach paths.
  - Upgradable into high-capacity **Circular Hub Stores** with glowing neon accents.
- **Commuter Railway System**:
  - Central Train Station trackside platform along procedural railway corridors.
  - Surface Commuter Train with scale-progressive car composition (locomotive + up to 5 passenger coaches).
  - Train station passenger rushes smoothed into spaced rhythmic waves.
- **Topographic Terrain**:
  - Elevation contour layers, mountain ridges with tunneling, and smooth river channel splines.
  - Clustered forest trees with wind sway and sunlit canopy puff highlights.

---

### 2. 🚦 Smart Traffic & Road Network Systems
- **Far-Baseline, Close-Reserve Smart Dispatching**:
  - When stores are calm (0–2 pins), cars from distant suburbs cruise along highways and bridges for baseline everyday shopping trips.
  - When stores enter danger (3+ pins / timer running), closest houses act as an emergency rapid-response team to prevent overflows.
- **Suburb Rotation & Lifetime Quota Balancing**:
  - Ensures every suburban cluster across the entire city takes turns circulating onto roads, preventing near houses from monopolizing traffic while far houses sit idle.
- **Traffic Density / Difficulty Settings**:
  - ☕ **Chill**: Gentle demand flow for relaxed, casual city building.
  - 🚗 **Balanced**: Standard progression.
  - ⚡ **Rush Hour**: Pin generation dynamically scales with total residential population ($\text{popFactor} = 1.0 + (\text{pop} - 4) \times 0.08$), demanding $2\times$–$3\times$ more trips and putting 60%–80% of all cars onto the roads simultaneously!
- **Game Modes**:
  - ⏱️ **Standard Survival**: Classic tension with overflow game-overs.
  - 🧘 **Zen Sandbox**: Relaxed building with no overflow timers, no game overs, and generous road tile supplies (+20 start tiles, +40 weekly bundle tiles).
- **Blueprint Ghost Planning Mode (<kbd>B</kbd>)**:
  - Draft roads with glowing translucent azure casing, dashed drafting centerlines, and alignment crosses without consuming inventory.
  - Automatically pauses game time for stress-free planning.
  - Dedicated floating HUD bar with **Commit** (<kbd>Enter</kbd>) and **Discard** (<kbd>Esc</kbd>) actions.
- **Ghost Demolition Queue**:
  - Safely cordons roads slated for removal with dashed yellow stripes until in-transit vehicles clear the tile before reclaim.
- **Smart Sensor Traffic Lights**:
  - Dynamic micro-controller queue detection flips or holds green lights based on waiting car counts.
- **Express Motorways & Underground Metro Subways**:
  - Elevated flyovers bypassing ground intersections at $2.3\times$ speed.
  - Underground subways ferrying commuters across long-distance corridors.

---

### 3. 🎵 Disasterpeace-Inspired Reactive Audio Engine
- **Harmonized Pin Pickup Panning & Pitch**:
  - Car and metro drop-offs play notes locked to the active ambient musical chord based on color:
    - **Red**: Root | **Blue**: 3rd | **Yellow**: 5th | **Green**: 7th/9th | **Purple**: Octave
- **Acoustic Railroad Crossing Bell**:
  - Alternates between $E_6$ (1318.5 Hz) and $B_5$ (987.8 Hz) with warm physical dampening as trains approach crossings.
- **Tactile UI Audio**:
  - Ascending pentatonic scales when drawing roads, paper drafts for blueprints, and fanfare chimes on commits.

---

### 4. 📸 Bottleneck Congestion Heatmap & City Postcard Export
- **Heatmap (<kbd>H</kbd>)**:
  - Live color gradient (Cyan $\to$ Amber $\to$ Neon Crimson) showing vehicular delay hotspots.
- **City Postcard Photo Mode (<kbd>P</kbd>)**:
  - Generates a high-resolution export postcard complete with city name, score, day counter, and crisp stamp graphic for copying or PNG download.

---

### 5. 📱 Multi-Platform Deployment
- **Web App**: Hosted on Firebase Hosting at [https://traffic-nirvana.web.app](https://traffic-nirvana.web.app).
- **iOS App**: Packaged via Capacitor iOS (`ios/App`) with native status bar, haptic feedback, and multi-touch gestures.
