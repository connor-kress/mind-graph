import { useCallback, useEffect, useRef, useState } from "react";
import type { XY } from "./tree";

// Time constant of the exponential ease toward targets.
const TAU_MS = 55;
const SETTLE_PX = 0.25;

/**
 * Eases displayed positions toward `targets`. Positions are animated in JS
 * (rather than with CSS transitions) so that edges, which React Flow draws
 * from node positions, move together with their nodes.
 *
 * New keys start at `spawnAt(key)` if given, otherwise at their target. When
 * `instant` is set, everything jumps straight to its target.
 */
export function useAnimatedPositions(
  targets: Map<string, XY>,
  options: { instant: boolean; spawnAt: (key: string) => XY | undefined },
) {
  const current = useRef(new Map<string, XY>());
  const [, setFrame] = useState(0);
  const raf = useRef<number | undefined>(undefined);
  const lastTime = useRef<number | undefined>(undefined);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  // Sync keys during render so new nodes have a position immediately.
  const positions = current.current;
  for (const key of positions.keys()) {
    if (!targets.has(key)) positions.delete(key);
  }
  for (const [key, target] of targets) {
    if (options.instant) positions.set(key, target);
    else if (!positions.has(key)) positions.set(key, options.spawnAt(key) ?? target);
  }

  const tick = useCallback(function step(time: number) {
    const dt = Math.min(64, time - (lastTime.current ?? time - 16));
    lastTime.current = time;
    const k = 1 - Math.exp(-dt / TAU_MS);
    let moving = false;
    for (const [key, target] of targetsRef.current) {
      const pos = current.current.get(key);
      if (!pos) continue;
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      if (Math.abs(dx) < SETTLE_PX && Math.abs(dy) < SETTLE_PX) {
        if (dx || dy) current.current.set(key, target);
        continue;
      }
      moving = true;
      current.current.set(key, { x: pos.x + dx * k, y: pos.y + dy * k });
    }
    setFrame((f) => f + 1);
    if (moving) {
      raf.current = requestAnimationFrame(step);
    } else {
      raf.current = undefined;
      lastTime.current = undefined;
    }
  }, []);

  const start = useCallback(() => {
    if (raf.current === undefined) raf.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(() => {
    for (const [key, target] of targets) {
      const pos = current.current.get(key);
      if (pos && (pos.x !== target.x || pos.y !== target.y)) {
        start();
        return;
      }
    }
  }, [targets, start]);

  useEffect(
    () => () => {
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
      raf.current = undefined;
      lastTime.current = undefined;
    },
    [],
  );

  /** Moves nodes to the given positions instantly; they then ease to targets. */
  const jump = useCallback(
    (moves: Map<string, XY>) => {
      for (const [key, pos] of moves) current.current.set(key, pos);
      start();
    },
    [start],
  );

  return { positions, jump };
}
