/**
 * @module features/landing/use-spring
 *
 * React binding for the landing page springs.
 *
 * The value is written straight to the DOM from the animation frame, so a
 * moving element never re-renders the React tree. The spring re-targets
 * instead of restarting: when the target changes mid-flight the current
 * velocity is carried into the new motion, which is what keeps a reversal
 * from looking like a wall.
 */
"use client";

import { useEffect, useRef } from "react";
import { isSpringSettled, springParams, stepSpring, type SpringState } from "./spring";

/** Tuning and reporting options for {@link useSpringNumber}. */
export interface SpringOptions {
  /** Time in seconds for the value to reach its target. */
  response?: number;
  /** `1` is critically damped, below `1` overshoots. */
  damping?: number;
  /** Called on every animation frame with the current value and velocity. */
  onFrame: (value: number, velocity: number) => void;
  /** Starting value. Applied to the first run of the spring only. */
  initialValue?: number;
}

/**
 * Animates a number toward `target` with a spring.
 *
 * A `null` target parks the spring: nothing moves and no frame is scheduled.
 * That lets a caller wait for a measured value before the animation starts.
 *
 * @param target - The value the spring is pulled toward, or `null` to hold still.
 * @param options - Spring tuning and the per-frame callback.
 */
export function useSpringNumber(target: number | null, options: SpringOptions): void {
  const { response = 0.3, damping = 1, onFrame, initialValue } = options;

  const onFrameRef = useRef(onFrame);
  const stateRef = useRef<SpringState>({ value: 0, velocity: 0 });
  const startedRef = useRef(false);

  useEffect(() => {
    onFrameRef.current = onFrame;
  });

  useEffect(() => {
    if (target === null) return;

    const params = springParams(response, damping);

    if (!startedRef.current) {
      startedRef.current = true;
      if (initialValue !== undefined) {
        stateRef.current = { value: initialValue, velocity: 0 };
      }
    }

    // Reduced motion keeps the feedback but drops the travel: the value snaps
    // to its target instead of animating there.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      stateRef.current = { value: target, velocity: 0 };
      onFrameRef.current(target, 0);
      return;
    }

    let frame: number | null = null;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(Math.max((now - last) / 1000, 0), 0.064);
      last = now;

      const next = stepSpring(stateRef.current, target, params, dt);
      stateRef.current = next;
      onFrameRef.current(next.value, next.velocity);

      if (isSpringSettled(next, target)) {
        stateRef.current = { value: target, velocity: 0 };
        onFrameRef.current(target, 0);
        frame = null;
        return;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [target, response, damping, initialValue]);
}
