import { BuildingColor, Car, Destination, FloatingText, GameMode, GridCoord, House, WorldPoint } from './types';
import { CONFIG } from './config';
import { Pathfinding } from './pathfinding';
import { DIR8_OFFSETS, RoadNetwork } from './roadNetwork';
import { sound } from './sound';

export class TrafficSimulation {
  public cars: Car[] = [];
  public floatingTexts: FloatingText[] = [];
  public getGameMode: (() => GameMode) | null = null;
  public getHarmonicMultiplier: (() => number) | null = null;
  public onUpdateFlowStats:
    | ((ratio: number, active: number, stalled: number, dt: number) => void)
    | null = null;
  private flowArrivalCombo: number = 0;
  private lastArrivalTimestamp: number = 0;
  private carCounter: number = 0;
  private dispatchTimer: number = 0;
  private simTime: number = 0;
  private networkDirty: boolean = false;
  private networkRerouteTimer: number = 0;

  constructor(
    private roadNetwork: RoadNetwork,
    private getHouses: () => House[],
    private getDestinations: () => Destination[],
    private onScoreIncrement: (points: number) => void
  ) {
    this.roadNetwork.onNetworkChanged = () => {
      this.networkDirty = true;
    };
  }

  /**
   * Returns the active driveway road tile adjacent to the house,
   * prioritizing the house's facing driveway tile so cars always enter/exit via the rendered driveway apron.
   */
  public getHouseRoadNeighbors(house: House): GridCoord[] {
    if (this.roadNetwork.hasRoad(house.driveway.x, house.driveway.y)) {
      return [house.driveway];
    }

    const ortho: GridCoord[] = [
      { x: house.x + 1, y: house.y },
      { x: house.x - 1, y: house.y },
      { x: house.x, y: house.y + 1 },
      { x: house.x, y: house.y - 1 },
    ];
    const foundOrtho = ortho.filter((c) => this.roadNetwork.hasRoad(c.x, c.y));
    if (foundOrtho.length > 0) return [foundOrtho[0]];

    const diag: GridCoord[] = [
      { x: house.x + 1, y: house.y - 1 },
      { x: house.x + 1, y: house.y + 1 },
      { x: house.x - 1, y: house.y + 1 },
      { x: house.x - 1, y: house.y - 1 },
    ];
    const foundDiag = diag.filter((c) => this.roadNetwork.hasRoad(c.x, c.y));
    return foundDiag.length > 0 ? [foundDiag[0]] : [];
  }

  /**
   * Returns the destination's active parking-lot entrance road tile.
   * Option 1 (Fixed Designated Entrance): The store is strictly bound to its
   * designated entrance tile (`dest.entrance`). Unrelated bypass roads passing
   * beside or behind the building will NEVER hijack or move the store entrance!
   */
  public getDestinationRoadNeighbors(dest: Destination): GridCoord[] {
    if (this.roadNetwork.hasRoad(dest.entrance.x, dest.entrance.y)) {
      return [dest.entrance];
    }
    return [];
  }

  /**
   * Builds a live per-tile congestion penalty map from active surface cars so pathfinding
   * and dynamic rerouting naturally divert cars onto clear roads, Roundabouts, and Motorways.
   */
  public buildCongestionMap(excludeCarId?: string): Map<string, number> {
    const map = new Map<string, number>();
    for (const c of this.cars) {
      if (
        c.id === excludeCarId ||
        c.onMotorway ||
        (c.state !== 'to_dest' && c.state !== 'returning')
      ) {
        continue;
      }
      const gx = Math.floor(c.x);
      const gy = Math.floor(c.y);
      const key = `${gx},${gy}`;
      const isSlowOrStopped = c.speed < CONFIG.GAMEPLAY.BASE_CAR_SPEED * 0.45 || c.isBraking;
      const penalty = isSlowOrStopped ? 2.6 : 0.85;
      map.set(key, (map.get(key) || 0) + penalty);

      if (isSlowOrStopped) {
        const ax = Math.floor(c.x + Math.cos(c.angle) * 0.65);
        const ay = Math.floor(c.y + Math.sin(c.angle) * 0.65);
        const aKey = `${ax},${ay}`;
        map.set(aKey, (map.get(aKey) || 0) + 1.15);
      }
    }
    return map;
  }

  private getParkingStallWorldPos(dest: Destination, stallIndex: number): WorldPoint {
    const isNorthEntrance = dest.entrance.y < dest.y;

    const col = stallIndex % 2;
    const row = Math.floor(stallIndex / 2);
    return {
      x: dest.x + 0.65 + col * 0.7,
      y: isNorthEntrance ? dest.y + 0.35 + row * 0.38 : dest.y + 1.25 + row * 0.38,
    };
  }

  public isCarNearTile(tx: number, ty: number): boolean {
    for (const c of this.cars) {
      if (c.onMotorway || c.state === 'home') continue;
      if (Math.abs(c.x - (tx + 0.5)) < 0.65 && Math.abs(c.y - (ty + 0.5)) < 0.65) {
        return true;
      }
    }
    return false;
  }

