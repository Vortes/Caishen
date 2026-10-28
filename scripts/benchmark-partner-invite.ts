// Plays the partner invite start to finish in Chrome, the way a person
// would, and reports how each part of it performed: the line forming and
// sitting in the sky, a pointer breathing on it, the stage resizing (a
// phone's address bar), the throw, signing, the bond, the peel, and the
// clouds parting. Figures come from the page's own probe (?perf): frame
// pacing, script time by part, GPU time and draw calls per WebGL canvas,
// and long frames.
//
// Frames keep to the display's refresh, as people see them; GPU timer
// queries give each canvas's cost under the cap. --uncapped lifts it, but
// then the GPU's queue backs up and stalls frames in ways nobody sees. The phone profile is a 393 × 852 screen at 3× with the CPU
// slowed 4×, which stands in for a mid-range phone's script, not its GPU.
//
// Point it at a running dev server (the playground is served only in
// development). Its script figures carry React's development overhead, so
// compare runs against each other, not against production.
// Usage: npm run benchmark:invite -- [--url http://localhost:3000]
//   [--profile desktop|phone|all] [--sky day|night|all] [--runs 1]
//   [--uncapped] [--headed] [--out report.json] [--compare before.json]
// With --compare, the summary sets each figure beside the same figure
// from an earlier --out report.
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { chromium, type Page } from "@playwright/test";

const { values: options } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:3000" },
    profile: { type: "string", default: "all" },
    sky: { type: "string", default: "day" },
    runs: { type: "string", default: "1" },
    uncapped: { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    out: { type: "string" },
    compare: { type: "string" },
  },
});

const PROFILES = {
  desktop: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    cpu: 1,
  },
  phone: {
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    cpu: 4,
  },
};
type Profile = keyof typeof PROFILES;

const pick = <T extends string>(value: string, all: readonly T[]) =>
  value === "all" ? [...all] : [value as T];
const profiles = pick<Profile>(options.profile, ["desktop", "phone"]);
const skies = pick(options.sky, ["day", "night"] as const);
const runs = Number(options.runs);

type Report = {
  canvases: Record<string, unknown>;
  segments: {
    name: string;
    frames: number;
    fps: number;
    interval: { p50: number; p95: number; max: number };
    janky: { over25: number; over50: number };
    script: { mean: number; p95: number };
    parts: Record<string, { mean: number; p95: number; max: number }>;
    gpu: Record<string, { mean: number; p95: number }>;
    renderers: Record<
      string,
      { calls: number; cpu: { mean: number; max: number } }
    >;
    long: {
      count: number;
      total: number;
      max: number;
      worst: {
        duration: number;
        script: number;
        layout: number;
        render: number;
        top: string | null;
      }[];
    };
  }[];
};

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const mark = (page: Page, name: string) =>
  page.evaluate((label) => window.__invitePerf.mark(label), name);
const phase = (page: Page, name: string, timeout = 30_000) =>
  page.waitForFunction((step) => window.__invitePerf.phaseName === step, name, {
    timeout,
    polling: 50,
  });
// A point in the scene's coordinates (1200 × 760, the card landing at
// 600, 360), on screen.
const onScreen = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([sx, sy]) => {
      const svg = document.querySelector<SVGSVGElement>('svg[role="img"]')!;
      const point = new DOMPoint(sx, sy).matrixTransform(svg.getScreenCTM()!);
      return { x: point.x, y: point.y };
    },
    [x, y] as const,
  );
// Moves the mouse through scene points, a step every frame or so.
async function trace(
  page: Page,
  points: { x: number; y: number }[],
  stepMs = 16,
) {
  for (const point of points) {
    const at = await onScreen(page, point.x, point.y);
    await page.mouse.move(at.x, at.y);
    await wait(stepMs);
  }
}

