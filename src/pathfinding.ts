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
        const baseStep = road?.isRoundabout ? dist * 0.62 : dist;
        const cong = congestionMap?.get(key) || 0;
        const congWeight = road?.isRoundabout ? cong * 0.3 : cong;
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
      key: string;
      gCost: number;
      fCost: number;
      parent: QueueNode | null;
    }

    const openSet = new Map<string, QueueNode>();
    const closedSet = new Set<string>();

    const h = (c: GridCoord) => Math.hypot(c.x - end.x, c.y - end.y);

    const startNode: QueueNode = {
      coord: start,
      key: startKey,
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

      if (current.key === endKey) {
        const path: GridCoord[] = [];
        let curr: QueueNode | null = current;
        while (curr) {
          path.unshift(curr.coord);
          curr = curr.parent;
        }
        return path;
      }

      openSet.delete(current.key);
      closedSet.add(current.key);

      const currentRoad = roads.get(current.key);
      if (!currentRoad) continue;

      // 1. 8-Directional Surface Road Neighbors
      for (const { dir, dx, dy, cost } of DIR_LIST) {
        if (!currentRoad.connections[dir]) continue;

        const nx = current.coord.x + dx;
        const ny = current.coord.y + dy;
        const nKey = `${nx},${ny}`;

        if (closedSet.has(nKey)) continue;

        const neighborRoad = roads.get(nKey);
        if (!neighborRoad) continue;
        if (neighborRoad.isDemolishing) continue;

        // Roundabouts have lower traversal friction and resist congestion penalties
        const congPenalty = congestionMap?.get(nKey) || 0;
        const stepCost = neighborRoad.isRoundabout
          ? cost * 0.62 + congPenalty * 0.3
          : cost + congPenalty;
        const gScore = current.gCost + stepCost;
        const existing = openSet.get(nKey);

        if (!existing || gScore < existing.gCost) {
          openSet.set(nKey, {
            coord: { x: nx, y: ny },
            key: nKey,
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
              key: mKey,
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
    const rawCenters: WorldPoint[] = [
      originWorld,
      ...gridPath.map((c) => {
        const road = roads?.get(`${c.x},${c.y}`);
        if (road && road.isRoundabout && road.roundaboutCenter) {
          const rcx = road.roundaboutCenter.x + 0.5;
          const rcy = road.roundaboutCenter.y + 0.5;
          const vx = c.x + 0.5 - rcx;
          const vy = c.y + 0.5 - rcy;
          const vLen = Math.hypot(vx, vy) || 1;
          return {
            x: rcx + (vx / vLen) * 0.94,
            y: rcy + (vy / vLen) * 0.94,
          };
        }
        return { x: c.x + 0.5, y: c.y + 0.5 };
      }),
      goalWorld,
    ];

    // Compute right-hand lane offset control points for all intermediate road nodes
    const offsetNodes: WorldPoint[] = [];
    for (let i = 0; i < rawCenters.length; i++) {
      if (i === 0 || i === rawCenters.length - 1) {
        // Keep exact origin (driveway bay) and goal (parking stall)
        offsetNodes.push({ ...rawCenters[i] });
        continue;
      }

      const prev = rawCenters[i - 1];
      const curr = rawCenters[i];
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

      // Sample 5 points along the quadratic bezier corner for ultra-smooth turning
      const samples = 5;
      for (let s = 1; s <= samples; s++) {
        const t = s / samples;
        const inv = 1 - t;
        const bx = inv * inv * pStart.x + 2 * inv * t * curr.x + t * t * pEnd.x;
        const by = inv * inv * pStart.y + 2 * inv * t * curr.y + t * t * pEnd.y;
        smooth.push({ x: bx, y: by });
      }
    }

    smooth.push(offsetNodes[offsetNodes.length - 1]);
    return smooth;
  }
}
