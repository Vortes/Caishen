import { useEffect, useRef } from "react";
import { cloudHit } from "./cloud";
import { config } from "./config";
import { airSeconds, flightPose, flightSeconds } from "./flight";
import { CAMERA_DISTANCE, SCENE } from "./geometry";
import { clamp, easeInOut } from "./motion";
import { SEGMENTS } from "./plane-motion";
import type { Cue, Sound, Track } from "./sound";
import { ending, timeline } from "./timeline";

// When each sound in the invite happens, read off the same timelines the
// scene is drawn from, so a retimed step moves its sound with it.

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
function sighted(t: number) {
  const pose = flightPose(t);
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
export function arrivalTrack(): Track {
  const air = airSeconds();
  const landed = flightSeconds();
  const { contact } = cloudHit();
  const { duration, stagger } = timeline.unfold;
  const panAt = (t: number) => sighted(t).pan;
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
    const from = Math.max(0, start - length * stagger);
    cues.push({
      at: landed + from * duration,
      play: (sound) => sound.unfold(index === 0 ? 1 : 0.45),
    });
    start += length;
  });
  cues.push({
    at: landed + 0.94 * duration,
    play: (sound) => sound.settle(),
  });

  return {
    cues,
    tick: (sound, t) => {
      if (t < air) {
        const here = sighted(t);
        const next = sighted(t + 1 / 60);
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
export function bondTrack(reducedMotion: boolean): Track {
  const { shown, torn, slideFrom: tornBy } = timeline.tear;
  const { slideTo: bondBy, stamp, take } = timeline.bond;
  const tear = reducedMotion ? 0 : timeline.tear.duration;
  const bond = reducedMotion ? 0 : timeline.bond.duration;
  const slideFrom = tornBy * tear;
  const slideTo = tear + bondBy * bond;
  const cues: Cue[] = [
    { at: tear + stamp * bond, play: (sound) => sound.stamp() },
    { at: tear + take[1] * bond, play: (sound) => sound.tack() },
  ];
  if (!reducedMotion)
    cues.push(
      {
        at: shown * tear,
        play: (sound) => sound.tear(shape(), (torn - shown) * tear),
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
export function curlTrack(): Track {
  const { delay } = timeline.curl;
  const { after, every, count } = timeline.flick;
  return {
    cues: [
      { at: delay, play: (sound) => sound.curl(1) },
      ...Array.from({ length: count }, (_, index) => ({
        at: delay + after + index * every,
        play: (sound: Sound) => sound.curl(0.6),
      })),
    ],
  };
}

// From your half coming free to the clouds having parted on what's next.
// `speed` is how fast your half's tip was going when it came free (px/s).
export function endingTrack(speed: number): Track {
  const { rise, shimmer, genie } = timeline.keep;
  const { filedAt, cloudsAt } = ending;
  const { gather, partAt, part } = timeline.veil;
  const filed = timeline.filed.duration;
  const parting = cloudsAt + partAt;
  return {
    cues: [
      { at: 0, play: (sound) => sound.release(speed) },
      { at: 0.05, play: (sound) => sound.rise(rise) },
      {
        at: shimmer[0],
        play: (sound) => sound.shimmer(shimmer[1] - shimmer[0]),
      },
      { at: genie.at, play: (sound) => sound.genie(genie.seconds) },
      { at: genie.at + genie.seconds, play: (sound) => sound.tuck() },
      { at: filedAt, play: (sound) => sound.filing(filed) },
      { at: filedAt + filed, play: (sound) => sound.filed() },
      { at: parting, play: (sound) => sound.part(part) },
      {
        at: parting + timeline.reveal.at * part,
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

// Plays a track against its timeline's time, called once a frame. Cues
// fire as the time passes them; once there's no track, whatever runs
// continuously is hushed.
export function useScore(sound: Sound | null) {
  const last = useRef<{ track: Track | null; t: number } | null>(null);
  useEffect(() => () => sound?.hush(), [sound]);
  return (track: Track | null, t: number) => {
    const previous = last.current;
    last.current = { track, t };
    if (!sound || !track) {
      // Only on the way out, so it never cuts the pen or the peel short.
      if (previous?.track) sound?.hush();
      return;
    }
    // A track starting hears its first cues, even when its first frame is
    // late (the bond's is: its sheet is set up then); one joined well in
    // only hears what comes next.
    const from = previous?.track === track ? previous.t : t < 1 ? -Infinity : t;
    if (t < from) return;
    for (const cue of track.cues)
      if (cue.at > from && cue.at <= t) cue.play(sound);
    track.tick?.(sound, t, clamp(t - (previous?.t ?? t), 0, 0.1));
  };
}