  public getTrafficQueueAtIntersection(x: number, y: number): { ns: number; ew: number } {
    let ns = 0;
    let ew = 0;
    for (const car of this.cars) {
      if (car.onMotorway || car.state === 'at_dest' || car.state === 'home') continue;
      const dx = car.x - (x + 0.5);
      const dy = car.y - (y + 0.5);
      const dist = Math.hypot(dx, dy);
      if (dist <= 1.55) {
        // Car is approaching or stopped near this intersection
        if (Math.abs(dx) > Math.abs(dy)) {
          ew++;
        } else {
          ns++;
        }
      }
    }
    return { ns, ew };
  }

  public update(dt: number) {
    this.simTime += dt;
    this.dispatchTimer += dt;
    if (this.dispatchTimer >= 0.16) {
      this.dispatchTimer = 0;
      this.dispatchCars();
    }

    // Check and finalize any road demolition queues once vehicles have cleared the tile
    this.roadNetwork.checkAndFinalizeDemolitions((x, y) => this.isCarNearTile(x, y));

    if (this.networkDirty) {
      this.networkRerouteTimer += dt;
      if (this.networkRerouteTimer >= 0.08) {
        this.networkDirty = false;
        this.networkRerouteTimer = 0;
        this.rerouteActiveCars(true);
      }
    }

    this.updateSubways(dt);

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      this.updateCar(car, dt);

      if (car.state === 'home') {
        const home = this.getHouses().find((h) => h.id === car.homeHouseId);
        if (home) {
          home.availableCars = Math.min(home.totalCars, home.availableCars + 1);
        }
        this.cars.splice(i, 1);
      }
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life += dt;
      ft.y -= dt * 22;
      ft.scale = Math.min(1.15, 0.7 + (ft.life / ft.maxLife) * 0.6);
      ft.opacity = Math.max(0, 1 - Math.pow(ft.life / ft.maxLife, 1.4));

      if (ft.life >= ft.maxLife) {
        this.floatingTexts.splice(i, 1);
      }
    }

