/**
 * @module features/landing/spring
 *
 * Pure spring math used by the landing page motion.
 *
 * A spring is described the way Apple describes it: a response time (how long
 * the value takes to reach its target) and a damping ratio (how much it
 * overshoots). The integrator is deliberately small and free of DOM access so
 * it can be unit tested directly.
 */

/** Physical constants of a damped harmonic oscillator. */
export interface SpringParams {
  /** Restoring force per unit of displacement. */
  stiffness: number;
  /** Velocity-proportional force. */
  damping: number;
  /** Mass of the moving value. */
  mass: number;
}

/** Position and velocity of a spring at a point in time. */
export interface SpringState {
  /** Current value. */
  value: number;
  /** Current rate of change, in units per second. */
  velocity: number;
}

/** Thresholds that decide whether a spring has come to rest. */
export interface SettleThresholds {
  /** Maximum distance from the target, in units. */
  position: number;
  /** Maximum speed, in units per second. */
  velocity: number;
}

/** Largest integration step, in seconds. Keeps the integrator stable. */
const MAX_STEP = 1 / 240;

/**
 * Converts a response time and damping ratio into oscillator constants.
 *
 * The response is the period of one oscillation, not a duration: a spring has
 * no fixed settle time, it emerges from these two numbers.
 *
 * @param response - Time in seconds for the value to reach its target.
 * @param dampingRatio - `1` is critically damped, below `1` overshoots.
 * @returns The constants used by {@link stepSpring}.
 */
export function springParams(response: number, dampingRatio: number): SpringParams {
  const omega = (2 * Math.PI) / response;
  return {
    stiffness: omega * omega,
    damping: 2 * dampingRatio * omega,
    mass: 1,
  };
}

/**
 * Advances a spring by `dt` seconds toward `target`.
 *
 * Uses semi-implicit Euler with a fixed maximum step, so a dropped frame
 * cannot make the integration explode. The returned velocity is carried over
 * by the caller, which is what lets a gesture reverse without a visible
 * discontinuity.
 *
 * @param state - Current position and velocity.
 * @param target - Value the spring is pulled toward.
 * @param params - Oscillator constants.
 * @param dt - Elapsed time in seconds.
 * @returns The state after `dt` seconds.
 */
export function stepSpring(
  state: SpringState,
  target: number,
  params: SpringParams,
  dt: number
): SpringState {
  const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
  const h = dt / steps;
  let value = state.value;
  let velocity = state.velocity;

  for (let i = 0; i < steps; i++) {
    const acceleration =
      (-params.stiffness * (value - target) - params.damping * velocity) / params.mass;
    velocity += acceleration * h;
    value += velocity * h;
  }

  return { value, velocity };
}

/**
 * Whether a spring is close enough to its target to stop animating.
 *
 * @param state - Current position and velocity.
 * @param target - Value the spring is pulled toward.
 * @param thresholds - Distance and speed that count as "at rest".
 * @returns `true` when the spring can be parked on the target.
 */
export function isSpringSettled(
  state: SpringState,
  target: number,
  thresholds: SettleThresholds = { position: 0.1, velocity: 1 }
): boolean {
  return (
    Math.abs(state.value - target) <= thresholds.position &&
    Math.abs(state.velocity) <= thresholds.velocity
  );
}
