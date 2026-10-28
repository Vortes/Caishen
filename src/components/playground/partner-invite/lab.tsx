"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Volume2, VolumeOff } from "lucide-react";
import { IconButton } from "~/components/ui/icon-button";
import type { Config } from "./config";
import { Scene } from "./scene";
import type { SkyTime } from "./sky";
import { createSound, type Sound } from "./sound";
import styles from "./lab.module.css";

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

export function PartnerInviteLab({
  sky,
  config,
}: {
  sky: SkyTime;
  config: Config;
}) {
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

  return (
    <>
      <Scene
        config={config}
        sky={sky}
        reducedMotion={reducedMotion}
        sound={soundOn ? sound : null}
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
    </>
  );
}
