import { useEffect, useRef } from "react";
import { cloudHit } from "./cloud";
import { clamp, easeInOut, type Config } from "./config";
import { airSeconds, flightPose, flightSeconds } from "./flight";
import { CAMERA_DISTANCE, SCENE } from "./geometry";
import { SEGMENTS } from "./plane-motion";
import { SHOWN, SLIDE_FROM, SLIDE_TO, STAMP, TAKE, TORN } from "./torn-card";
import type { Cue, Sound, Track } from "./sound";

// When each sound in the invite happens, read off the same timelines the
// scene is drawn from, so a retuned knob moves its sound with it.

// How fast an eased stretch is moving at `t`, from 0 (still) to 1 (its
// fastest).
const pace = (t: number) =>
  t <= 0 || t >= 1 ? 0 : (easeInOut(t + 0.005) - easeInOut(t - 0.005)) / 0.015;

// How fast an eased stretch is moving across it, sampled for the audio
// clock, from 0 (still) to 1 (its fastest).
const shape = (samples = 96) =>
  Array.from({ length: samples }, (_, i) => pace(i / (samples - 1)) / 2);

// Where the plane is on screen, roughly: its scale (1 at the card's size)
// and how far across, from -1 to 1.
function sighted(config: Config, t: number) {
  const pose = flightPose(config, t);
  const scale = CAMERA_DISTANCE / (CAMERA_DISTANCE - pose.z);
  const middle = SCENE.width / 2;
  return {
    scale,
    x: middle + (pose.x - middle) * scale,
    y: (pose.y - SCENE.height / 2) * scale,
    pan: clamp(((pose.x - middle) * scale) / middle, -1, 1),
  };
}

// The plane thrown from far off, through the cloud, onto the table, and
// opening into the card.
export function arrivalTrack(config: Config): Track {
  const air = airSeconds(config);
  const landed = flightSeconds(config);
  const { contact } = cloudHit(config);
  const panAt = (t: number) => sighted(config, t).pan;
  const cues: Cue[] = [];
  if (config.cloud.size > 0)
    cues.push({
      at: contact,
      play: (sound) => sound.poof(panAt(contact), config.cloud.poof),
    });
  cues.push({ at: air, play: (sound) => sound.touch(panAt(air)) });
  // Each fold starts a little before the last finishes, by the stagger;
  // the first, opening the body and turning the sheet over, is the
  // biggest.
  let start = 0;
  SEGMENTS.forEach((length, index) => {
    const from = Math.max(0, start - length * config.unfold.stagger);
    cues.push({
      at: landed + from * config.unfold.duration,
      play: (sound) => sound.unfold(index === 0 ? 1 : 0.45),
    });
    start += length;
  });
  cues.push({
    at: landed + 0.94 * config.unfold.duration,
    play: (sound) => sound.settle(),
  });

  return {
    cues,
    tick: (sound, t) => {
      if (t < air) {
        const here = sighted(config, t);
        const next = sighted(config, t + 1 / 60);
        const since = t - contact;
        sound.flight({
          scale: here.scale,
          speed: Math.hypot(next.x - here.x, next.y - here.y) * 60,
          approach: ((next.scale - here.scale) * 60) / here.scale,
          pan: here.pan,
          jolt:
            config.cloud.size > 0 && since > 0 ? Math.exp(-since / 0.25) : 0,
        });
        sound.skid(0, 0);
      } else {
        sound.flight({ scale: 0, speed: 0, approach: 0, pan: 0, jolt: 0 });
        // Friction bites hardest at first.
        const skidding = clamp((t - air) / Math.max(0.01, landed - air));
        sound.skid(t < landed ? (1 - skidding) ** 1.5 : 0, panAt(air));
      }
    },
  };
}

