import { Matrix4, Vector3 } from "three";
import { CARD } from "./geometry";

// The Harrier paper airplane (How to Origami, Instructables), folded from
// the invitation card itself. The sheet is held portrait: u runs across it
// (-A..A) and v along it (0..L), so the center crease is u = 0 and the nose
// ends up toward v = L. The printed side faces +z; the pattern is on the back.
//
// Every fold is simulated rather than drawn: each step splits the paper's
// facets along a line in the current folded state, and rotates the facets
// on one side about that line. Unfolding plays the steps back in reverse.

const L = CARD.width;
const A = CARD.height / 2;
// "Fold the top point down to about an inch above the bottom edge."
const INCH = L * 0.09;
const TOP_FOLD = (L + INCH) / 2;
// Where the second corner folds end, and where the lock tab hinges.
const TAB = TOP_FOLD - A;
// Paper thickness between stacked layers.
const LAYER = 0.06;

type Flat = { x: number; y: number };

type Facet = {
  rest: Flat[];
  // Whether each flat fold moved this facet.
  moved: boolean[];
  // Which half of the fuselage it ends up in, and whether it's wing.
  side: 1 | -1;
  wing: boolean;
};

type Fold = {
  // A point on the fold line and which side moves, in the folded state
  // just before this step.
  through: Flat;
  toward: Flat;
  // Only fold facets that an earlier step moved (the lock tab).
  onlyMovedBy?: number;
  // Filled in by the simulation: the hinge in that folded state.
  hinge?: { at: Vector3; axis: Vector3 };
};

const norm = (x: number, y: number) => {
  const length = Math.hypot(x, y);
  return { x: x / length, y: y / length };
};

const folds: Fold[] = [
  // 2. Fold the top edges in, parallel to the center crease.
  { through: { x: 0, y: L }, toward: norm(1, 1) },
  { through: { x: 0, y: L }, toward: norm(-1, 1) },
  // 3. Fold the top point down to about an inch above the bottom edge.
  { through: { x: 0, y: TOP_FOLD }, toward: norm(0, 1) },
  // 4. Fold the top edges in again.
  { through: { x: 0, y: TOP_FOLD }, toward: norm(1, 1) },
  { through: { x: 0, y: TOP_FOLD }, toward: norm(-1, 1) },
  // 5. Fold the small triangle up over the flaps to lock them.
  {
    through: { x: 0, y: TAB },
    toward: norm(0, -1),
    onlyMovedBy: 2,
  },
];

// Steps that unfold together, last fold first.
export const unfoldOrder = [[5], [3, 4], [2], [0, 1]];

// 6–7. Mountain-fold the center, then fold each wing down along a line
// from just behind the nose to the tail. Lines are in the flat folded
// state after the lock tab.
const NOSE = { x: 7, y: TOP_FOLD - 8 };
const TAIL = { x: 46, y: 0 };

const rotation = (at: Vector3, axis: Vector3, angle: number) =>
  new Matrix4()
    .makeTranslation(at.x, at.y, at.z)
    .multiply(new Matrix4().makeRotationAxis(axis, angle))
    .multiply(new Matrix4().makeTranslation(-at.x, -at.y, -at.z));

type Working = Facet & { now: Vector3[] };