    // City Symphony: Track velocity flow ratio of all active moving vehicles
    let activeMovingCount = 0;
    let smoothFlowCount = 0;
    let stalledCount = 0;
    for (const c of this.cars) {
      if (c.state === 'to_dest' || c.state === 'returning') {
        activeMovingCount++;
        if (c.speed >= CONFIG.GAMEPLAY.BASE_CAR_SPEED * 0.65 && !c.isBraking) {
          smoothFlowCount++;
        } else if (c.speed < CONFIG.GAMEPLAY.BASE_CAR_SPEED * 0.35 || c.isBraking) {
          stalledCount++;
        }
      }
    }
    const flowRatio = activeMovingCount > 0 ? smoothFlowCount / activeMovingCount : 1.0;
    if (this.onUpdateFlowStats) {
      this.onUpdateFlowStats(flowRatio, activeMovingCount, stalledCount, dt);
    }
  }

  private updateSubways(dt: number) {
    const houses = this.getHouses();
    const destinations = this.getDestinations();
    const catchRadius = CONFIG.GAMEPLAY.SUBWAY_CATCHMENT_RADIUS;

    for (const sub of this.roadNetwork.subways) {
      // 1. If currently dwelling at a station platform, countdown dwell timer
      if (sub.dwellTimer && sub.dwellTimer > 0) {
        sub.dwellTimer -= dt;
        if (sub.dwellTimer > 0) {
          continue; // Paused at station platform while passengers embark/disembark
        }
        sub.dwellTimer = 0;
      }

      const spanDist = Math.max(
        3,
        Math.hypot(sub.end.x - sub.start.x, sub.end.y - sub.start.y)
      );
      const step = (dt * 3.8) / spanDist;
      sub.trainProgress += step * sub.direction;

      let arrivedStation: GridCoord | null = null;
      let originStation: GridCoord | null = null;

      if (sub.trainProgress >= 1.0) {
        sub.trainProgress = 1.0;
        sub.direction = -1;
        sub.dwellTimer = 0.9; // 0.9s platform dwell
        arrivedStation = sub.end;
        originStation = sub.start;
      } else if (sub.trainProgress <= 0.0) {
        sub.trainProgress = 0.0;
        sub.direction = 1;
        sub.dwellTimer = 0.9; // 0.9s platform dwell
        arrivedStation = sub.start;
        originStation = sub.end;
      }

      if (arrivedStation && originStation) {
        let totalDeliveredThisStop = 0;

        // Check if arrivedStation serves any nearby Destination with active demand pins
        for (const dest of destinations) {
          // KEY FIX: Subways deliver to active demand pins! Do NOT check claimedPins which starved subways
          if (dest.pins <= 0) continue;

          const distToDest = Math.hypot(
            dest.x + dest.w * 0.5 - (arrivedStation.x + 0.5),
            dest.y + dest.h * 0.5 - (arrivedStation.y + 0.5)
          );
          if (distToDest > catchRadius) continue;

          // Residential capacity of matching color within originStation catchment
          let connectedTierCapacity = 0;
          for (const h of houses) {
            if (h.color !== dest.color) continue;
            const distToHouse = Math.hypot(
              h.x + 0.5 - (originStation.x + 0.5),
              h.y + 0.5 - (originStation.y + 0.5)
            );
            if (distToHouse <= catchRadius) {
              connectedTierCapacity += (h.tier || 1) * 2;
            }
          }

          if (connectedTierCapacity > 0) {
            const delivered = Math.min(dest.pins, Math.min(4, connectedTierCapacity));
            if (delivered > 0) {
              totalDeliveredThisStop += delivered;
              for (let k = 0; k < delivered; k++) {
                if (dest.pins > 0) {
                  dest.pins--;
                  dest.pinAnimations.pop();
                }
              }
              // Clamp claimed pins so surface car dispatch remains balanced
              dest.claimedPins = Math.max(0, Math.min(dest.claimedPins, dest.pins));

              // Relieve building overflow warning timer
              if (dest.overflowTimer > 0) {
                dest.overflowTimer = Math.max(0, dest.overflowTimer - 3.0);
              }

              // Award score with game mode multipliers (e.g. City Symphony harmonic multiplier)
              const isSymphony = this.getGameMode && this.getGameMode() === 'symphony';
              let points = delivered;
              let floatingLabel = `+${delivered} 🚇`;

              if (isSymphony) {
                const mult = this.getHarmonicMultiplier ? this.getHarmonicMultiplier() : 1.0;
                points = mult >= 1.8 ? Math.round(delivered * mult) : delivered;
                floatingLabel = mult > 1.3 ? `+${points} 🚇 🎶` : `+${points} 🚇`;
                sound.playHarmonicFlowChime(delivered, dest.color);
              } else {
                sound.playHarmonizedPinPickup(dest.color);
              }

              this.onScoreIncrement(points);

              this.floatingTexts.push({
                id: `ft_sub_${Date.now()}_${Math.random()}`,
                x: (dest.x + dest.w / 2) * CONFIG.TILE_SIZE,
                y: dest.y * CONFIG.TILE_SIZE - 12,
                text: floatingLabel,
                color: CONFIG.COLORS.SUBWAY_STATION_BG,
                opacity: 1,
                scale: 1.1,
                life: 0,
                maxLife: 1.5,
              });
            }
          }
        }

        if (totalDeliveredThisStop > 0) {
          // Floating indicator at station entrance portal
          this.floatingTexts.push({
            id: `ft_sub_st_${Date.now()}_${Math.random()}`,
            x: (arrivedStation.x + 0.5) * CONFIG.TILE_SIZE,
            y: (arrivedStation.y + 0.5) * CONFIG.TILE_SIZE - 14,
            text: `🚇 -${totalDeliveredThisStop}`,
            color: '#10B981',
            opacity: 1,
            scale: 0.9,
            life: 0,
            maxLife: 1.2,
          });
        }

        // Prepare onboard passengers for the return trip
        let returnCommuters = 0;
        let returnColor: BuildingColor | undefined = undefined;
        for (const dest of destinations) {
          const distToReturnDest = Math.hypot(
            dest.x + dest.w * 0.5 - (originStation.x + 0.5),
            dest.y + dest.h * 0.5 - (originStation.y + 0.5)
          );
          if (distToReturnDest > catchRadius) continue;

          for (const h of houses) {
            if (h.color === dest.color) {
              const distToH = Math.hypot(
                h.x + 0.5 - (arrivedStation.x + 0.5),
                h.y + 0.5 - (arrivedStation.y + 0.5)
              );
              if (distToH <= catchRadius) {
                returnCommuters += (h.tier || 1);
                returnColor = h.color;
              }
            }
          }
        }
        sub.passengers = Math.min(4, returnCommuters);
        sub.passengerColor = returnColor;
      }
    }
  }

  private dispatchCars() {
    const destinations = this.getDestinations();
    const houses = this.getHouses();
    const congestionMap = this.buildCongestionMap();

    for (const dest of destinations) {
      // State Detection: Is the store in an emergency? (Feature: Far-Baseline vs Close-Reserve)
      const warningThreshold = CONFIG.GAMEPLAY.OVERFLOW_WARNING_THRESHOLD;
      const isUrgent = dest.overflowTimer > 0 || dest.pins >= warningThreshold - 1;
      const urgencyReserve = isUrgent ? 1 : 0;
      const neededCars = Math.max(0, dest.pins + urgencyReserve - dest.claimedPins);
      if (neededCars <= 0) continue;

      const destRoads = this.getDestinationRoadNeighbors(dest);
      if (destRoads.length === 0) continue;

      const matchingHouses = houses.filter(
        (h) => h.color === dest.color && h.availableCars > 0
      );

      for (let n = 0; n < neededCars; n++) {
        let bestHouse: House | null = null;
        let bestGridPath: GridCoord[] | null = null;
        let bestDispatchScore: number = Infinity;
        let chosenDestRoad: GridCoord | null = null;
        let chosenHouseRoad: GridCoord | null = null;

        for (const house of matchingHouses) {
          if (house.availableCars <= 0) continue;

          const houseRoads = this.getHouseRoadNeighbors(house);
          if (houseRoads.length === 0) continue;

          for (const hr of houseRoads) {
            for (const dr of destRoads) {
              const roadPath = Pathfinding.findPath(
                hr,
                dr,
                this.roadNetwork.roads,
                this.roadNetwork.motorways,
                congestionMap
              );
              if (roadPath) {
                // 1. Raw road travel cost (distance + motorway speedups + congestion delays)
                const rawCost = Pathfinding.getPathCost(
                  roadPath,
                  this.roadNetwork.roads,
                  congestionMap
                );

                // 2. Active in-flight cars penalty:
                // Prevents a single house from sending all its cars in a convoy while others sit idle
                const inFlightCars = house.totalCars - house.availableCars;
                const activeCarPenalty = inFlightCars * 10.0;

                // 3. Dispatch Recency Penalty:
                // A house that dispatched recently yields to neighboring ready houses (Option #4 Rotation)
                const timeSinceDispatch = this.simTime - (house.lastDispatchTime ?? -999);
                const recencyPenalty = Math.max(0, 16.0 - timeSinceDispatch * 1.5);

                // 4. Lifetime Suburb Quota Balancing:
                // Houses that have dispatched fewer lifetime trips get higher priority, ensuring even circulation
                const dispatchCount = house.totalDispatches || 0;
                const quotaPenalty = dispatchCount * 3.0;

                let dispatchScore: number;

                if (isUrgent) {
                  // --- EMERGENCY CLOSE-RESERVE MODE ---
                  // Store is in danger of overflowing! Closest available houses act as rapid-response units.
                  // Raw travel distance is heavily prioritized to minimize arrival time.
                  const distanceCost = rawCost * 1.8;
                  dispatchScore = distanceCost + activeCarPenalty + recencyPenalty * 0.5;
                } else {
                  // --- CALM BASELINE COMMUTE MODE (Option #1 + Option #4) ---
                  // Store is relaxed (0-2 pins). No rush.
                  // We want distant suburbs to embark on baseline daily shopping trips across bridges and highways!
                  // Softened distance cost + idle waiting bonus + far voyage incentive
                  const distanceCost = Math.sqrt(rawCost) * 2.2;
                  const isFullDriveway = house.availableCars === house.totalCars;
                  const idleBonus = isFullDriveway ? Math.min(24.0, 4.0 + timeSinceDispatch * 0.8) : 0;
                  const voyageIncentive = Math.min(10.0, rawCost * 0.35);

                  dispatchScore = distanceCost + activeCarPenalty + recencyPenalty + quotaPenalty - idleBonus - voyageIncentive;
                }

                if (!bestGridPath || dispatchScore < bestDispatchScore) {
                  bestGridPath = roadPath;
                  bestDispatchScore = dispatchScore;
                  bestHouse = house;
                  chosenDestRoad = dr;
                  chosenHouseRoad = hr;
                }
              }
            }
          }
        }

        if (bestHouse && bestGridPath && chosenDestRoad && chosenHouseRoad) {
          bestHouse.availableCars--;
          bestHouse.lastDispatchTime = this.simTime;
          bestHouse.totalDispatches = (bestHouse.totalDispatches || 0) + 1;
          bestHouse.driveway = chosenHouseRoad;
          dest.claimedPins++;

          const numericId = ++this.carCounter;
          const stallIdx = numericId % 4;

          const originWorld: WorldPoint = {
            x: bestHouse.x + 0.5 + (chosenHouseRoad.x - bestHouse.x) * 0.35,
            y: bestHouse.y + 0.5 + (chosenHouseRoad.y - bestHouse.y) * 0.35,
          };
          const stallWorld = this.getParkingStallWorldPos(dest, stallIdx);

          const smoothPath = Pathfinding.buildSmoothLanePath(
            originWorld,
            bestGridPath,
            stallWorld,
            this.roadNetwork.roads
          );

          let initialAngle = 0;
          if (smoothPath.length > 1) {
            initialAngle = Math.atan2(
              smoothPath[1].y - smoothPath[0].y,
              smoothPath[1].x - smoothPath[0].x
            );
          }

          const car: Car = {
            id: `car_${numericId}`,
            numericId,
            color: bestHouse.color,
            homeHouseId: bestHouse.id,
            destId: dest.id,
            state: 'to_dest',
            x: smoothPath[0].x,
            y: smoothPath[0].y,
            angle: initialAngle,
            speed: CONFIG.GAMEPLAY.BASE_CAR_SPEED * 0.4,
            targetSpeed: CONFIG.GAMEPLAY.BASE_CAR_SPEED,
            isBraking: false,
            smoothPath,
            rawGridPath: bestGridPath,
            currentPointIndex: 1,
            onMotorway: false,
            motorwayId: null,
            pauseTimer: 0,
            parkingStallIndex: stallIdx,
            stuckTimer: 0,
            rerouteCooldown: 0.6,
          };

          this.cars.push(car);
        } else {
          break;
        }
      }
    }
  }

  /**
   * Dynamically recalculates routes for all active surface cars when the player builds new roads,
   * adds a Roundabout, places a Motorway, or modifies intersections!
   */
  public rerouteActiveCars(forceOnNetworkEdit: boolean = false) {
    const congestionMap = this.buildCongestionMap();
    for (const car of this.cars) {
      if (car.onMotorway || (car.state !== 'to_dest' && car.state !== 'returning')) {
        continue;
      }
      this.tryRerouteCar(car, congestionMap, forceOnNetworkEdit);
    }
  }

  private tryRerouteCar(
    car: Car,
    congestionMap: Map<string, number>,
    forceOnNetworkEdit: boolean = false
  ): boolean {
    if (car.onMotorway || (car.state !== 'to_dest' && car.state !== 'returning')) {
      return false;
    }

    // Never reroute a car while it is pulling out of a driveway/parking stall or pulling into a parking stall!
    if (car.currentPointIndex <= 2 || car.currentPointIndex >= car.smoothPath.length - 3) {
      return false;
    }

    let currTileX = Math.floor(car.x);
    let currTileY = Math.floor(car.y);

    // Never reroute while inside a House or Destination footprint
    if (
      this.roadNetwork.defaultOccupiedCheck &&
      this.roadNetwork.defaultOccupiedCheck(currTileX, currTileY)
    ) {
      return false;
    }

    // If a Roundabout center island was placed right under the car, snap to nearest roundabout ring tile
    if (!this.roadNetwork.hasRoad(currTileX, currTileY)) {
      const isRoundaboutCenter = this.roadNetwork.roundabouts.some(
        (rb) => rb.center.x === currTileX && rb.center.y === currTileY
      );
      if (!isRoundaboutCenter) return false;

      let nearest: GridCoord | null = null;
      let nearestDist = Infinity;
      for (const { dx, dy } of DIR8_OFFSETS) {
        const nx = currTileX + dx;
        const ny = currTileY + dy;
        if (this.roadNetwork.hasRoad(nx, ny)) {
          const d = Math.hypot(nx + 0.5 - car.x, ny + 0.5 - car.y);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = { x: nx, y: ny };
          }
        }
      }
      if (!nearest) return false;
      currTileX = nearest.x;
      currTileY = nearest.y;
    }

    const startCoord: GridCoord = { x: currTileX, y: currTileY };
    let targetRoads: GridCoord[] = [];
    let goalWorld: WorldPoint | null = null;
    let homeRef: House | undefined;

    if (car.state === 'to_dest') {
      const dest = this.getDestinations().find((d) => d.id === car.destId);
      if (!dest) return false;
      targetRoads = this.getDestinationRoadNeighbors(dest);
      goalWorld = this.getParkingStallWorldPos(dest, car.parkingStallIndex);
    } else {
      homeRef = this.getHouses().find((h) => h.id === car.homeHouseId);
      if (!homeRef) return false;
      targetRoads = this.getHouseRoadNeighbors(homeRef);
    }

    if (targetRoads.length === 0) return false;

    let bestPath: GridCoord[] | null = null;
    let bestCost = Infinity;
    let chosenTargetRoad: GridCoord | null = null;

    for (const tr of targetRoads) {
      const candidate = Pathfinding.findPath(
        startCoord,
        tr,
        this.roadNetwork.roads,
        this.roadNetwork.motorways,
        congestionMap
      );
      if (candidate) {
        const cost = Pathfinding.getPathCost(
          candidate,
          this.roadNetwork.roads,
          congestionMap
        );
        if (!bestPath || cost < bestCost) {
          bestPath = candidate;
          bestCost = cost;
          chosenTargetRoad = tr;
        }
      }
    }

    if (!bestPath || !chosenTargetRoad) return false;

    // Check if the car's existing rawGridPath is still valid or if it crosses a modified/roundabout tile
    let oldPathInvalidOrRoundaboutChanged = false;
    let currIdxInOld = 0;
    for (let i = 0; i < car.rawGridPath.length; i++) {
      const pt = car.rawGridPath[i];
      if (pt.x === currTileX && pt.y === currTileY) {
        currIdxInOld = i;
      }
      const r = this.roadNetwork.getRoad(pt.x, pt.y);
      if (!r || r.isRoundabout) {
        oldPathInvalidOrRoundaboutChanged = true;
      }
    }

    const remainingOldPath = car.rawGridPath.slice(currIdxInOld);
    const oldCost =
      remainingOldPath.length > 0
        ? Pathfinding.getPathCost(remainingOldPath, this.roadNetwork.roads, congestionMap)
        : Infinity;

    const isMeaningfullyBetter = bestCost < oldCost - (forceOnNetworkEdit ? 0.35 : 0.75);
    const pathDiffers =
      bestPath.length !== remainingOldPath.length ||
      bestPath.some(
        (p, idx) =>
          !remainingOldPath[idx] ||
          p.x !== remainingOldPath[idx].x ||
          p.y !== remainingOldPath[idx].y
      );

    if (!oldPathInvalidOrRoundaboutChanged && (!pathDiffers || !isMeaningfullyBetter)) {
      return false;
    }

    if (car.state === 'returning' && homeRef) {
      goalWorld = {
        x: homeRef.x + 0.5 + (chosenTargetRoad.x - homeRef.x) * 0.35,
        y: homeRef.y + 0.5 + (chosenTargetRoad.y - homeRef.y) * 0.35,
      };
    }
    if (!goalWorld) return false;

    const currentWorld: WorldPoint = { x: car.x, y: car.y };
    const newSmooth = Pathfinding.buildSmoothLanePath(
      currentWorld,
      bestPath,
      goalWorld,
      this.roadNetwork.roads
    );

    // Advance currentPointIndex past points that are right on top of the car's current position
    let nextIdx = 1;
    while (
      nextIdx < newSmooth.length - 1 &&
      Math.hypot(newSmooth[nextIdx].x - car.x, newSmooth[nextIdx].y - car.y) < 0.26
    ) {
      nextIdx++;
    }

    car.rawGridPath = bestPath;
    car.smoothPath = newSmooth;
    car.currentPointIndex = nextIdx;
    car.rerouteCooldown = 1.1;
    return true;
  }

  private updateCar(car: Car, dt: number) {
    if (car.rerouteCooldown && car.rerouteCooldown > 0) {
      car.rerouteCooldown = Math.max(0, car.rerouteCooldown - dt);
    }

    if (car.state === 'at_dest') {
      car.pauseTimer -= dt;
      if (car.pauseTimer <= 0) {
        const home = this.getHouses().find((h) => h.id === car.homeHouseId);
        const dest = this.getDestinations().find((d) => d.id === car.destId);
        if (dest) {
          dest.activeParkingStalls[car.parkingStallIndex] = false;
        }

        if (home && dest) {
          const homeRoads = this.getHouseRoadNeighbors(home);
          const destRoads = this.getDestinationRoadNeighbors(dest);
          const congestionMap = this.buildCongestionMap(car.id);

          let returnGridPath: GridCoord[] | null = null;
          let bestReturnCost = Infinity;
          let chosenHomeRoad: GridCoord | null = null;

          for (const dr of destRoads) {
            for (const hr of homeRoads) {
              const p = Pathfinding.findPath(
                dr,
                hr,
                this.roadNetwork.roads,
                this.roadNetwork.motorways,
                congestionMap
              );
              if (p) {
                const cost = Pathfinding.getPathCost(
                  p,
                  this.roadNetwork.roads,
                  congestionMap
                );
                if (!returnGridPath || cost < bestReturnCost) {
                  returnGridPath = p;
                  bestReturnCost = cost;
                  chosenHomeRoad = hr;
                }
              }
            }
          }

          if (returnGridPath && chosenHomeRoad) {
            const startWorld = { x: car.x, y: car.y };
            const homeWorld = {
              x: home.x + 0.5 + (chosenHomeRoad.x - home.x) * 0.35,
              y: home.y + 0.5 + (chosenHomeRoad.y - home.y) * 0.35,
            };
            const smoothReturn = Pathfinding.buildSmoothLanePath(
              startWorld,
              returnGridPath,
              homeWorld,
              this.roadNetwork.roads
            );

            car.state = 'returning';
            car.rawGridPath = returnGridPath;
            car.smoothPath = smoothReturn;
            car.currentPointIndex = 1;
            car.onMotorway = false;
            car.stuckTimer = 0;
            car.rerouteCooldown = 0.6;
          } else {
            car.state = 'home';
          }
        } else {
          car.state = 'home';
        }
      }
      return;
    }

    if (car.state !== 'to_dest' && car.state !== 'returning') {
      return;
    }

    // Check if finished smooth path
    if (car.currentPointIndex >= car.smoothPath.length) {
      if (car.state === 'to_dest') {
        car.state = 'at_dest';
        car.pauseTimer = CONFIG.GAMEPLAY.DESTINATION_VISIT_DURATION;
        car.speed = 0;

        const dest = this.getDestinations().find((d) => d.id === car.destId);
        if (dest) {
          dest.activeParkingStalls[car.parkingStallIndex] = true;
          if (dest.pins > 0) {
            dest.pins--;
            dest.pinAnimations.pop();
          }
          dest.claimedPins = Math.max(0, dest.claimedPins - 1);

          const isSymphony = this.getGameMode && this.getGameMode() === 'symphony';
          let points = 1;
          let floatingLabel = '+1';

          if (isSymphony) {
            const now = performance.now();
            if (now - this.lastArrivalTimestamp < 2200) {
              this.flowArrivalCombo++;
            } else {
              this.flowArrivalCombo = 1;
            }
            this.lastArrivalTimestamp = now;

            const mult = this.getHarmonicMultiplier ? this.getHarmonicMultiplier() : 1.0;
            points = mult >= 1.8 ? Math.round(mult) : 1;
            floatingLabel = mult > 1.3 ? `+${points} 🎶` : `+${points}`;
            sound.playHarmonicFlowChime(this.flowArrivalCombo, dest.color);
          } else {
            sound.playHarmonizedPinPickup(dest.color);
          }

          this.onScoreIncrement(points);

          this.floatingTexts.push({
            id: `ft_${Date.now()}_${Math.random()}`,
            x: (dest.x + dest.w / 2) * CONFIG.TILE_SIZE + (Math.random() - 0.5) * 14,
            y: dest.y * CONFIG.TILE_SIZE - 6 - Math.random() * 5,
            text: floatingLabel,
            color: CONFIG.COLORS.BUILDINGS[dest.color].main,
            opacity: 1,
            scale: 0.8,
            life: 0,
            maxLife: 1.1,
          });
        }
      } else if (car.state === 'returning') {
        car.state = 'home';
      }
      return;
    }

    const prevPoint = car.smoothPath[car.currentPointIndex - 1] || { x: car.x, y: car.y };
    const targetPoint = car.smoothPath[car.currentPointIndex];
    const dx = targetPoint.x - car.x;
    const dy = targetPoint.y - car.y;
    const dist = Math.hypot(dx, dy);

    // Detect if this segment is an elevated Motorway span
    car.onMotorway = Boolean(targetPoint.isMotorway || prevPoint.isMotorway);

    const baseSpeed = car.onMotorway
      ? CONFIG.GAMEPLAY.BASE_CAR_SPEED * CONFIG.GAMEPLAY.MOTORWAY_SPEED_MULTIPLIER
      : CONFIG.GAMEPLAY.BASE_CAR_SPEED;

    let desiredSpeed = baseSpeed;
    car.isBraking = false;

    if (!car.onMotorway) {
      const cosHeading = Math.cos(car.angle);
      const sinHeading = Math.sin(car.angle);

      // 1. Check Traffic Lights, Railroad Crossings & Uncontrolled Intersection Caution ahead
      const aheadTileX = Math.floor(car.x + cosHeading * 0.45);
      const aheadTileY = Math.floor(car.y + sinHeading * 0.45);
      const currTileX = Math.floor(car.x);
      const currTileY = Math.floor(car.y);
      const currRoad = this.roadNetwork.getRoad(currTileX, currTileY);
      const aheadRoad = this.roadNetwork.getRoad(aheadTileX, aheadTileY);
      const onRoundabout = Boolean(
        (currRoad && currRoad.isRoundabout) || (aheadRoad && aheadRoad.isRoundabout)
      );

      // Slow down slightly through uncontrolled 3-way/4-way intersections (Roundabouts stay fast!)
      const currConnCount = currRoad
        ? Object.values(currRoad.connections).filter(Boolean).length
        : 0;
      const aheadConnCount = aheadRoad
        ? Object.values(aheadRoad.connections).filter(Boolean).length
        : 0;
      const isIntersection =
        !onRoundabout &&
        ((currRoad && currConnCount >= 3) || (aheadRoad && aheadConnCount >= 3));
      if (isIntersection) {
        desiredSpeed = Math.min(desiredSpeed, baseSpeed * 0.68);
      }

      // Also slow down when making sharp corner turns (unless circulating on a Roundabout)
      if (dist > 0.001 && !onRoundabout) {
        const targetAngle = Math.atan2(dy, dx);
        let turnDiff = targetAngle - car.angle;
        while (turnDiff < -Math.PI) turnDiff += Math.PI * 2;
        while (turnDiff > Math.PI) turnDiff -= Math.PI * 2;
        if (Math.abs(turnDiff) > 0.38) {
          desiredSpeed = Math.min(desiredSpeed, baseSpeed * 0.62);
        }
      }

      let stoppedBySignalOrTrain = false;
      if (aheadTileX !== currTileX || aheadTileY !== currTileY) {
        if (aheadRoad && aheadRoad.hasTrafficLight) {
          const isMovingEW = Math.abs(cosHeading) >= Math.abs(sinHeading);
          const isRed =
            (isMovingEW && aheadRoad.lightGreenAxis === 'ns') ||
            (!isMovingEW && aheadRoad.lightGreenAxis === 'ew');
          if (isRed) {
            desiredSpeed = 0;
            car.isBraking = true;
            stoppedBySignalOrTrain = true;
          }
        }
        // 1b. Check Surface Commuter Train at Railroad Crossings
        if (
          aheadRoad &&
          aheadRoad.isRailCrossing &&
          this.roadNetwork.isTrainNearTile(aheadTileX, aheadTileY)
        ) {
          desiredSpeed = 0;
          car.isBraking = true;
          stoppedBySignalOrTrain = true;
        }
      }

      const carStuckTime = car.stuckTimer || 0;

      // 2. Direction-Aware Vehicle Spacing & Cross-Traffic Intersection Yielding
      for (const other of this.cars) {
        if (
          other.id === car.id ||
          other.onMotorway ||
          other.state === 'at_dest' ||
          other.state === 'home'
        ) {
          continue;
        }

        const odx = other.x - car.x;
        const ody = other.y - car.y;
        const otherDist = Math.hypot(odx, ody);
        if (otherDist > CONFIG.GAMEPLAY.HEADWAY_DISTANCE || otherDist < 0.001) continue;

        const headingAlignment = Math.cos(car.angle - other.angle);
        const otherCos = Math.cos(other.angle);
        const otherSin = Math.sin(other.angle);
        const forwardProj = odx * cosHeading + ody * sinHeading;
        const otherForwardProj = -odx * otherCos - ody * otherSin;
        const lateralOffset = Math.abs(-odx * sinHeading + ody * cosHeading);

        if (headingAlignment > 0.62) {
          // SAME DIRECTION / MERGING LANE:
          // Only yield if `other` is genuinely ahead of `car` (prevents side-by-side converging cars from both stopping for each other!)
          const isOtherAhead =
            forwardProj > otherForwardProj + 0.02 ||
            (Math.abs(forwardProj - otherForwardProj) <= 0.02 &&
              car.numericId > other.numericId);

          if (
            isOtherAhead &&
            forwardProj > 0.03 &&
            forwardProj < CONFIG.GAMEPLAY.HEADWAY_DISTANCE &&
            lateralOffset < 0.21
          ) {
            desiredSpeed = Math.min(desiredSpeed, other.speed * 0.78);
            car.isBraking = true;
            const stopDist = carStuckTime > 1.3 ? 0.16 : 0.31;
            if (forwardProj < stopDist) {
              desiredSpeed = 0;
            }
          }
        } else if (headingAlignment > -0.45 && !onRoundabout) {
          // PERPENDICULAR / CROSSING / TURNING CONFLICT AT INTERSECTIONS:
          if (
            forwardProj > 0.02 &&
            forwardProj < 0.46 &&
            lateralOffset < 0.34 &&
            otherDist < 0.48
          ) {
            const otherStuckTime = other.stuckTimer || 0;
            const shouldYield =
              carStuckTime <= otherStuckTime + 0.4 &&
              (otherForwardProj < forwardProj - 0.04 || car.numericId > other.numericId);

            if (shouldYield) {
              desiredSpeed = 0;
              car.isBraking = true;
            }
          }
        }
      }

      // Post-loop deadlock release: if a car has been stuck in an intersection/merge knot for > 1.45s,
      // let it creep forward so circular multi-car deadlocks always clear!
      if (!stoppedBySignalOrTrain && carStuckTime > 1.45 && desiredSpeed === 0) {
        desiredSpeed = baseSpeed * 0.44;
      }

      // Track stuck time & dynamically reroute if delayed in traffic (and not just waiting for a train/red light)
      if (!stoppedBySignalOrTrain && car.speed < CONFIG.GAMEPLAY.BASE_CAR_SPEED * 0.38) {
        car.stuckTimer = (car.stuckTimer || 0) + dt;
        if (car.stuckTimer >= 0.85 && (car.rerouteCooldown || 0) <= 0) {
          const rerouted = this.tryRerouteCar(car, this.buildCongestionMap(car.id), false);
          if (rerouted) {
            car.stuckTimer = 0;
          } else {
            car.rerouteCooldown = 0.9;
          }
        }
      } else if (car.speed > CONFIG.GAMEPLAY.BASE_CAR_SPEED * 0.5) {
        car.stuckTimer = Math.max(0, (car.stuckTimer || 0) - dt * 2.5);
      }

      // Record bottleneck congestion accumulation on the road tile
      if (car.isBraking || car.speed < CONFIG.GAMEPLAY.BASE_CAR_SPEED * 0.45) {
        const cTileX = Math.floor(car.x);
        const cTileY = Math.floor(car.y);
        const r = this.roadNetwork.getRoad(cTileX, cTileY);
        if (r) {
          r.congestionAccum = (r.congestionAccum || 0) + dt;
        }
      }
    }

    // Smooth acceleration and braking
    if (car.speed < desiredSpeed) {
      car.speed = Math.min(desiredSpeed, car.speed + CONFIG.GAMEPLAY.CAR_ACCELERATION * dt);
    } else {
      car.speed = Math.max(desiredSpeed, car.speed - CONFIG.GAMEPLAY.CAR_ACCELERATION * 2.0 * dt);
    }

    // Smooth angular rotation
    if (dist > 0.001) {
      const targetAngle = Math.atan2(dy, dx);
      let diff = targetAngle - car.angle;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      car.angle += diff * Math.min(1.0, 18.0 * dt);
    }

    // Advance along smooth spline
    let remainingStep = car.speed * dt;
    while (remainingStep > 0 && car.currentPointIndex < car.smoothPath.length) {
      const wp = car.smoothPath[car.currentPointIndex];
      const segDx = wp.x - car.x;
      const segDy = wp.y - car.y;
      const segDist = Math.hypot(segDx, segDy);

      if (remainingStep >= segDist) {
        car.x = wp.x;
        car.y = wp.y;
        remainingStep -= segDist;
        car.currentPointIndex++;
      } else {
        car.x += (segDx / segDist) * remainingStep;
        car.y += (segDy / segDist) * remainingStep;
        remainingStep = 0;
      }
    }
  }

  public isCarOnTile(x: number, y: number): boolean {
    for (const car of this.cars) {
      if (car.state === 'to_dest' || car.state === 'returning') {
        if (Math.floor(car.x) === x && Math.floor(car.y) === y) {
          return true;
        }
      }
    }
    return false;
  }
}
