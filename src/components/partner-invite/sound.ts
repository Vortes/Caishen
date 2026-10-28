// The partner invite, heard. Everything is synthesized from noise and a few
// sine partials, so nothing loads and every sound can follow the scene's
// numbers: the plane's whoosh rises and falls with how near and how fast it
// is, the pen scratches as fast as you write, the peel crackles as fast as
// it comes away. Paper is mostly quiet in life; here it's a little louder
// than life, and everything else stays soft.

// One stereo voice that runs the whole time: looped noise through a filter,
// its level and color steered every frame.
// With `hold`, it fades out that many seconds later unless set again: for
// voices steered by pointer events, which stop coming when the pointer does.
type Voice = {
  set: (level: number, frequency?: number, pan?: number, hold?: number) => void;
  amp: GainNode;
};

type Burst = {
  at?: number;
  length: number;
  filter: BiquadFilterType;
  frequency: number;
  // Where the filter sweeps to over the burst.
  to?: number;
  q?: number;
  gain: number;
  attack?: number;
  pan?: number;
  // How much of it goes to the room.
  room?: number;
};

type Tone = {
  at?: number;
  frequency: number;
  to?: number;
  length: number;
  gain: number;
  attack?: number;
  type?: OscillatorType;
  pan?: number;
  room?: number;
};

// A Japanese-ish pentatonic on E, for the few moments that ring.
const E6 = 1318.5;
const ring = (step: number) => E6 * 2 ** ([0, 4, 7, 9, 12, 16][step]! / 12);

export type Sound = ReturnType<typeof createSound>;

