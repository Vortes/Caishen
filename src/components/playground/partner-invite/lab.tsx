"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Volume2, VolumeOff } from "lucide-react";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { Switch } from "~/components/ui/switch";
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
import { createSound, type Sound } from "./sound";
import styles from "./lab.module.css";

const ENDPOINT = "/playground/partner-invite/configs";

const subscribeMotion = (onChange: () => void) => {
  const query = matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

// Sound is on unless you've turned it off here before.
const SOUND_KEY = "partner-invite-sound";
const soundListeners = new Set<() => void>();
const subscribeSound = (onChange: () => void) => {
  soundListeners.add(onChange);
  return () => soundListeners.delete(onChange);
};
const soundWanted = () => localStorage.getItem(SOUND_KEY) !== "off";
const wantSound = (on: boolean) => {
  localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  for (const listener of soundListeners) listener();
};
// The gestures a browser lets start sound.
const UNLOCKS = ["pointerdown", "pointerup", "keydown", "touchend"] as const;

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
  const [run, setRun] = useState({ id: 0, start: "invite" as Phase });
  const [status, setStatus] = useState<string | null>(null);
  const [scrub, setScrub] = useState<Scrub | null>(null);
  // On a phone the panel is a sheet over the stage, closed until asked for.
  const [controlsOpen, setControlsOpen] = useState(false);
  // On a wider screen it's docked beside the stage, and can be put away to
  // see the stage on its own.
  const [docked, setDocked] = useState(true);
  // Sound is on by default, but a browser only lets it start from a tap,
  // click, or key: the first one anywhere starts it. Catching the plane is
  // the tap most people make first, so the flight is heard.
  const soundOn = useSyncExternalStore(subscribeSound, soundWanted, () => true);
  const engine = useRef<Sound | null>(null);
  const [sound, setSound] = useState<Sound | null>(null);
  useEffect(() => () => engine.current?.close(), []);
  // Only ever called inside a tap, click, or key.
  const startSound = () => {
    engine.current ??= createSound();
    engine.current.start();
    setSound(engine.current);
  };
  useEffect(() => {
    if (!soundOn || sound) return;
    const unlock = () => {
      if (soundWanted()) startSound();
    };
    for (const type of UNLOCKS) document.addEventListener(type, unlock, true);
    return () => {
      for (const type of UNLOCKS)
        document.removeEventListener(type, unlock, true);
    };
  }, [soundOn, sound]);
  // Turning it on is itself a tap or click, so sound starts right away.
  const chooseSound = (on: boolean) => {
    wantSound(on);
    if (on) startSound();
    else engine.current?.stop();
  };
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );

  const replay = (start: Phase = "invite") => {
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
    <div className={styles.lab} data-undocked={!docked || undefined}>
      <Scene
        key={run.id}
        config={config}
        sky={sky}
        startPhase={run.start}
        reducedMotion={reducedMotion}
        scrub={scrub}
        sound={soundOn ? sound : null}
        onRegenerate={regenerate}
      />
      <div className={styles.mute}>
        <IconButton
          variant="secondary"
          label={soundOn ? "Mute" : "Unmute"}
          pressed={!soundOn}
          onClick={() => chooseSound(!soundOn)}
        >
          {soundOn ? <Volume2 /> : <VolumeOff />}
        </IconButton>
      </div>
      <div className={styles.dockToggle}>
        <Button
          size="sm"
          aria-expanded={docked}
          aria-controls="partner-invite-controls"
          onClick={() => setDocked((shown) => !shown)}
        >
          {docked ? "Hide controls" : "Controls"}
        </Button>
      </div>
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
          <label className={styles.seedRow}>
            <span className={styles.seed}>Sound</span>
            <Switch checked={soundOn} onCheckedChange={chooseSound} />
          </label>
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
              [
                "invite",
                "arrive",
                "sign",
                "bond",
                "take",
                "done",
                "partner",
              ] as const
            ).map((phase) => (
              <Button
                key={phase}
                size="sm"
                variant="quiet"
                onClick={() => replay(phase)}
              >
                {phase === "invite"
                  ? "Replay"
                  : phase === "arrive"
                    ? "From throw"
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
