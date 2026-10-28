import type { Camera, Object3D, WebGLRenderer } from "three";

// Measures the invite as it plays, when the page is opened with ?perf: how
// long each frame took to come round, how much of it was script (and which
// parts), what each WebGL canvas cost the GPU and how many draw calls each
// of its passes made, and any long frame that held the page up. Figures are kept per
// segment: each step of the scene, or a span marked from outside through
// `window.__invitePerf.mark`, and read back through its `report`.
// Off, every hook here costs nothing but a null check.

type Stats = { mean: number; p50: number; p95: number; max: number };

type Segment = {
  name: string;
  started: number;
  // Between frames, and of script on the frame loop (ms).
  intervals: number[];
  scripts: number[];
  // Script by part (ms), summed over each frame.
  parts: Map<string, number[]>;
  // Each pass's draw calls, triangles and script (ms), summed over each
  // frame it drew on.
  renders: Map<string, Map<number, RenderFrame>>;
  // Each canvas's GPU time (ms), a frame at a time.
  gpu: Map<string, number[]>;
  // Long animation frames, or long tasks where those aren't reported.
  long: Long[];
};

// A long frame (ms): how much of it ran script, how much went on rendering
// (frame callbacks, style and layout), and the script that ran longest.
type Long = {
  duration: number;
  script: number;
  layout: number;
  render: number;
  top: string | null;
};

type FrameTiming = PerformanceEntry & {
  renderStart: number;
  styleAndLayoutStart: number;
  scripts: {
    duration: number;
    invoker: string;
    sourceFunctionName: string;
    sourceURL: string;
  }[];
};

type RenderFrame = { calls: number; triangles: number; cpu: number };

type Canvas = {
  width: number;
  height: number;
  antialias: boolean;
  samples: number;
  gpuTiming: boolean;
  live: boolean;
};

type Timer = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

// A canvas's GPU timer: one query a frame, open from its first draw to the
// end of the frame loop. Timing each pass on its own doesn't work: under
// ANGLE on Metal a pass's query also counts the passes queued before it.
type Clock = {
  name: string;
  gl: WebGL2RenderingContext;
  timer: Timer;
  query: WebGLQuery | null;
};

type Pending = {
  gl: WebGL2RenderingContext;
  query: WebGLQuery;
  disjoint: number;
  into: number[];
};

const enabled =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("perf");

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
const stats = (values: number[]): Stats => {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    mean: sorted.length ? sum / sorted.length : 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
  };
};
const round = (value: number) => Math.round(value * 100) / 100;
const rounded = (value: Stats) => ({
  mean: round(value.mean),
  p50: round(value.p50),
  p95: round(value.p95),
  max: round(value.max),
});

