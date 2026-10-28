// When everything in the partner invite happens, step by step, in seconds.
// Fractions say what they're a fraction of. The scene, the 3D card, and
// the sound all read their beats from here, so retiming a step moves its
// picture and its sound together.
export const timeline = {
  // The line in the sky billows up over `form`, and blows apart over
  // `scatter` once the plane is thrown.
  write: { form: 2.2, scatter: 2.2 },
  // Once the plane has skidded to a stop, the sheet unfolds; each fold
  // starts `stagger` of its length before the last one finishes.
  unfold: { duration: 1.8, stagger: 0.25 },
  // Signed, the card tears in two. Fractions of the tear: the 3D sheet has
  // faded in over the printed card by `shown`, the tip reaches the bottom
  // by `torn`, and the right flap starts sliding over at `slideFrom`.
  tear: { duration: 1.3, shown: 0.06, torn: 0.7, slideFrom: 0.6 },
  // Then the halves bond. Fractions of the bond: the slide ends at
  // `slideTo`; the seal presses over `press`, stamps at `stamp`, and the
  // ink takes over `take`.
  bond: {
    duration: 2.4,
    slideTo: 0.25,
    press: [0.36, 0.56],
    stamp: 0.42,
    take: [0.4, 0.56],
  },
  // Your half's corner curls back to show it peels, `delay` after the
  // step begins: in over `seconds`, letting go over `relax`.
  curl: { delay: 0.25, seconds: 0.5, relax: 0.3 },
  // Then it flicks up `count` times, `every` seconds apart, starting
  // `after` the curl: up over `rise`, by `lift` of the curl.
  flick: { after: 1.6, every: 3.5, count: 3, rise: 0.16, lift: 0.4 },
  // Taken, your half rises to you over `rise` while the peel rolls back out
  // of it over `uncurl`; a sheen sweeps across it over `shimmer`, then it
  // pours into the bottom of the screen like a window into the Dock.
  keep: {
    rise: 0.9,
    uncurl: 0.8,
    shimmer: [0.8, 1.7],
    genie: { at: 1.8, seconds: 0.55 },
  },
  // Jordan's half, filed away as the Partner mark: when it starts shrinking
  // (after yours is gone), how long that takes, and how long the mark holds
  // before the clouds close.
  filed: { at: 0.15, duration: 0.8, hold: 1.6 },
  // The clouds closing over the stage once the mark has held: how long they
  // take to close in, when they start to part (after they start closing),
  // and how long parting takes. The mark's plate fades out when they start
  // closing, give or take `plateAt`, over `plateFade`.
  veil: { gather: 1.4, partAt: 1.7, part: 3.6, plateAt: -0.1, plateFade: 0.3 },
  // When what's underneath starts coming up through the parting clouds (a
  // fraction of the parting) and how long it takes to settle.
  reveal: { at: 0.55, duration: 0.5 },
} as const;

// The ending's beats, in seconds after your half came free.
const { genie } = timeline.keep;
const gone = genie.at + genie.seconds;
const filedAt = gone + timeline.filed.at;
export const ending = {
  gone,
  filedAt,
  cloudsAt: filedAt + timeline.filed.duration + timeline.filed.hold,
};