// Everything here is synthesized, so it's made at 48 kHz whatever the
// output runs at: on a 192 kHz device the noise and the room's tail would
// otherwise take four times as long to build.
export function createSound() {
  const context = new AudioContext({
    latencyHint: "interactive",
    sampleRate: 48000,
  });
  const now = () => context.currentTime;

  // Clouds closing over the stage muffle everything; this is that muffle.
  const muffle = context.createBiquadFilter();
  muffle.type = "lowpass";
  muffle.frequency.value = 18000;
  muffle.Q.value = 0.5;
  const master = context.createGain();
  master.gain.value = 0;
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 10;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  muffle.connect(master).connect(limiter).connect(context.destination);

  const white = noiseBuffer(context, 3);
  // A little open air around the things that ring.
  const room = context.createConvolver();
  room.buffer = impulse(context, 2.6, 3.2);
  const roomDark = context.createBiquadFilter();
  roomDark.type = "lowpass";
  roomDark.frequency.value = 4200;
  const roomReturn = context.createGain();
  roomReturn.gain.value = 0.5;
  room.connect(roomDark).connect(roomReturn).connect(muffle);

  const route = (node: AudioNode, pan: number, send: number) => {
    const panner = context.createStereoPanner();
    panner.pan.value = clampPan(pan);
    node.connect(panner).connect(muffle);
    if (send > 0) {
      const wet = context.createGain();
      wet.gain.value = send;
      panner.connect(wet).connect(room);
    }
  };

  const burst = ({
    at = now(),
    length,
    filter,
    frequency,
    to,
    q = 1,
    gain,
    attack = 0.002,
    pan = 0,
    room: send = 0,
  }: Burst) => {
    const source = context.createBufferSource();
    source.buffer = white;
    source.loop = true;
    const band = context.createBiquadFilter();
    band.type = filter;
    band.Q.value = q;
    band.frequency.setValueAtTime(frequency, at);
    if (to) band.frequency.exponentialRampToValueAtTime(to, at + length);
    const amp = envelope(context, at, attack, length, gain);
    source.connect(band).connect(amp);
    route(amp, pan, send);
    source.start(at, Math.random() * white.duration);
    source.stop(at + length + 0.05);
  };

  const tone = ({
    at = now(),
    frequency,
    to,
    length,
    gain,
    attack = 0.004,
    type = "sine",
    pan = 0,
    room: send = 0,
  }: Tone) => {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    if (to) oscillator.frequency.exponentialRampToValueAtTime(to, at + length);
    const amp = envelope(context, at, attack, length, gain);
    oscillator.connect(amp);
    route(amp, pan, send);
    oscillator.start(at);
    oscillator.stop(at + length + 0.05);
  };

  // Paper fibers giving way: a scatter of tiny clicks, each a few
  // milliseconds of noise at its own pitch.
  const crackle = (
    count: number,
    spread: number,
    {
      at = now(),
      low = 1500,
      high = 6500,
      gain = 0.2,
      pan = 0,
    }: {
      at?: number;
      low?: number;
      high?: number;
      gain?: number;
      pan?: number;
    } = {},
  ) => {
    for (let i = 0; i < count; i++)
      burst({
        at: at + Math.random() * spread,
        length: 0.004 + Math.random() * 0.01,
        filter: "bandpass",
        frequency: low * (high / low) ** Math.random(),
        q: 2.5,
        gain: gain * (0.25 + Math.random() * 0.75),
        pan: pan + (Math.random() - 0.5) * 0.3,
      });
  };

  const voice = (
    filter: BiquadFilterType,
    frequency: number,
    q: number,
    smoothing = 0.03,
  ): Voice & { band: BiquadFilterNode; panner: StereoPannerNode } => {
    const source = context.createBufferSource();
    source.buffer = white;
    source.loop = true;
    const band = context.createBiquadFilter();
    band.type = filter;
    band.frequency.value = frequency;
    band.Q.value = q;
    const amp = context.createGain();
    amp.gain.value = 0;
    const panner = context.createStereoPanner();
    source.connect(band).connect(amp).connect(panner).connect(muffle);
    source.start(0, Math.random() * white.duration);
    return {
      band,
      amp,
      panner,
      set: (level, to, pan, hold) => {
        const at = now();
        amp.gain.cancelScheduledValues(at);
        amp.gain.setTargetAtTime(level, at, smoothing);
        if (hold !== undefined)
          amp.gain.setTargetAtTime(0, at + hold, smoothing * 2);
        if (to !== undefined) band.frequency.setTargetAtTime(to, at, smoothing);
        if (pan !== undefined)
          panner.pan.setTargetAtTime(clampPan(pan), at, smoothing);
      },
    };
  };

  // The sky: wind, slowly breathing. Darker and quieter at night.
  const wind = voice("lowpass", 600, 0.4, 0.4);
  const breath = context.createOscillator();
  breath.frequency.value = 0.07;
  const breathDepth = context.createGain();
  breathDepth.gain.value = 160;
  breath.connect(breathDepth).connect(wind.band.frequency);
  breath.start();
  // The bank of cloud rolling in: a low roar under the wind.
  const roar = voice("lowpass", 150, 0.7, 0.12);
  let night = false;
  let cover = 0;
  const settleSky = () => {
    const closed = cover;
    wind.set(
      (night ? 0.05 : 0.07) * (1 + 2.2 * closed),
      (night ? 380 : 620) + 900 * closed,
    );
    roar.set(0.5 * closed);
    muffle.frequency.setTargetAtTime(
      18000 * (650 / 18000) ** (closed * 0.85),
      now(),
      0.08,
    );
  };

  // The plane through the air. A paper plane is all but silent: a soft,
  // breathy rush as it passes close, and its paper edges fluttering, a
  // fast, uneven brr. Two slightly detuned beats make the flutter uneven,
  // the way paper never flaps in time.
  const air = voice("lowpass", 500, 0.3, 0.05);
  const edges = voice("bandpass", 1900, 3, 0.05);
  const flaps = [13, 17.3].map((rate) => {
    const beat = context.createOscillator();
    beat.frequency.value = rate;
    const depth = context.createGain();
    depth.gain.value = 0;
    beat.connect(depth).connect(edges.amp.gain);
    beat.start();
    return { beat, depth };
  });

  // Paper against paper or a table: the skid, the slide, the pen, the peel.
  const skid = voice("bandpass", 2600, 0.6);
  const nib = voice("bandpass", 4200, 1.2, 0.015);
  const peel = voice("highpass", 2400, 0.7, 0.015);
  // Cloud breathed away by the pointer: a soft, airy exhale.
  const exhale = voice("bandpass", 700, 0.5, 0.08);
  const continuous = [air, edges, skid, nib, peel, exhale];
  // The tear and the slide run on the audio clock, laid out in full when
  // they start, so a busy frame (the bond's first ones are) can't make
  // them stutter. They end at silence on their own.
  const slide = voice("bandpass", 1300, 0.5);
  const shaped = (
    target: ReturnType<typeof voice>,
    curve: number[],
    seconds: number,
    level: number,
    [low, high]: [number, number],
  ) => {
    const at = now() + 0.01;
    for (const param of [target.amp.gain, target.band.frequency])
      param.cancelScheduledValues(0);
    target.amp.gain.setValueCurveAtTime(
      Float32Array.from(curve, (value) => value * level),
      at,
      seconds,
    );
    target.band.frequency.setValueCurveAtTime(
      Float32Array.from(curve, (value) => low + (high - low) * value),
      at,
      seconds,
    );
    return at;
  };

  // Crackles at a rate (per second) over the last frame, landing just
  // ahead so they never bunch up at the start of a frame.
  const grains = (
    rate: number,
    dt: number,
    options: Parameters<typeof crackle>[2],
  ) => {
    const expected = rate * dt;
    const count = Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0);
    if (count > 0) crackle(count, dt, { ...options, at: now() + 0.01 });
  };

  let on = false;

  return {
    get on() {
      return on;
    },
    // Starting has to happen inside a click or tap.
    start() {
      on = true;
      void context.resume();
      master.gain.setTargetAtTime(0.9, now(), 0.05);
      settleSky();
    },
    stop() {
      on = false;
      master.gain.setTargetAtTime(0, now(), 0.05);
      setTimeout(() => {
        if (!on) void context.suspend();
      }, 300);
    },
    // Everything that runs continuously, silenced: a held frame, or a
    // scene starting over.
    hush() {
      for (const each of continuous) each.set(0);
      cover = 0;
      settleSky();
      for (const { depth } of flaps) depth.gain.setTargetAtTime(0, now(), 0.03);
    },

    sky(isNight: boolean) {
      night = isNight;
      settleSky();
    },
    // How far the clouds have closed over the stage, net of their parting.
    veil(closed: number) {
      if (Math.abs(closed - cover) < 0.002) return;
      cover = closed;
      settleSky();
    },

    // The plane in flight: how near (its scale on screen, 1 at the card's
    // size), how fast across the screen (px/s), how fast it's coming at
    // you (fraction of its scale a second), where across the screen (-1 to
    // 1), and how hard it's being knocked about (0 to 1).
    flight({
      scale,
      speed,
      approach,
      pan,
      jolt,
    }: {
      scale: number;
      speed: number;
      approach: number;
      pan: number;
      jolt: number;
    }) {
      const fast = Math.min(1, speed / 1400);
      // Heard only once it's close: a speck far off makes no sound.
      const near = Math.min(1, scale) ** 2.2;
      // Brighter coming in, duller as it passes: a gentle Doppler bend.
      const bend = 2 ** (0.3 * approach);
      air.set(
        0.11 * near * (0.4 + 0.6 * fast),
        (260 + 700 * fast) * bend,
        pan * 0.8,
      );
      // Knocked about by the cloud, the paper flaps harder and faster.
      const flap = 0.022 * near * (0.5 + 0.5 * fast) * (1 + 3 * jolt);
      edges.set(flap, (1500 + 900 * fast) * bend, pan * 0.8);
      flaps.forEach(({ beat, depth }, index) => {
        beat.frequency.setTargetAtTime(
          (index ? 17.3 : 13) * (0.8 + 0.5 * fast + 0.6 * jolt),
          now(),
          0.05,
        );
        depth.gain.setTargetAtTime(flap * 0.5, now(), 0.05);
      });
    },
    // Into the cloud: a soft, big, dark puff, then the sheet shaking.
    poof(pan: number, seconds: number) {
      burst({
        length: seconds * 1.1,
        filter: "lowpass",
        frequency: 2200,
        to: 260,
        q: 0.6,
        gain: 0.28,
        attack: 0.03,
        pan,
        room: 0.6,
      });
      tone({ frequency: 90, to: 50, length: 0.35, gain: 0.25, pan });
      crackle(10, 0.25, { gain: 0.08, pan });
    },
    // Paper lighting on the table.
    touch(pan: number) {
      burst({
        length: 0.06,
        filter: "bandpass",
        frequency: 1800,
        q: 0.8,
        gain: 0.35,
        pan,
      });
      tone({ frequency: 150, to: 90, length: 0.08, gain: 0.25, pan });
    },
    skid(level: number, pan: number) {
      skid.set(0.22 * level, 1800 + 1600 * level, pan * 0.6);
    },
    // A fold opening: crisp crackle, and a soft whump of air from the
    // sheet as it swings, bigger for the bigger folds.
    unfold(size: number, pan = 0) {
      crackle(Math.round(6 + 14 * size), 0.09 + 0.12 * size, {
        gain: 0.16 + 0.12 * size,
        pan,
      });
      burst({
        length: 0.18 + 0.2 * size,
        filter: "lowpass",
        frequency: 500 + 400 * size,
        to: 180,
        q: 0.7,
        gain: 0.2 + 0.25 * size,
        attack: 0.04,
        pan,
      });
    },
    // The sheet lying down flat.
    settle() {
      burst({
        length: 0.14,
        filter: "lowpass",
        frequency: 700,
        to: 200,
        gain: 0.3,
        attack: 0.01,
      });
      tone({ frequency: 120, to: 80, length: 0.1, gain: 0.15 });
    },

    // The line in the sky thinning under the pointer, as fast as it goes
    // (puffs a second).
    breathe(rate: number) {
      const much = Math.min(1, rate / 8);
      exhale.set(0.09 * much ** 0.7, 500 + 900 * much, 0, 0.12);
    },
    // The pen: touching down, then scratching at the speed it moves
    // (card px per ms), the paper's tooth ticking under it.
    nibDown() {
      burst({
        length: 0.03,
        filter: "bandpass",
        frequency: 3200,
        q: 1.5,
        gain: 0.3,
      });
    },
    nib(speed: number, dt: number) {
      const fast = Math.min(1, speed / 0.9);
      nib.set(0.32 * fast ** 0.6, 3000 + 3200 * fast, 0, 0.06);
      grains(180 * fast, dt, { low: 2500, high: 7000, gain: 0.1 });
    },
    nibUp() {
      nib.set(0);
    },
    // The tear, as fast as its tip runs (0 to 1 over `seconds`). Written
    // out sample by sample, then given the sheet's ring: paper rips in
    // runs of fibers snapping in quick succession, and the runs crowd
    // together as the tip speeds up.
    tear(curve: number[], seconds: number) {
      const at = now() + 0.01;
      const source = context.createBufferSource();
      source.buffer = ripBuffer(context, curve, seconds);
      // Paper has no low end, a body around 1–3 kHz, and fizz above.
      const cut = context.createBiquadFilter();
      cut.type = "highpass";
      cut.frequency.value = 450;
      const body = context.createBiquadFilter();
      body.type = "peaking";
      body.frequency.value = 2200;
      body.Q.value = 0.9;
      body.gain.value = 6;
      const soft = context.createBiquadFilter();
      soft.type = "lowpass";
      soft.frequency.value = 7500;
      const amp = context.createGain();
      amp.gain.value = 0.55;
      source.connect(cut).connect(body).connect(soft).connect(amp);
      route(amp, 0.15, 0.08);
      source.start(at);
    },
    // The flap sliding over the other half, as fast as it moves.
    slide(curve: number[], seconds: number) {
      shaped(slide, curve, seconds, 0.2, [900, 1800]);
    },
    // The hanko: a dull, heavy press, the paper giving under it.
    stamp() {
      tone({ frequency: 110, to: 46, length: 0.32, gain: 0.7, room: 0.25 });
      tone({
        frequency: 330,
        to: 220,
        length: 0.06,
        gain: 0.12,
        type: "triangle",
      });
      burst({
        length: 0.12,
        filter: "lowpass",
        frequency: 900,
        to: 200,
        gain: 0.4,
        attack: 0.004,
      });
    },
    // The stone lifting off tacky ink.
    tack() {
      burst({
        length: 0.07,
        filter: "bandpass",
        frequency: 5200,
        to: 3000,
        q: 2,
        gain: 0.09,
        attack: 0.02,
      });
      crackle(5, 0.06, { low: 3000, high: 8000, gain: 0.05 });
    },

    // The curled corner: a small lift, or the flick that invites a peel.
    curl(size = 1, after = 0) {
      const at = now() + after;
      crackle(Math.round(2 + 3 * size), 0.04, {
        at,
        low: 2500,
        high: 7000,
        gain: 0.08 * size,
        pan: 0.35,
      });
      burst({
        at,
        length: 0.08,
        filter: "bandpass",
        frequency: 1400,
        to: 2400,
        q: 1,
        gain: 0.05 * size,
        attack: 0.02,
        pan: 0.35,
      });
    },
    // Peeling, at the speed the peel comes away (px/s).
    peel(speed: number, dt: number) {
      const fast = Math.min(1, Math.abs(speed) / 700);
      peel.set(0.14 * fast, 2400 + 2600 * fast, 0.3, 0.08);
      grains(380 * fast, dt, { low: 2000, high: 8000, gain: 0.13, pan: 0.3 });
    },
    peelStop() {
      peel.set(0);
    },
    // Let go short: the glue slaps it back down.
    slap(after = 0) {
      const at = now() + after;
      burst({
        at,
        length: 0.05,
        filter: "bandpass",
        frequency: 1500,
        q: 0.9,
        gain: 0.32,
        pan: 0.3,
      });
      tone({ at, frequency: 170, to: 100, length: 0.05, gain: 0.18, pan: 0.3 });
    },
    // Free: the last fibers letting go, flicked as hard as it was pulled.
    release(speed: number) {
      const hard = Math.min(1, speed / 900);
      crackle(Math.round(8 + 10 * hard), 0.08, { gain: 0.2, pan: 0.3 });
      burst({
        length: 0.22,
        filter: "bandpass",
        frequency: 700,
        to: 3200,
        q: 0.9,
        gain: 0.12 + 0.18 * hard,
        attack: 0.02,
        pan: 0.3,
      });
    },
    // Rising to you.
    rise(seconds: number) {
      burst({
        length: seconds,
        filter: "lowpass",
        frequency: 260,
        to: 1100,
        q: 0.6,
        gain: 0.18,
        attack: seconds * 0.4,
      });
    },
    // Light sweeping across the paper: a glassy run, left to right.
    shimmer(seconds: number) {
      const at = now();
      [0, 1, 2, 4].forEach((step, index) => {
        const start = at + (index / 4) * seconds * 0.7;
        const pan = -0.6 + index * 0.4;
        tone({
          at: start,
          frequency: ring(step),
          length: 1.6,
          gain: 0.05,
          attack: 0.01,
          pan,
          room: 0.9,
        });
        // A bell's inharmonic shimmer above it.
        tone({
          at: start,
          frequency: ring(step) * 2.76,
          length: 0.5,
          gain: 0.012,
          pan,
          room: 0.9,
        });
      });
    },
    // Poured down into the bottom of the screen.
    genie(seconds: number) {
      burst({
        length: seconds,
        filter: "bandpass",
        frequency: 2600,
        to: 240,
        q: 1.2,
        gain: 0.3,
        attack: seconds * 0.5,
      });
      tone({
        frequency: 620,
        to: 150,
        length: seconds,
        gain: 0.06,
        attack: seconds * 0.6,
      });
    },
    // Gone: tucked away.
    tuck() {
      tone({ frequency: 180, to: 120, length: 0.12, gain: 0.22 });
      burst({
        length: 0.08,
        filter: "lowpass",
        frequency: 600,
        gain: 0.15,
        attack: 0.005,
      });
    },
    // the sender's half shrinking into the mark: a small, fading draw-in.
    filing(seconds: number) {
      burst({
        length: seconds,
        filter: "bandpass",
        frequency: 900,
        to: 3400,
        q: 1.4,
        gain: 0.07,
        attack: seconds * 0.7,
      });
    },
    // The mark settling into place: a small wooden tock.
    filed() {
      tone({ frequency: ring(2) / 2, length: 0.22, gain: 0.12, room: 0.4 });
      tone({ frequency: ring(2) * 1.5, length: 0.06, gain: 0.03, room: 0.4 });
    },
    // The clouds parting on what's next: air opening up, and a chord
    // settling, slow in and slow out.
    part(seconds: number) {
      burst({
        length: seconds,
        filter: "bandpass",
        frequency: 500,
        to: 2800,
        q: 0.5,
        gain: 0.16,
        attack: seconds * 0.35,
        room: 0.5,
      });
      [-12, -5, 0, 2, 7].forEach((step, index) =>
        tone({
          at: now() + index * 0.09,
          frequency: (E6 / 4) * 2 ** (step / 12),
          length: seconds * 1.3,
          gain: 0.035,
          attack: seconds * 0.4,
          pan: (index - 2) * 0.25,
          room: 0.8,
        }),
      );
    },
    // The welcome landing.
    reveal() {
      [2, 4].forEach((step, index) =>
        tone({
          at: now() + index * 0.12,
          frequency: ring(step),
          length: 1.4,
          gain: 0.04,
          pan: index ? 0.2 : -0.2,
          room: 0.9,
        }),
      );
    },

    close() {
      void context.close();
    },
  };
}

