"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createSound, type Sound } from "./sound";

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

// The invite's sound: null until it has started, and while it's off.
// Sound is on by default, but a browser only lets it start from a tap,
// click, or key: the first one anywhere starts it. Catching the plane is
// the tap most people make first, so the flight is heard.
export function useSound() {
  const soundOn = useSyncExternalStore(subscribeSound, soundWanted, () => true);
  const engine = useRef<Sound | null>(null);
  const [sound, setSound] = useState<Sound | null>(null);
  useEffect(
    () => () => {
      engine.current?.close();
      engine.current = null;
    },
    [],
  );
  // Opening the audio device takes a good fraction of a second, so it's
  // done as the page loads, suspended, rather than in the tap that throws
  // the plane; the tap only resumes it.
  useEffect(() => {
    if (soundOn) engine.current ??= createSound();
  }, [soundOn]);
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
  return { sound: soundOn ? sound : null, soundOn, chooseSound };
}
