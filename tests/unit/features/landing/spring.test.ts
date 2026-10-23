/**
 * @module tests/unit/features/landing/spring
 *
 * Tests for the landing page spring integrator.
 */
import { describe, it, expect } from "vitest";
import {
  isSpringSettled,
  springParams,
  stepSpring,
  type SpringParams,
} from "@/features/landing/spring";

/** Runs a spring forward for `seconds` at a fixed timestep. */
function run(
  start: number,
  target: number,
  params: SpringParams,
  seconds: number,
  timestep = 1 / 60
) {
  let state = { value: start, velocity: 0 };
  const samples: number[] = [];
  for (let elapsed = 0; elapsed < seconds; elapsed += timestep) {
    state = stepSpring(state, target, params, timestep);
    samples.push(state.value);
  }
  return { state, samples };
}

describe("springParams", () => {
  it("derives a critically damped oscillator from the response time", () => {
    const params = springParams(0.3, 1);
    const omega = (2 * Math.PI) / 0.3;

    expect(params.stiffness).toBeCloseTo(omega * omega, 6);
    // Critical damping means the damping term is exactly 2 * omega.
    expect(params.damping).toBeCloseTo(2 * omega, 6);
    expect(params.mass).toBe(1);
  });

  it("scales the response time into the natural frequency", () => {
    const fast = springParams(0.2, 1);
    const slow = springParams(0.4, 1);

    expect(fast.stiffness).toBeGreaterThan(slow.stiffness);
  });
});

describe("stepSpring", () => {
  it("converges on the target", () => {
    const params = springParams(0.3, 1);
    const { state } = run(0, 100, params, 1);

    expect(state.value).toBeCloseTo(100, 0);
    expect(state.velocity).toBeCloseTo(0, 0);
  });

  it("does not overshoot when critically damped", () => {
    const params = springParams(0.3, 1);
    const { samples } = run(0, 100, params, 1);

    expect(Math.max(...samples)).toBeLessThanOrEqual(100);
  });

  it("overshoots when under-damped", () => {
    const params = springParams(0.3, 0.5);
    const { samples } = run(0, 100, params, 1);

    expect(Math.max(...samples)).toBeGreaterThan(100);
  });

  it("keeps the velocity when the target reverses mid-flight", () => {
    const params = springParams(0.3, 1);
    const forward = stepSpring({ value: 0, velocity: 0 }, 100, params, 1 / 60);
    const reversed = stepSpring(forward, 0, params, 1 / 60);

    // The reversal starts from the velocity already in flight, so the value
    // keeps travelling in the same direction for a moment instead of jumping.
    expect(reversed.velocity).toBeLessThan(forward.velocity);
    expect(reversed.value).toBeGreaterThan(forward.value);
  });

  it("stays finite for a large timestep", () => {
    const params = springParams(0.3, 1);
    const state = stepSpring({ value: 0, velocity: 0 }, 100, params, 5);

    expect(Number.isFinite(state.value)).toBe(true);
    expect(Number.isFinite(state.velocity)).toBe(true);
  });
});

describe("isSpringSettled", () => {
  it("reports a resting spring as settled", () => {
    expect(isSpringSettled({ value: 10, velocity: 0 }, 10)).toBe(true);
  });

  it("reports a travelling spring as unsettled", () => {
    expect(isSpringSettled({ value: 10, velocity: 0 }, 40)).toBe(false);
    expect(isSpringSettled({ value: 10, velocity: 80 }, 10)).toBe(false);
  });
});
