"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "~/components/ui/button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import {
  choosePaper,
  papers,
  knobGroups,
  readKnob,
  writeKnob,
  type Config,
} from "./config";
import { endingSeconds, Scene, type Phase, type Scrub } from "./scene";
import type { SkyTime } from "./sky";
import styles from "./lab.module.css";

const ENDPOINT = "/playground/partner-invite/configs";

const subscribeMotion = (onChange: () => void) => {
  const query = matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

// The ending steps a frame at a time, at 60 frames a second.
const FPS = 60;

export function PartnerInviteLab({
  initialSky,
  initialConfig,
}: {
  initialSky: SkyTime;
  initialConfig: Config;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [sky, setSky] = useState(initialSky);
  // Bumping the run remounts the scene, replaying from `start`.
  const [run, setRun] = useState({ id: 0, start: "arrive" as Phase });
  const [status, setStatus] = useState<string | null>(null);
  const [scrub, setScrub] = useState<Scrub | null>(null);
  // On a phone the panel is a sheet over the stage, closed until asked for.
  const [controlsOpen, setControlsOpen] = useState(false);
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );

  const replay = (start: Phase = "arrive") => {
    setScrub(null);
    setRun((current) => ({ id: current.id + 1, start }));
  };
  const regenerate = () => {
    setConfig((current) => ({
      ...current,
      seed: Math.floor(Math.random() * 100000),
    }));
    replay();
  };
  const apply = (next: Config) => {
    setConfig(next);
    replay();
  };

  // The sky rides in the URL, so a night link opens at night.
  const chooseSky = (next: SkyTime) => {
    setSky(next);
    const url = new URL(location.href);
    if (next === "night") url.searchParams.set("sky", "night");
    else url.searchParams.delete("sky");
    history.replaceState(null, "", url);
  };

  // Holding the ending replays it from your half coming free, then holds
  // the frame asked for.
  const endingFrames = Math.ceil(endingSeconds(config) * FPS);
  const endingFrame =
    scrub?.phase === "ending" ? Math.round(scrub.at * FPS) : null;
  const holdEnding = (frame: number) => {
    if (endingFrame === null)
      setRun((current) => ({ id: current.id + 1, start: "taking" }));
    const clamped = Math.min(Math.max(frame, 0), endingFrames);
    setScrub({ phase: "ending", at: clamped / FPS });
  };

  const save = async () => {
    const json = JSON.stringify(config, null, 2);
    await navigator.clipboard.writeText(json).catch(() => undefined);
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: json,
    });
    const result = (await response.json()) as { path: string };
    setStatus(`Saved to ${result.path} and copied`);
  };

  return (
    <div className={styles.lab}>
      <Scene
        key={run.id}
        config={config}
        sky={sky}
        startPhase={run.start}
        reducedMotion={reducedMotion}
        scrub={scrub}
        onRegenerate={regenerate}
      />
      <div className={styles.controlsToggle}>
        <Button
          size="sm"
          aria-expanded={controlsOpen}
          aria-controls="partner-invite-controls"
          onClick={() => setControlsOpen((open) => !open)}
        >
          {controlsOpen ? "Done" : "Controls"}
        </Button>
      </div>
      <aside
        id="partner-invite-controls"
        className={styles.panel}
        data-open={controlsOpen || undefined}
        aria-label="Controls"
      >
        <div className={styles.group}>
          <SegmentedControl
            aria-label="Sky"
            fill
            value={sky}
            onValueChange={(value) => chooseSky(value as SkyTime)}
          >
            <SegmentedControlItem value="day">Day</SegmentedControlItem>
            <SegmentedControlItem value="night">Night</SegmentedControlItem>
          </SegmentedControl>
          {(
            [
              ["haze", "Haze", 0, 1, 0.01],
              ["drift", "Cloud drift (× speed)", 0, 10, 0.1],
              ["clouds", "Background clouds", 0, 1, 0.01],
            ] as const
          )
            .filter(([key]) => key !== "haze" || sky === "day")
            .map(([key, label, min, max, step]) => (
              <label key={key} className={styles.knob}>
                <span className={styles.knobLabel}>
                  {label}
                  <span className={styles.knobValue}>
                    {Number(config.sky[key].toFixed(2))}
                  </span>
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={config.sky[key]}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      sky: { ...config.sky, [key]: Number(event.target.value) },
                    })
                  }
                />
              </label>
            ))}
          <div className={styles.seedRow}>
            <span className={styles.seed}>Seed {config.seed}</span>
            <Button size="sm" onClick={regenerate}>
              New seed
            </Button>
          </div>
          <div className={styles.actions}>
            {(
              ["arrive", "sign", "bond", "take", "done", "partner"] as const
            ).map((phase) => (
              <Button
                key={phase}
                size="sm"
                variant="quiet"
                onClick={() => replay(phase)}
              >
                {phase === "arrive"
                  ? "Replay"
                  : phase === "done"
                    ? "From parting"
                    : phase === "partner"
                      ? "Partner page"
                      : `From ${phase}`}
              </Button>
            ))}
          </div>
          {(
            [
              ["arrive", "Hold arrival at"],
              ["bond", "Hold bond at"],
            ] as const
          ).map(([phase, label]) => {
            const held = scrub?.phase === phase ? scrub.at : null;
            return (
              <label key={phase} className={styles.knob}>
                <span className={styles.knobLabel}>
                  {label}
                  <span className={styles.knobValue}>
                    {held === null ? "playing" : held.toFixed(2)}
                  </span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.005}
                  value={held ?? 0}
                  onChange={(event) => {
                    if (held === null)
                      setRun((current) => ({
                        id: current.id + 1,
                        start: phase,
                      }));
                    setScrub({ phase, at: Number(event.target.value) });
                  }}
                />
              </label>
            );
          })}
          <label className={styles.knob}>
            <span className={styles.knobLabel}>
              Hold ending at
              <span className={styles.knobValue}>
                {endingFrame === null
                  ? "playing"
                  : `frame ${endingFrame} · ${(endingFrame / FPS).toFixed(2)}s`}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={endingFrames}
              step={1}
              value={endingFrame ?? 0}
              onChange={(event) => holdEnding(Number(event.target.value))}
            />
          </label>
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="quiet"
              aria-label="Previous frame"
              onClick={() => holdEnding((endingFrame ?? 0) - 1)}
            >
              ‹ Frame
            </Button>
            <Button
              size="sm"
              variant="quiet"
              aria-label="Next frame"
              onClick={() => holdEnding((endingFrame ?? 0) + 1)}
            >
              Frame ›
            </Button>
            <Button
              size="sm"
              variant="quiet"
              disabled={endingFrame === null}
              onClick={() => replay("taking")}
            >
              Play ending
            </Button>
          </div>
        </div>

        <div className={styles.group}>
          <span className={styles.groupTitle}>
            Jordan’s paper, chosen when they sent the invite
          </span>
          <div className={styles.papers} role="radiogroup" aria-label="Paper">
            {papers.map((paper) => {
              const chosen =
                paper.pattern === config.pattern &&
                paper.washi.hue === config.washi.hue &&
                paper.washi.lightness === config.washi.lightness;
              return (
                <button
                  key={paper.name}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  className={styles.paper}
                  onClick={() => apply(choosePaper(config, paper.name))}
                >
                  <span
                    className={styles.swatch}
                    style={{
                      background: `oklch(${paper.washi.lightness} ${paper.washi.chroma} ${paper.washi.hue})`,
                      borderColor: `oklch(${paper.washi.inkLightness} 0.08 ${paper.washi.inkHue})`,
                    }}
                  />
                  {paper.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.group}>
          <Button variant="primary" onClick={() => void save()}>
            Save config
          </Button>
          {status && <span className={styles.status}>{status}</span>}
        </div>

        {knobGroups.map((group) => (
          <fieldset key={group.title} className={styles.group}>
            <legend className={styles.groupTitle}>{group.title}</legend>
            {group.knobs.map((knob) => {
              const value = readKnob(config, knob.path);
              return (
                <label key={knob.path} className={styles.knob}>
                  <span className={styles.knobLabel}>
                    {knob.label}
                    <span className={styles.knobValue}>
                      {Number(value.toFixed(3))}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={knob.min}
                    max={knob.max}
                    step={knob.step}
                    value={value}
                    onChange={(event) =>
                      setConfig(
                        writeKnob(
                          config,
                          knob.path,
                          Number(event.target.value),
                        ),
                      )
                    }
                  />
                </label>
              );
            })}
          </fieldset>
        ))}
      </aside>
    </div>
  );
}
