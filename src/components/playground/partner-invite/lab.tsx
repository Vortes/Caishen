"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "~/components/ui/button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import {
  choosePaper,
  defaultConfig,
  papers,
  knobGroups,
  readKnob,
  writeKnob,
  type Config,
  type Thrown,
} from "./config";
import { Scene, type Phase } from "./scene";
import styles from "./lab.module.css";

type Saved = { savedAt: string; config: Config };

const ENDPOINT = "/playground/partner-invite/configs";

const subscribeMotion = (onChange: () => void) => {
  const query = matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

export function PartnerInviteLab() {
  const [config, setConfig] = useState(defaultConfig);
  // Bumping the run remounts the scene, replaying from `start`.
  const [run, setRun] = useState({ id: 0, start: "arrive" as Phase });
  const [saved, setSaved] = useState<Saved[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );

  useEffect(() => {
    void fetch(ENDPOINT)
      .then((response) => response.json() as Promise<Saved[]>)
      .then(setSaved);
  }, []);

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

  const save = async () => {
    const json = JSON.stringify(config, null, 2);
    await navigator.clipboard.writeText(json).catch(() => undefined);
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: json,
    });
    const result = (await response.json()) as { path: string; saved: Saved[] };
    setSaved(result.saved);
    setStatus(`Saved to ${result.path} and copied`);
  };

  return (
    <div className={styles.lab}>
      <Scene
        key={run.id}
        config={config}
        startPhase={run.start}
        reducedMotion={reducedMotion}
        scrub={scrub}
        onRegenerate={regenerate}
      />
      <aside className={styles.panel} aria-label="Controls">
        <div className={styles.group}>
          <div className={styles.seedRow}>
            <span className={styles.seed}>Seed {config.seed}</span>
            <Button size="sm" onClick={regenerate}>
              New seed
            </Button>
          </div>
          <div className={styles.actions}>
            {(["arrive", "sign", "bond", "insert"] as const).map((phase) => (
              <Button
                key={phase}
                size="sm"
                variant="quiet"
                onClick={() => replay(phase)}
              >
                {phase === "arrive" ? "Replay" : `From ${phase}`}
              </Button>
            ))}
          </div>
          <label className={styles.knob}>
            <span className={styles.knobLabel}>
              Hold arrival at
              <span className={styles.knobValue}>
                {scrub === null ? "playing" : scrub.toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.005}
              value={scrub ?? 0}
              onChange={(event) => {
                if (scrub === null)
                  setRun((current) => ({
                    id: current.id + 1,
                    start: "arrive",
                  }));
                setScrub(Number(event.target.value));
              }}
            />
          </label>
        </div>

        <div className={styles.group}>
          <span className={styles.groupTitle}>Thrown from</span>
          <SegmentedControl
            fill
            aria-label="Thrown from"
            value={config.thrown}
            onValueChange={(value) =>
              apply({ ...config, thrown: value as Thrown })
            }
          >
            <SegmentedControlItem value="background">
              The far side
            </SegmentedControlItem>
            <SegmentedControlItem value="foreground">
              In front
            </SegmentedControlItem>
          </SegmentedControl>
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
          {saved.length > 0 && (
            <div className={styles.rail}>
              {saved.map((entry, index) => (
                <button
                  key={entry.savedAt}
                  type="button"
                  className={styles.railItem}
                  onClick={() => apply(entry.config)}
                >
                  #{index + 1} · seed {entry.config.seed}
                </button>
              ))}
            </div>
          )}
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
