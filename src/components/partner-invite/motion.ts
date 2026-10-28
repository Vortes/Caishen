// The invite's easing, shared by everything that moves. The scene is a pure
// function of time, so these are too: any frame can be drawn at any moment.

export const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
export const lerp = (from: number, to: number, t: number) =>
  from + (to - from) * t;
export const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const smoothstep = (t: number) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};

// The slice of an overall progress that belongs to one step.
export const span = (t: number, from: number, to: number) =>
  clamp((t - from) / (to - from));

// The same curves for CSS and the Web Animations API. `inOut` is
// easeInOut's cubic; `out` is a strong ease-out for things arriving.
export const CSS_EASE = {
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  out: "cubic-bezier(0.23, 1, 0.32, 1)",
};

// A spring from `from` toward `to`, `t` seconds after it was let go with
// `velocity` (units per second). Configured like Apple's: how long it takes
// to settle, and how much it overshoots (0 is critically damped).
export function spring(
  {
    from,
    to,
    velocity = 0,
    duration,
    bounce = 0,
  }: {
    from: number;
    to: number;
    velocity?: number;
    duration: number;
    bounce?: number;
  },
  t: number,
) {
  if (t <= 0) return from;
  const omega = (2 * Math.PI) / duration;
  const x = from - to;
  if (bounce <= 0) {
    return to + (x + (velocity + omega * x) * t) * Math.exp(-omega * t);
  }
  const damping = 1 - bounce;
  const ringing = omega * Math.sqrt(1 - damping * damping);
  return (
    to +
    Math.exp(-damping * omega * t) *
      (x * Math.cos(ringing * t) +
        ((velocity + damping * omega * x) / ringing) * Math.sin(ringing * t))
  );
}