// The card tearing in two, the right half sliding over, and the seal.
export function bondTrack(config: Config, reducedMotion: boolean): Track {
  const tear = reducedMotion ? 0 : config.tear.duration;
  const bond = reducedMotion ? 0 : config.bondDuration;
  const slideFrom = SLIDE_FROM * tear;
  const slideTo = tear + SLIDE_TO * bond;
  const cues: Cue[] = [
    { at: tear + STAMP * bond, play: (sound) => sound.stamp() },
    { at: tear + TAKE[1] * bond, play: (sound) => sound.tack() },
  ];
  if (!reducedMotion)
    cues.push(
      {
        at: SHOWN * tear,
        play: (sound) => sound.tear(shape(), (TORN - SHOWN) * tear),
      },
      {
        at: slideFrom,
        play: (sound) => sound.slide(shape(), slideTo - slideFrom),
      },
      { at: slideTo, play: (sound) => sound.settle() },
    );
  return { cues };
}

// Waiting to be peeled: the corner curling up as the step begins, then
// flicking now and then.
export function curlTrack(timing: {
  delay: number;
  after: number;
  every: number;
  count: number;
}): Track {
  return {
    cues: [
      { at: timing.delay, play: (sound) => sound.curl(1) },
      ...Array.from({ length: timing.count }, (_, index) => ({
        at: timing.delay + timing.after + index * timing.every,
        play: (sound: Sound) => sound.curl(0.6),
      })),
    ],
  };
}

// From your half coming free to the clouds having parted on what's next.
export function endingTrack(
  config: Config,
  timing: {
    speed: number;
    rise: number;
    shimmer: readonly [number, number];
    genie: { at: number; seconds: number };
    filedAt: number;
    cloudsAt: number;
  },
): Track {
  const { genie, filedAt, cloudsAt } = timing;
  const { gather, partAt, part } = config.veil;
  const parting = cloudsAt + partAt;
  return {
    cues: [
      { at: 0, play: (sound) => sound.release(timing.speed) },
      { at: 0.05, play: (sound) => sound.rise(timing.rise) },
      {
        at: timing.shimmer[0],
        play: (sound) => sound.shimmer(timing.shimmer[1] - timing.shimmer[0]),
      },
      { at: genie.at, play: (sound) => sound.genie(genie.seconds) },
      { at: genie.at + genie.seconds, play: (sound) => sound.tuck() },
      {
        at: filedAt,
        play: (sound) => sound.filing(config.filed.duration),
      },
      { at: filedAt + config.filed.duration, play: (sound) => sound.filed() },
      { at: parting, play: (sound) => sound.part(part) },
      {
        at: parting + config.reveal.at * part,
        play: (sound) => sound.reveal(),
      },
    ],
    tick: (sound, t) => {
      const since = t - cloudsAt;
      const cover = easeInOut(clamp(since / gather));
      const open = clamp((since - partAt) / part);
      sound.veil(cover * (1 - open));
    },
  };
}

// Plays a track against its timeline's time. Cues fire as the time passes
// them; a held or rewound time fires nothing and silences what runs
// continuously.
export function useScore(
  sound: Sound | null,
  track: Track | null,
  t: number,
  playing: boolean,
) {
  const last = useRef<{
    track: Track | null;
    t: number;
    playing: boolean;
  } | null>(null);
  useEffect(() => {
    const previous = last.current;
    last.current = { track, t, playing };
    if (!sound || !track || !playing) {
      // Only on the way out, so it never cuts the pen or the peel short.
      if (previous?.track && previous.playing) sound?.hush();
      return;
    }
    // A track starting hears its first cues, even when its first frame is
    // late (the bond's is: its sheet is set up then); one joined well in,
    // as a replay from the parting does, only hears what comes next.
    const from = previous?.track === track ? previous.t : t < 1 ? -Infinity : t;
    if (t < from) return;
    for (const cue of track.cues)
      if (cue.at > from && cue.at <= t) cue.play(sound);
    track.tick?.(sound, t, clamp(t - (previous?.t ?? t), 0, 0.1));
  }, [sound, track, t, playing]);
  useEffect(() => () => sound?.hush(), [sound]);
}