async function play(page: Page, profile: Profile) {
  const { viewport } = PROFILES[profile];
  await phase(page, "invite");
  await mark(page, "invite:forming");
  await wait(3000);
  await mark(page, "invite:idle");
  await wait(4000);

  // Breathing on the line: slow loops across where it's written.
  await mark(page, "invite:breath");
  for (let i = 0; i <= 240; i++) {
    const t = i / 240;
    await page.mouse.move(
      viewport.width * (0.15 + 0.7 * t),
      viewport.height * (0.4 + 0.08 * Math.sin(t * Math.PI * 6)),
    );
    await wait(16);
  }
  await page.mouse.move(viewport.width * 0.5, viewport.height * 0.95);
  await wait(500);

  // The address bar coming and going.
  await mark(page, "invite:resize");
  await page.setViewportSize({ ...viewport, height: viewport.height - 60 });
  await wait(1000);
  await page.setViewportSize(viewport);
  await wait(1000);

  // The throw.
  await page.mouse.click(viewport.width * 0.5, viewport.height * 0.6);
  await phase(page, "sign");
  await wait(2000);

  await mark(page, "sign:drawing");
  const signature = Array.from({ length: 60 }, (_, i) => ({
    x: 660 + i * 3,
    y: 440 + 12 * Math.sin(i * 0.5),
  }));
  const start = await onScreen(page, signature[0]!.x, signature[0]!.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await trace(page, signature);
  await page.mouse.up();
  await mark(page, "sign:idle");
  await wait(2000);

  await page.getByRole("button", { name: "Sign", exact: true }).click();
  await phase(page, "take");
  await wait(1500);

  // Peeling your half off, up and away to the right.
  const grip = { x: 760, y: 380 };
  const from = await onScreen(page, grip.x, grip.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await trace(
    page,
    Array.from({ length: 30 }, (_, i) => ({
      x: grip.x + (i + 1) * 18,
      y: grip.y - (i + 1) * 6,
    })),
  );
  await page.mouse.up();
  await phase(page, "done");
  await wait(4000);
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: !options.headed,
  args: [
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    ...(options.uncapped
      ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"]
      : []),
  ],
});

type Result = { profile: Profile; sky: string; run: number; report: Report };
const results: Result[] = [];
try {
  for (const profile of profiles) {
    for (const sky of skies) {
      for (let run = 1; run <= runs; run++) {
        const { cpu, ...device } = PROFILES[profile];
        const context = await browser.newContext(device);
        const page = await context.newPage();
        if (cpu > 1) {
          const session = await context.newCDPSession(page);
          await session.send("Emulation.setCPUThrottlingRate", { rate: cpu });
        }
        await page.goto(
          `${options.url}/playground/partner-invite?perf&sky=${sky}`,
        );
        await play(page, profile);
        const report = (await page.evaluate(() =>
          window.__invitePerf.report(),
        )) as Report;
        results.push({ profile, sky, run, report });
        print(`${profile} · ${sky} · run ${run}`, report);
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
if (options.out) writeFileSync(options.out, JSON.stringify(results, null, 2));
summarize(
  results,
  options.compare
    ? (JSON.parse(readFileSync(options.compare, "utf8")) as Result[])
    : null,
);

// Each segment's figures, the median over runs: frame pacing, script, GPU
// (every canvas, summed), and the longest frame.
function medians(all: Result[]) {
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : NaN;
  };
  const grouped = new Map<string, Report["segments"]>();
  for (const { profile, sky, report } of all)
    for (const segment of report.segments) {
      const key = `${profile} · ${sky} · ${segment.name}`;
      grouped.set(key, [...(grouped.get(key) ?? []), segment]);
    }
  return new Map(
    [...grouped].map(([key, segments]) => [
      key,
      {
        "frame p95": median(segments.map((each) => each.interval.p95)),
        ">50ms": median(segments.map((each) => each.janky.over50)),
        script: median(segments.map((each) => each.script.mean)),
        gpu: median(
          segments.map((each) =>
            Object.values(each.gpu).reduce(
              (sum, canvas) => sum + canvas.mean,
              0,
            ),
          ),
        ),
        "long max": median(segments.map((each) => each.long.max)),
      },
    ]),
  );
}

function summarize(after: Result[], before: Result[] | null) {
  const now = medians(after);
  const then = before ? medians(before) : null;
  const shown = (value: number | undefined) =>
    value === undefined || Number.isNaN(value) ? "–" : value.toFixed(1);
  console.log(
    `\nSummary, median of runs${then ? `, against ${options.compare}` : ""}`,
  );
  console.table(
    Object.fromEntries(
      [...now].map(([key, figures]) => [
        key,
        Object.fromEntries(
          Object.entries(figures).map(([name, value]) => {
            const earlier = then?.get(key)?.[name as keyof typeof figures];
            return [
              name,
              then ? `${shown(earlier)} → ${shown(value)}` : shown(value),
            ];
          }),
        ),
      ]),
    ),
  );
}

function print(title: string, report: Report) {
  console.log(`\n${title}`);
  console.log(JSON.stringify(report.canvases));
  const fixed = (value: number | undefined, digits = 1) =>
    value === undefined ? "–" : value.toFixed(digits);
  console.table(
    Object.fromEntries(
      report.segments.map((segment) => {
        const gpu = (name: string) => segment.gpu[name]?.mean;
        const calls = Object.values(segment.renderers).reduce(
          (sum, each) => sum + each.calls,
          0,
        );
        return [
          segment.name,
          {
            fps: Math.round(segment.fps),
            "frame p50": fixed(segment.interval.p50),
            "frame p95": fixed(segment.interval.p95),
            "frame max": fixed(segment.interval.max),
            ">50ms": segment.janky.over50,
            script: fixed(segment.script.mean, 2),
            "script p95": fixed(segment.script.p95, 2),
            "sky gpu": fixed(gpu("sky"), 2),
            "writing gpu": fixed(gpu("skywriting"), 2),
            "plane gpu": fixed(gpu("plane"), 2),
            calls,
            "long max": fixed(segment.long.max, 0),
          },
        ];
      }),
    ),
  );
  const parts = report.segments.flatMap((segment) =>
    Object.entries(segment.parts).map(([part, timing]) => ({
      segment: segment.name,
      part,
      mean: fixed(timing.mean, 2),
      p95: fixed(timing.p95, 2),
      max: fixed(timing.max, 1),
    })),
  );
  if (parts.length) console.table(parts);
  const worst = report.segments.flatMap((segment) =>
    segment.long.worst
      .filter((frame) => frame.duration > 100)
      .map((frame) => ({ segment: segment.name, ...frame })),
  );
  if (worst.length) console.table(worst);
}

declare global {
  interface Window {
    __invitePerf: {
      mark(name: string): void;
      phaseName: string;
      report(): unknown;
    };
  }
}