// A cue on a timeline: something heard the moment the timeline passes it.
export type Cue = { at: number; play: (sound: Sound) => void };
// A stretch of the scene, heard: one-shot cues, and whatever runs
// continuously, steered each frame from the timeline's time.
export type Track = {
  cues: Cue[];
  tick?: (sound: Sound, t: number, dt: number) => void;
};

function envelope(
  context: AudioContext,
  at: number,
  attack: number,
  length: number,
  gain: number,
) {
  const amp = context.createGain();
  const peak = Math.min(attack, length * 0.9);
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(gain, at + peak);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
  return amp;
}

function noiseBuffer(context: AudioContext, seconds: number) {
  const buffer = context.createBuffer(
    1,
    seconds * context.sampleRate,
    context.sampleRate,
  );
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// A room's tail: decaying noise, a little different in each ear.
function impulse(context: AudioContext, seconds: number, decay: number) {
  const length = seconds * context.sampleRate;
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
  }
  return buffer;
}

const clampPan = (pan: number) => Math.min(1, Math.max(-1, pan));

// A rip, sample by sample: runs of fibers snapping a millisecond or two
// apart, the gaps between runs shrinking as the tip (`curve`, 0 to 1)
// speeds up, now and then a stronger snap, and a faint rasp of fibers
// dragging between them. It opens on a nick at the top edge.
function ripBuffer(context: AudioContext, curve: number[], seconds: number) {
  const rate = context.sampleRate;
  const data = new Float32Array(Math.ceil((seconds + 0.05) * rate));
  const paceAt = (t: number) =>
    curve[
      Math.min(curve.length - 1, Math.floor((t / seconds) * curve.length))
    ]!;
  const fiber = (t: number, strength: number, length: number) => {
    const start = Math.floor(t * rate);
    const samples = Math.max(8, Math.floor(length * rate));
    for (let i = 0; i < samples && start + i < data.length; i++)
      data[start + i]! +=
        strength * (Math.random() * 2 - 1) * Math.exp(-i / (samples * 0.3));
  };
  // The nick.
  for (let k = 0; k < 4; k++)
    fiber(k * 0.0016, 0.9 - k * 0.15, 0.002 + Math.random() * 0.002);
  let t = 0.012;
  while (t < seconds) {
    const pace = paceAt(t);
    if (pace < 0.03) {
      t += 0.005;
      continue;
    }
    const snap = Math.random() < 0.07;
    const count = 2 + Math.floor(Math.random() * (3 + 6 * pace));
    const strength =
      (0.25 + 0.55 * Math.random()) * (0.35 + 0.65 * pace) * (snap ? 1.8 : 1);
    let at = t;
    for (let k = 0; k < count; k++) {
      fiber(
        at,
        strength * (0.4 + 0.6 * Math.random()),
        (snap ? 0.002 : 0.0005) + Math.random() * 0.0018,
      );
      at += 0.0005 + Math.random() * 0.0016;
    }
    t = at + (0.003 + Math.random() * 0.022) / (0.25 + 1.6 * pace);
  }
  for (let i = 0; i < data.length; i++) {
    const t = i / rate;
    if (t < seconds) data[i]! += 0.05 * paceAt(t) * (Math.random() * 2 - 1);
  }
  let peak = 0;
  for (const value of data) peak = Math.max(peak, Math.abs(value));
  if (peak > 0) for (let i = 0; i < data.length; i++) data[i]! /= peak;
  const buffer = context.createBuffer(1, data.length, rate);
  buffer.copyToChannel(data, 0);
  return buffer;
}