// Cut a convex facet by a line; pieces keep matching rest and folded points.
function split(
  facet: Working,
  side: (point: Vector3) => number,
): { plus: Working | null; minus: Working | null; cut: Flat[] } {
  const plus: { rest: Flat[]; now: Vector3[] } = { rest: [], now: [] };
  const minus: { rest: Flat[]; now: Vector3[] } = { rest: [], now: [] };
  const cut: Flat[] = [];
  const count = facet.now.length;
  const distance = facet.now.map((point) => {
    const value = side(point);
    return Math.abs(value) < 1e-6 ? 0 : value;
  });
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const a = distance[i]!;
    const b = distance[j]!;
    if (a >= 0) {
      plus.rest.push(facet.rest[i]!);
      plus.now.push(facet.now[i]!);
    }
    if (a <= 0) {
      minus.rest.push(facet.rest[i]!);
      minus.now.push(facet.now[i]!);
    }
    if (a === 0) cut.push(facet.rest[i]!);
    if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
      const t = a / (a - b);
      const rest = {
        x: facet.rest[i]!.x + (facet.rest[j]!.x - facet.rest[i]!.x) * t,
        y: facet.rest[i]!.y + (facet.rest[j]!.y - facet.rest[i]!.y) * t,
      };
      const now = facet.now[i]!.clone().lerp(facet.now[j]!, t);
      plus.rest.push(rest);
      plus.now.push(now);
      minus.rest.push(rest);
      minus.now.push(now.clone());
      cut.push(rest);
    }
  }
  const piece = (part: typeof plus) =>
    part.rest.length >= 3 && distance.some((value) => value !== 0)
      ? { ...facet, moved: [...facet.moved], rest: part.rest, now: part.now }
      : null;
  return {
    plus: distance.some((value) => value > 0) ? piece(plus) : null,
    minus: distance.some((value) => value < 0) ? piece(minus) : null,
    cut: cut.length === 2 ? cut : [],
  };
}

function simulate() {
  let facets: Working[] = [
    {
      rest: [
        { x: -A, y: 0 },
        { x: A, y: 0 },
        { x: A, y: L },
        { x: -A, y: L },
      ],
      now: [
        new Vector3(-A, 0, 0),
        new Vector3(A, 0, 0),
        new Vector3(A, L, 0),
        new Vector3(-A, L, 0),
      ],
      moved: folds.map(() => false),
      side: 1,
      wing: false,
    },
  ];
  const creases: [Flat, Flat][] = [
    [
      { x: 0, y: 0 },
      { x: 0, y: L },
    ],
  ];
  const cutAll = (
    side: (point: Vector3) => number,
    keep = (_: Working) => true,
  ) => {
    const next: { piece: Working; plus: boolean }[] = [];
    for (const facet of facets) {
      if (!keep(facet)) {
        next.push({ piece: facet, plus: false });
        continue;
      }
      const { plus, minus, cut } = split(facet, side);
      if (plus) next.push({ piece: plus, plus: true });
      if (minus) next.push({ piece: minus, plus: false });
      if (plus && minus && cut.length === 2) creases.push([cut[0]!, cut[1]!]);
    }
    return next;
  };

  folds.forEach((fold, index) => {
    const line = (point: Vector3) =>
      (point.x - fold.through.x) * fold.toward.x +
      (point.y - fold.through.y) * fold.toward.y;
    const pieces = cutAll(line, (facet) =>
      fold.onlyMovedBy === undefined ? true : facet.moved[fold.onlyMovedBy]!,
    );
    // The hinge sits just above the layers the flap lands on, so folded
    // layers stack on top of them.
    const reach = Math.max(
      ...pieces
        .filter(({ plus }) => plus)
        .flatMap(({ piece }) => piece.now.map(line)),
    );
    const top = Math.max(
      0,
      ...pieces.flatMap(({ piece }) =>
        piece.now
          .filter((point) => line(point) >= -reach - 1e-6)
          .map((point) => point.z),
      ),
    );
    const at = new Vector3(fold.through.x, fold.through.y, top + LAYER / 2);
    const toward = new Vector3(fold.toward.x, fold.toward.y, 0);
    // Rotating about toward × z lifts the moving side toward the viewer.
    const axis = toward
      .clone()
      .cross(new Vector3(0, 0, 1))
      .normalize();
    fold.hinge = { at, axis };
    const flat = rotation(at, axis, Math.PI);
    facets = pieces.map(({ piece, plus }) => {
      if (!plus) return piece;
      piece.moved[index] = true;
      piece.now = piece.now.map((point) => point.clone().applyMatrix4(flat));
      return piece;
    });
  });

  // Sort the flat-folded plane into fuselage halves and wings.
  facets = cutAll((point) => point.x).map(({ piece, plus }) => ({
    ...piece,
    side: plus ? 1 : -1,
  }));
  for (const side of [1, -1] as const) {
    // Positive past this side's wing line, toward the wingtip.
    const wing = (point: Vector3) =>
      point.x * side -
      (NOSE.x + ((point.y - NOSE.y) * (TAIL.x - NOSE.x)) / (TAIL.y - NOSE.y));
    facets = cutAll(wing, (facet) => facet.side === side).map(
      ({ piece, plus }) => ({
        ...piece,
        wing: piece.side === side ? plus : piece.wing,
      }),
    );
  }

  return {
    facets: facets.map(({ rest, moved, side, wing }) => ({
      rest,
      moved,
      side,
      wing,
    })),
    creases,
  };
}

