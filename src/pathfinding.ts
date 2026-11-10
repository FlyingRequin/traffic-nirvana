import { Direction8, GridCoord, Motorway, RoadTile, WorldPoint } from './types';
import { CONFIG } from './config';

const DIR_LIST: { dir: Direction8; dx: number; dy: number; cost: number }[] = [
  { dir: 'n', dx: 0, dy: -1, cost: 1.0 },
  { dir: 'ne', dx: 1, dy: -1, cost: 1.38 },
  { dir: 'e', dx: 1, dy: 0, cost: 1.0 },
  { dir: 'se', dx: 1, dy: 1, cost: 1.38 },
  { dir: 's', dx: 0, dy: 1, cost: 1.0 },
  { dir: 'sw', dx: -1, dy: 1, cost: 1.38 },
  { dir: 'w', dx: -1, dy: 0, cost: 1.0 },
  { dir: 'nw', dx: -1, dy: -1, cost: 1.38 },
];

export class Pathfinding {
  public static getPathCost(
    path: GridCoord[],
    roads: Map<string, RoadTile>,
    congestionMap?: Map<string, number>
  ): number {
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1];
      const curr = path[i];
      const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
      const key = `${curr.x},${curr.y}`;
      const road = roads.get(key);
      if (dist > 1.9) {
        total += dist / CONFIG.GAMEPLAY.MOTORWAY_SPEED_MULTIPLIER;
      } else {
        const baseStep = road?.isRoundabout ? dist * 0.25 : dist;
        const cong = congestionMap?.get(key) || 0;
        const congWeight = road?.isRoundabout ? cong * 0.25 : cong;
        total += baseStep + congWeight;
      }
    }
    return total;
  }

  public static findPath(
    start: GridCoord,
    end: GridCoord,
    roads: Map<string, RoadTile>,
    motorways: Motorway[] = [],
    congestionMap?: Map<string, number>
  ): GridCoord[] | null {
    const startKey = `${start.x},${start.y}`;
    const endKey = `${end.x},${end.y}`;

    if (startKey === endKey) {
      return [start];
    }

    if (!roads.has(startKey) || !roads.has(endKey)) {
      return null;
    }

    interface QueueNode {
      coord: GridCoord;
      tileKey: string;
      stateKey: string;
      justEnteredRoundabout: boolean;
      gCost: number;
      fCost: number;
      parent: QueueNode | null;
    }

    const openSet = new Map<string, QueueNode>();
    const closedSet = new Set<string>();

    const h = (c: GridCoord) => Math.hypot(c.x - end.x, c.y - end.y);

    const startNode: QueueNode = {
      coord: start,
      tileKey: startKey,
      stateKey: startKey,
      justEnteredRoundabout: false,
      gCost: 0,
      fCost: h(start),
      parent: null,
    };

    openSet.set(startKey, startNode);

    while (openSet.size > 0) {
      let current: QueueNode | null = null;
      for (const node of openSet.values()) {
        if (!current || node.fCost < current.fCost) {
          current = node;
        }
      }

      if (!current) break;

      if (current.tileKey === endKey) {
        const path: GridCoord[] = [];
        let curr: QueueNode | null = current;
        while (curr) {
          path.unshift(curr.coord);
          curr = curr.parent;
        }
        return path;
      }

      openSet.delete(current.stateKey);
      closedSet.add(current.stateKey);

      const currentRoad = roads.get(current.tileKey);
      if (!currentRoad) continue;

      // 1. 8-Directional Surface Road Neighbors
      for (const { dir, dx, dy, cost } of DIR_LIST) {
        if (!currentRoad.connections[dir]) continue;

        const nx = current.coord.x + dx;
        const ny = current.coord.y + dy;
        const nTileKey = `${nx},${ny}`;

        const neighborRoad = roads.get(nTileKey);
        if (!neighborRoad) continue;
        if (neighborRoad.isDemolishing) continue;

        // If the car just entered a roundabout tile from an external road, prevent it from immediately
        // turning clockwise (left) or U-turning out of that same corner tile without circulating around the ring!
        if (
          current.justEnteredRoundabout &&
          currentRoad.isRoundabout &&
          currentRoad.roundaboutCenter &&
          !neighborRoad.isRoundabout &&
          current.parent
        ) {
          const rcx = currentRoad.roundaboutCenter.x;
          const rcy = currentRoad.roundaboutCenter.y;
          const v1x = current.parent.coord.x - rcx;
          const v1y = current.parent.coord.y - rcy;
          const v2x = nx - rcx;
          const v2y = ny - rcy;
          const cross = v1x * v2y - v1y * v2x;
          // In screen coords (+x East, +y South), counter-clockwise around (rcx, rcy) has cross < 0
          if (cross >= -0.01) {
            continue;
          }
        }

        const enteringRoundabout =
          Boolean(neighborRoad.isRoundabout) &&
          (!currentRoad.isRoundabout ||
            currentRoad.roundaboutCenter?.x !== neighborRoad.roundaboutCenter?.x ||
            currentRoad.roundaboutCenter?.y !== neighborRoad.roundaboutCenter?.y);

        const nStateKey = enteringRoundabout ? `${nTileKey}:entry` : nTileKey;
        if (closedSet.has(nStateKey)) continue;

        // Roundabouts have low traversal cost and resist congestion penalties
        const congPenalty = congestionMap?.get(nTileKey) || 0;
        const stepCost = neighborRoad.isRoundabout
          ? cost * 0.25 + congPenalty * 0.25
          : cost + congPenalty;
        const gScore = current.gCost + stepCost;
        const existing = openSet.get(nStateKey);

        if (!existing || gScore < existing.gCost) {
          openSet.set(nStateKey, {
            coord: { x: nx, y: ny },
            tileKey: nTileKey,
            stateKey: nStateKey,
            justEnteredRoundabout: enteringRoundabout,
            gCost: gScore,
            fCost: gScore + h({ x: nx, y: ny }),
            parent: current,
          });
        }
      }

      // 2. Motorway Express Links
      for (const m of motorways) {
        let targetEnd: GridCoord | null = null;
        if (current.coord.x === m.start.x && current.coord.y === m.start.y) {
          targetEnd = m.end;
        } else if (current.coord.x === m.end.x && current.coord.y === m.end.y) {
          targetEnd = m.start;
        }

        if (targetEnd) {
          const mKey = `${targetEnd.x},${targetEnd.y}`;
          if (closedSet.has(mKey) || !roads.has(mKey)) continue;

          const flyDist = Math.hypot(targetEnd.x - current.coord.x, targetEnd.y - current.coord.y);
          const gScore = current.gCost + flyDist / CONFIG.GAMEPLAY.MOTORWAY_SPEED_MULTIPLIER;
          const existing = openSet.get(mKey);

          if (!existing || gScore < existing.gCost) {
            openSet.set(mKey, {
              coord: targetEnd,
              tileKey: mKey,
              stateKey: mKey,
              justEnteredRoundabout: false,
              gCost: gScore,
              fCost: gScore + h(targetEnd),
              parent: current,
            });
          }
        }
      }
    }

    return null;
  }

  /**
   * Builds a smooth, lane-offset spline path in world tile coordinates (where tile center is x+0.5, y+0.5)
   * starting from `originWorld`, following `gridPath`, and ending at `goalWorld`.
   */
  public static buildSmoothLanePath(
    originWorld: WorldPoint,
    gridPath: GridCoord[],
    goalWorld: WorldPoint,
    roads?: Map<string, RoadTile>
  ): WorldPoint[] {
    if (gridPath.length === 0) {
      return [originWorld, goalWorld];
    }

    const laneOffset = CONFIG.GAMEPLAY.LANE_OFFSET;
    const rawCenters: Array<WorldPoint & { rbCenter?: GridCoord }> = [
      originWorld,
      ...gridPath.map((c, idx) => {
        const road = roads?.get(`${c.x},${c.y}`);
        if (road && road.isRoundabout && road.roundaboutCenter) {
          const rcx = road.roundaboutCenter.x + 0.5;
          const rcy = road.roundaboutCenter.y + 0.5;
          let angle = Math.atan2(c.y + 0.5 - rcy, c.x + 0.5 - rcx);

          const prevCoord = idx > 0 ? gridPath[idx - 1] : null;
          const nextCoord = idx < gridPath.length - 1 ? gridPath[idx + 1] : null;
          const prevRoad = prevCoord ? roads?.get(`${prevCoord.x},${prevCoord.y}`) : undefined;
          const nextRoad = nextCoord ? roads?.get(`${nextCoord.x},${nextCoord.y}`) : undefined;

          const samePrevRb =
            prevRoad?.isRoundabout &&
            prevRoad.roundaboutCenter?.x === road.roundaboutCenter.x &&
            prevRoad.roundaboutCenter?.y === road.roundaboutCenter.y;
          const sameNextRb =
            nextRoad?.isRoundabout &&
            nextRoad.roundaboutCenter?.x === road.roundaboutCenter.x &&
            nextRoad.roundaboutCenter?.y === road.roundaboutCenter.y;

          // Align entry & exit nodes on the r=0.94 ring with the approaching/departing right-hand lane (arcsin(0.13/0.94) ≈ 0.14 rad)
          if (!samePrevRb && sameNextRb) {
            angle -= 0.14;
          } else if (samePrevRb && !sameNextRb) {
            angle += 0.14;
          }

          return {
            x: rcx + Math.cos(angle) * 0.94,
            y: rcy + Math.sin(angle) * 0.94,
            rbCenter: road.roundaboutCenter,
          };
        }
        return { x: c.x + 0.5, y: c.y + 0.5 };
      }),
      goalWorld,
    ];

    // Compute right-hand lane offset control points for all intermediate road nodes
    const offsetNodes: Array<WorldPoint & { rbCenter?: GridCoord }> = [];
    for (let i = 0; i < rawCenters.length; i++) {
      if (i === 0 || i === rawCenters.length - 1) {
        // Keep exact origin (driveway bay) and goal (parking stall)
        offsetNodes.push({ ...rawCenters[i] });
        continue;
      }

      const curr = rawCenters[i];
      if (curr.rbCenter) {
        // Roundabout ring is a one-way counter-clockwise track at r=0.94; keep exact ring coordinate
        offsetNodes.push({ ...curr });
        continue;
      }

      const prev = rawCenters[i - 1];
      const next = rawCenters[i + 1];

      let dx1 = curr.x - prev.x;
      let dy1 = curr.y - prev.y;
      const len1 = Math.hypot(dx1, dy1) || 1;
      dx1 /= len1;
      dy1 /= len1;

      let dx2 = next.x - curr.x;
      let dy2 = next.y - curr.y;
      const len2 = Math.hypot(dx2, dy2) || 1;
      dx2 /= len2;
      dy2 /= len2;

      // Average forward direction
      let tx = dx1 + dx2;
      let ty = dy1 + dy2;
      const tLen = Math.hypot(tx, ty);
      if (tLen > 0.001) {
        tx /= tLen;
        ty /= tLen;
      } else {
        tx = dx1;
        ty = dy1;
      }

      // Right-hand unit normal: (-ty, tx)
      const rx = -ty;
      const ry = tx;

      offsetNodes.push({
        x: curr.x + rx * laneOffset,
        y: curr.y + ry * laneOffset,
      });
    }

    // Subdivide corners with Quadratic Bezier curves so turns are butter-smooth
    const smooth: WorldPoint[] = [offsetNodes[0]];

    for (let i = 1; i < offsetNodes.length - 1; i++) {
      const prev = offsetNodes[i - 1];
      const curr = offsetNodes[i];
      const next = offsetNodes[i + 1];

      const distPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
      const distNext = Math.hypot(next.x - curr.x, next.y - curr.y);

      // Check if this step is a long Motorway jump (> 1.9 tiles)
      if (distPrev > 1.9) {
        // Subdivide the Motorway quadratic Bezier arch from prev to curr
        const archLiftTiles = 36 / CONFIG.TILE_SIZE;
        const ctrlX = (prev.x + curr.x) / 2;
        const ctrlY = (prev.y + curr.y) / 2 - archLiftTiles;
        const mwSteps = 14;
        for (let s = 1; s <= mwSteps; s++) {
          const t = s / mwSteps;
          const inv = 1 - t;
          const bx = inv * inv * prev.x + 2 * inv * t * ctrlX + t * t * curr.x;
          const by = inv * inv * prev.y + 2 * inv * t * ctrlY + t * t * curr.y;
          smooth.push({ x: bx, y: by, isMotorway: s < mwSteps });
        }
        continue;
      }

      if (distNext > 1.9) {
        smooth.push(curr);
        continue;
      }

      const pStart = {
        x: curr.x - (curr.x - prev.x) * 0.48,
        y: curr.y - (curr.y - prev.y) * 0.48,
      };
      const pEnd = {
        x: curr.x + (next.x - curr.x) * 0.48,
        y: curr.y + (next.y - curr.y) * 0.48,
      };

      const isInternalRbArc =
        curr.rbCenter &&
        prev.rbCenter &&
        next.rbCenter &&
        curr.rbCenter.x === prev.rbCenter.x &&
        curr.rbCenter.y === prev.rbCenter.y &&
        curr.rbCenter.x === next.rbCenter.x &&
        curr.rbCenter.y === next.rbCenter.y;

      // Sample 5 points along the quadratic bezier corner for ultra-smooth turning
      const samples = 5;
      for (let s = 1; s <= samples; s++) {
        const t = s / samples;
        const inv = 1 - t;
        let bx = inv * inv * pStart.x + 2 * inv * t * curr.x + t * t * pEnd.x;
        let by = inv * inv * pStart.y + 2 * inv * t * curr.y + t * t * pEnd.y;

        // Project internal roundabout circulation points onto the exact r=0.94 circular track
        if (isInternalRbArc && curr.rbCenter) {
          const rcx = curr.rbCenter.x + 0.5;
          const rcy = curr.rbCenter.y + 0.5;
          const ang = Math.atan2(by - rcy, bx - rcx);
          bx = rcx + Math.cos(ang) * 0.94;
          by = rcy + Math.sin(ang) * 0.94;
        }

        smooth.push({ x: bx, y: by });
      }
    }

    smooth.push(offsetNodes[offsetNodes.length - 1]);
    return smooth;
  }
}
