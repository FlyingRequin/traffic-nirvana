# Traffic Nirvana (v1.0.0)

An elevated, highly responsive web & mobile game of managing traffic, crafted with 3D diorama architecture, dual-lane traffic physics, express highway flyovers, surface commuter trains, reactive Disasterpeace-style audio, and blueprint planning.

🎮 **Play Live**: [https://traffic-nirvana.web.app](https://traffic-nirvana.web.app)

---

## 🌟 Key Features

- **3D Diorama Architecture**: Residential houses upgrade dynamically through 3 tiers (Suburban House $\to$ Mid-Rise Townhouse $\to$ High-Rise Skyscraper) with matching parking bays and solar panels. Commercial stores feature custom awnings, HVAC mechanical units, and upgradeable Circular Hub designs.
- **Surface Commuter Train & Railroad**: Central Commuter Train Station trackside platform along procedural corridors, featuring multi-car passenger trains and 2-tone melodic acoustic crossing bells.
- **Smart Traffic Dispatch & Suburb Rotation**:
  - *Far-Baseline*: When calm, distant suburbs cruise along highways and bridges for baseline trips.
  - *Close-Reserve*: When urgent, nearby houses act as emergency rapid-response teams.
  - *Rotation Fairness*: Lifetime dispatch quotas ensure all suburbs take turns circulating.
- **Traffic Density & Game Modes**:
  - *Modes*: Standard Survival (⏱️) vs. Zen Sandbox (🧘).
  - *Density*: Chill (☕), Balanced (🚗), Rush Hour (⚡ population-scaled demand).
- **Blueprint Ghost Planning Mode (<kbd>B</kbd>)**: Draft complex interchanges and bypasses freely with architectural glow lines while paused, then Commit (<kbd>Enter</kbd>) or Discard (<kbd>Esc</kbd>).
- **Ghost Demolition Queue**: Safely cordons roads slated for deletion with yellow hazard stripes until traffic vacates the tile.
- **Smart Sensor Traffic Lights & Roundabouts**: Responsive micro-sensor traffic lights that detect waiting queues.
- **Bottleneck Congestion Heatmap (<kbd>H</kbd>) & City Postcard Photo Export (<kbd>P</kbd>)**: Real-time delay heatmaps and high-res exportable postcards.
- **Harmonized Reactive Audio Engine**: Car arrivals trigger notes harmonized to the active ambient chord swell based on building color.
- **Cross-Platform**: Responsive Web + Native iOS via Capacitor.

---

## ⌨️ Controls & Shortcuts

| Action | Control |
| :--- | :--- |
| **Draw Road** | Left-Click + Drag or <kbd>D</kbd> |
| **Blueprint Mode** | <kbd>B</kbd> |
| **Commit Blueprint** | <kbd>Enter</kbd> |
| **Discard Blueprint** | <kbd>Esc</kbd> |
| **Motorway Flyover** | <kbd>W</kbd> |
| **Subway Metro Line** | <kbd>S</kbd> |
| **Roundabout** | <kbd>R</kbd> |
| **Traffic Light** | <kbd>T</kbd> |
| **Erase Road / Reclaim** | Right-Click + Drag or <kbd>E</kbd> |
| **Toggle Heatmap** | <kbd>H</kbd> |
| **City Postcard** | <kbd>P</kbd> |
| **Pause / Resume** | <kbd>Spacebar</kbd> |
| **Game Speed (1x / 2x)** | <kbd>1</kbd> / <kbd>2</kbd> |
| **Toggle Night Theme** | <kbd>N</kbd> |
| **Toggle Audio** | <kbd>M</kbd> |
| **Zoom / Pan** | Scroll wheel / Pinch; Middle-click / Alt-drag to pan |

---

## 🛠️ Development & Building

```bash
# Install dependencies
npm install

# Start local development server
npm run dev

# Production build
npm run build

# Sync to iOS project
npm run ios:sync

# Deploy to Firebase Hosting
npm run deploy
```

---

## 📄 License & Release
Distributed under the [MIT License](./LICENSE). See [RELEASE_NOTES.md](./RELEASE_NOTES.md) for full version history and changelog.

---

## ⚖️ Legal & Trademark Disclaimer
*Traffic Nirvana* is an independent open-source project created from scratch in TypeScript. It is not affiliated with, endorsed by, or sponsored by Dinosaur Polo Club Limited. *Mini Motorways* is a registered trademark of Dinosaur Polo Club Limited. All visual rendering, audio synthesis algorithms, and game code are original implementations.
