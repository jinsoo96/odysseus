"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Facing } from "./Avatar";
import { CORRIDOR_Y, ELEVATOR } from "./floorplan";

export interface Point {
  x: number;
  y: number;
}

/** 걷는 속도(월드 픽셀/초)와 다리가 바뀌는 간격(ms). */
const SPEED = 420;
const STEP_MS = 150;

function reduceMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function facingOf(from: Point, to: Point): Facing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}

/** 복도를 거쳐 가는 ㄱ자 경로. 사무실에서 벽을 통과하지 않으려면 이 정도면 충분하다. */
function pathTo(from: Point, to: Point): Point[] {
  const way: Point[] = [];
  if (Math.abs(from.y - CORRIDOR_Y) > 1) way.push({ x: from.x, y: CORRIDOR_Y });
  if (Math.abs(to.x - from.x) > 1) way.push({ x: to.x, y: CORRIDOR_Y });
  way.push(to);
  return way;
}

/** 아바타의 위치·방향·다리. 목적지를 주면 걸어간다.
 *
 * 걷기는 **연출일 뿐이다.** 목적지에 닿는 것이 어떤 동작의 전제조건이 되면 안 되고
 * (그러면 걷지 못하는 사람은 시험을 시작할 수 없다), `prefers-reduced-motion` 이
 * 켜져 있으면 즉시 도착한다.
 */
export function useWalk() {
  const [pos, setPos] = useState<Point>(ELEVATOR);
  const [facing, setFacing] = useState<Facing>("east");
  const [step, setStep] = useState<0 | 1>(0);
  const [walking, setWalking] = useState(false);

  const frame = useRef<number | null>(null);
  const queue = useRef<Point[]>([]);
  const posRef = useRef<Point>(ELEVATOR);
  const stepAt = useRef(0);

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    queue.current = [];
    setWalking(false);
    setStep(0);
  }, []);

  const walkTo = useCallback(
    (target: Point) => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;

      if (reduceMotion()) {
        posRef.current = target;
        setPos(target);
        setFacing(facingOf(posRef.current, target));
        setWalking(false);
        setStep(0);
        return;
      }

      queue.current = pathTo(posRef.current, target);
      setWalking(true);
      let last = performance.now();

      const tick = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;

        const next = queue.current[0];
        if (!next) {
          frame.current = null;
          setWalking(false);
          setStep(0);
          return;
        }

        const dx = next.x - posRef.current.x;
        const dy = next.y - posRef.current.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 2) {
          posRef.current = next;
          setPos(next);
          queue.current.shift();
          frame.current = requestAnimationFrame(tick);
          return;
        }

        const move = Math.min(dist, SPEED * dt);
        const moved = {
          x: posRef.current.x + (dx / dist) * move,
          y: posRef.current.y + (dy / dist) * move,
        };
        setFacing(facingOf(posRef.current, next));
        posRef.current = moved;
        setPos(moved);

        if (now - stepAt.current > STEP_MS) {
          stepAt.current = now;
          setStep((s) => (s === 0 ? 1 : 0));
        }
        frame.current = requestAnimationFrame(tick);
      };

      frame.current = requestAnimationFrame(tick);
    },
    [],
  );

  useEffect(() => stop, [stop]);

  return { pos, facing, step, walking, walkTo, stop };
}