function createProbe() {
  const segments: Segment[] = [];
  const canvases = new Map<string, Canvas>();
  // Settings the invite chose as it ran, as last set.
  const notes = new Map<string, number>();
  const pending: Pending[] = [];
  const clocks = new Set<Clock>();
  // Whether the frame loop is running its ticks.
  let looping = false;
  let segment = open("load");
  let phase = "load";
  let frame = 0;
  let last: number | null = null;
  // This frame's script by part, until the frame ends.
  let parts = new Map<string, number>();

  function open(name: string): Segment {
    const next: Segment = {
      name,
      started: performance.now(),
      intervals: [],
      scripts: [],
      parts: new Map(),
      renders: new Map(),
      gpu: new Map(),
      long: [],
    };
    segments.push(next);
    return next;
  }

  // GPU timings come back a few frames late; each lands on the frame and
  // segment it was taken in.
  const collect = () => {
    for (let i = pending.length - 1; i >= 0; i--) {
      const { gl, query, disjoint, into } = pending[i]!;
      if (gl.isContextLost()) {
        pending.splice(i, 1);
        continue;
      }
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
      const nanoseconds = gl.getQueryParameter(
        query,
        gl.QUERY_RESULT,
      ) as number;
      if (!gl.getParameter(disjoint)) into.push(nanoseconds / 1e6);
      gl.deleteQuery(query);
      pending.splice(i, 1);
    }
  };
  const stop = (clock: Clock) => {
    if (!clock.query) return;
    const { gl, timer, name } = clock;
    gl.endQuery(timer.TIME_ELAPSED_EXT);
    const into = segment.gpu.get(name) ?? [];
    segment.gpu.set(name, into);
    pending.push({
      gl,
      query: clock.query,
      disjoint: timer.GPU_DISJOINT_EXT,
      into,
    });
    clock.query = null;
  };

  if (typeof PerformanceObserver !== "undefined") {
    const types = PerformanceObserver.supportedEntryTypes;
    const type = types.includes("long-animation-frame")
      ? "long-animation-frame"
      : types.includes("longtask")
        ? "longtask"
        : null;
    if (type)
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const end = entry.startTime + entry.duration;
          const timing = entry as FrameTiming;
          const scripts = timing.scripts ?? [];
          const top = [...scripts].sort((a, b) => b.duration - a.duration)[0];
          segment.long.push({
            duration: entry.duration,
            script: scripts.reduce((sum, each) => sum + each.duration, 0),
            layout: timing.styleAndLayoutStart
              ? end - timing.styleAndLayoutStart
              : 0,
            render: timing.renderStart ? end - timing.renderStart : 0,
            top: top
              ? `${Math.round(top.duration)}ms ${top.invoker} ${top.sourceFunctionName || "?"} ${top.sourceURL.split("/").pop() ?? ""}`
              : null,
          });
        }
      }).observe({ type, buffered: true });
  }

  const probe = {
    // The scene moved on to a step.
    phase(name: string) {
      if (name === phase) return;
      phase = name;
      segment = open(name);
    },
    // A span marked from outside, until the next mark or step.
    mark(name: string) {
      segment = open(name);
    },
    // The frame loop is about to run its ticks.
    loop() {
      looping = true;
    },
    // One turn of the frame loop, with how long its script took.
    frame(now: number, script: number) {
      looping = false;
      for (const clock of clocks) stop(clock);
      collect();
      // A hidden tab stops the loop; that gap isn't a frame.
      if (last !== null && now - last < 1000)
        segment.intervals.push(now - last);
      last = now;
      segment.scripts.push(script);
      for (const [name, ms] of parts) {
        const list = segment.parts.get(name) ?? [];
        list.push(ms);
        segment.parts.set(name, list);
      }
      parts = new Map();
      frame++;
    },
    // A setting the invite chose as it ran.
    note(name: string, value: number) {
      notes.set(name, value);
    },
    // Times one part of this frame's script.
    measure<T>(name: string, run: () => T): T {
      const started = performance.now();
      try {
        return run();
      } finally {
        parts.set(name, (parts.get(name) ?? 0) + performance.now() - started);
      }
    },
    // Times every render of a WebGL renderer, on the CPU and, where the
    // browser allows, on the GPU.
    watch(name: string, renderer: WebGLRenderer) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const timer = gl.getExtension(
        "EXT_disjoint_timer_query_webgl2",
      ) as Timer | null;
      const clock: Clock | null = timer
        ? { name, gl, timer, query: null }
        : null;
      if (clock) clocks.add(clock);
      const canvas = renderer.domElement;
      const describe = () =>
        canvases.set(name, {
          width: canvas.width,
          height: canvas.height,
          antialias: !!gl.getContextAttributes()?.antialias,
          samples: gl.getParameter(gl.SAMPLES) as number,
          gpuTiming: !!timer,
          live: true,
        });
      describe();
      const render = renderer.render.bind(renderer);
      renderer.render = (scene: Object3D, camera: Camera) => {
        // Each pass is kept apart: by the name its scene gives, or else as
        // drawn off screen or onto the canvas.
        const pass =
          (scene.userData.pass as string | undefined) ??
          (renderer.getRenderTarget() ? `${name}:target` : name);
        const frames =
          segment.renders.get(pass) ?? new Map<number, RenderFrame>();
        segment.renders.set(pass, frames);
        const into: RenderFrame = frames.get(frame) ?? {
          calls: 0,
          triangles: 0,
          cpu: 0,
        };
        frames.set(frame, into);
        if (clock && !clock.query) {
          clock.query = gl.createQuery();
          gl.beginQuery(clock.timer.TIME_ELAPSED_EXT, clock.query);
        }
        const started = performance.now();
        render(scene, camera);
        into.cpu += performance.now() - started;
        // Drawn outside the loop (a resize, a sky held still): timed alone.
        if (clock && !looping) stop(clock);
        into.calls += renderer.info.render.calls;
        into.triangles += renderer.info.render.triangles;
        if (canvas.width !== canvases.get(name)?.width) describe();
      };
      const dispose = renderer.dispose.bind(renderer);
      renderer.dispose = () => {
        const described = canvases.get(name);
        if (described) described.live = false;
        if (clock) {
          stop(clock);
          clocks.delete(clock);
        }
        dispose();
      };
    },
    report() {
      collect();
      return {
        when: new Date().toISOString(),
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        canvases: Object.fromEntries(canvases),
        notes: Object.fromEntries(notes),
        segments: segments
          .filter((each) => each.intervals.length || each.long.length)
          .map((each) => {
            const interval = stats(each.intervals);
            return {
              name: each.name,
              frames: each.intervals.length,
              fps: interval.mean ? round(1000 / interval.mean) : 0,
              interval: rounded(interval),
              // Frames that missed by a lot: over 25 and 50 ms.
              janky: {
                over25: each.intervals.filter((ms) => ms > 25).length,
                over50: each.intervals.filter((ms) => ms > 50).length,
              },
              script: rounded(stats(each.scripts)),
              parts: Object.fromEntries(
                [...each.parts].map(([name, values]) => [
                  name,
                  rounded(stats(values)),
                ]),
              ),
              gpu: Object.fromEntries(
                [...each.gpu].map(([name, values]) => [
                  name,
                  rounded(stats(values)),
                ]),
              ),
              renderers: Object.fromEntries(
                [...each.renders].map(([name, frames]) => {
                  const all = [...frames.values()];
                  return [
                    name,
                    {
                      frames: all.length,
                      calls: round(stats(all.map((one) => one.calls)).mean),
                      triangles: Math.round(
                        stats(all.map((one) => one.triangles)).mean,
                      ),
                      cpu: rounded(stats(all.map((one) => one.cpu))),
                    },
                  ];
                }),
              ),
              long: {
                count: each.long.length,
                total: round(
                  each.long.reduce((sum, one) => sum + one.duration, 0),
                ),
                max: round(
                  Math.max(0, ...each.long.map((one) => one.duration)),
                ),
                worst: [...each.long]
                  .sort((a, b) => b.duration - a.duration)
                  .slice(0, 3)
                  .map((one) => ({
                    duration: round(one.duration),
                    script: round(one.script),
                    layout: round(one.layout),
                    render: round(one.render),
                    top: one.top,
                  })),
              },
            };
          }),
      };
    },
    get phaseName() {
      return phase;
    },
  };
  return probe;
}

export type InvitePerf = ReturnType<typeof createProbe>;

export const perf: InvitePerf | null = enabled ? createProbe() : null;

if (perf)
  (window as unknown as { __invitePerf: InvitePerf }).__invitePerf = perf;

// Times one part of the frame's script while measuring; otherwise just runs.
export const measure = <T>(name: string, run: () => T): T =>
  perf ? perf.measure(name, run) : run();