const model = simulate();

// Every crease the folding left behind, in card coordinates.
export const harrierCreases = model.creases.map(
  ([a, b]) =>
    [
      { x: a.y - L / 2, y: a.x },
      { x: b.y - L / 2, y: b.x },
    ] as const,
);

export type PlaneShape = {
  // Each flat fold's angle, 0 (open) to π (folded).
  folds: number[];
  // The fuselage: 0 lies flat, 1 is the flying plane.
  body: number;
  // Half-angle of the keel's V and the wings' lift, in degrees.
  keel: number;
  dihedral: number;
};

export const folded = (keel: number, dihedral: number): PlaneShape => ({
  folds: folds.map(() => Math.PI),
  body: 1,
  keel,
  dihedral,
});

// The plane's center along its length when fully folded, in sheet units.
export const PLANE_CENTER = TOP_FOLD / 2;

// Triangles for the sheet in a given shape, in sheet coordinates, plus
// each vertex's rest position (for the paper and print).
export function shapeSheet(shape: PlaneShape) {
  const flat = folds.map((fold, index) =>
    rotation(fold.hinge!.at, fold.hinge!.axis, shape.folds[index]!),
  );
  const beta = ((90 - shape.keel) * Math.PI * shape.body) / 180;
  // Relative to its half, each wing folds back out past horizontal by the
  // dihedral, so the tips sit above the roots once the plane is upright.
  const gamma =
    ((90 - shape.keel - shape.dihedral) * Math.PI * shape.body) / 180;
  const halves = {
    1: new Matrix4().makeRotationY(beta),
    [-1]: new Matrix4().makeRotationY(-beta),
  };
  const wings = ([1, -1] as const).map((side) => {
    const start = new Vector3(NOSE.x * side, NOSE.y, 0);
    const along = new Vector3((TAIL.x - NOSE.x) * side, TAIL.y - NOSE.y, 0);
    const outward = new Vector3(side, 0, 0);
    // Lift the outward side toward +z, as the flat folds do.
    const axis = outward
      .clone()
      .projectOnPlane(along.clone().normalize())
      .normalize()
      .cross(new Vector3(0, 0, 1))
      .normalize();
    return { side, matrix: rotation(start, axis, gamma) };
  });

  const positions: number[] = [];
  const rests: number[] = [];
  const point = new Vector3();
  for (const facet of model.facets) {
    const matrix = new Matrix4();
    facet.moved.forEach((moved, index) => {
      if (moved) matrix.premultiply(flat[index]!);
    });
    if (facet.wing)
      matrix.premultiply(
        wings.find((wing) => wing.side === facet.side)!.matrix,
      );
    matrix.premultiply(halves[facet.side]);
    const corners = facet.rest.map((rest) =>
      point.set(rest.x, rest.y, 0).applyMatrix4(matrix).clone(),
    );
    for (let i = 1; i < corners.length - 1; i++) {
      for (const index of [0, i, i + 1]) {
        const corner = corners[index]!;
        positions.push(corner.x, corner.y, corner.z);
        rests.push(facet.rest[index]!.x, facet.rest[index]!.y);
      }
    }
  }
  return { positions, rests };
}
