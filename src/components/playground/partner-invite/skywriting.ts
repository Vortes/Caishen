import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  BufferAttribute,
  DoubleSide,
  Mesh,
  ShaderMaterial,
} from "three";
import { cloudNoise } from "./cloud";
import { random } from "./config";

// The face the line is lettered in: its family, weight, and how far its
// letters are spaced apart (em).
export type Lettering = { family: string; weight: string; tracking: number };

// A line written in cloud. Like the cloud the plane flies into, it's made
// of soft, lumpy puffs: hundreds of them, packed into the letters, fattest
// where the strokes are thickest, so the letters come out round and
// billowing. Each puff can be breathed away on its own: where the pointer
// rests it frays, swells, thins, and drifts off, opening holes and
// breaking wisps loose; then, left alone, each wisp finds its own way back
// and the letters knit together again.

// The letters are packed from a mask this wide.
const MASK_WIDTH = 640;
// How near the pointer a puff has to be to be breathed on, × the letters'
// stroke, and how fast it goes there (of the whole puff, a second).
const REACH = 0.85;
const BREATH = 2.6;
// Breathed away, a puff never goes past a faint wisp, so you can watch it
// find its way home. It drifts off on the push, slowed by the air, then
// after a moment's rest is drawn back: a soft spring with a sideways swirl
// and a little wander, so each takes its own curving route, overshooting
// a touch, thickening back up as it nears its place.
const WISP = 0.85;
const REST = 0.35;
const PUSH = 900;
const DRAG = 2.6;
const HOME = 3.2;
const SWIRL = 0.55;
const WANDER = 40;
// Caught, the wind takes the line for good: a gust that stirs every puff
// at once and builds, tearing them loose in a sweep along the way the
// clouds drift, then carrying them off, fading this fast once loose.
const GUST = 260;
const LOOSE = 0.35;
const FADE = 0.7;
// How fast the written line sways, against the clouds' drift.
const SWAY = 1 / 3;

const vertex = /* glsl */ `
  attribute vec2 corner;
  // Where the puff sits (px), its radius (px), a seed, and how high it
  // sits in its line (0 at the baseline, 1 at the top).
  attribute vec4 puff;
  attribute float lift;
  // How far it has dissipated, and how far it has drifted (px).
  attribute vec3 state;
  uniform vec2 uSize;
  uniform float uForm;
  // The breeze: how far the clouds have drifted (seconds at their natural
  // speed), so the line sways as lively as they drift; how far the whole
  // line has rocked (px); and how far each puff billows (px).
  uniform float uBreeze;
  uniform vec2 uRock;
  uniform float uBillow;
  varying vec2 vCorner;
  varying float vSeed;
  varying float vLift;
  varying float vGone;
  varying float vShown;
  void main() {
    vCorner = corner;
    vSeed = puff.w;
    vLift = lift;
    vGone = state.x;
    // Forming, the puffs billow up in a scattered order, swelling into place.
    vShown = smoothstep(vSeed * 0.55, vSeed * 0.55 + 0.45, uForm);
    float size = puff.z * (0.55 + 0.45 * vShown) * (1.0 + 0.9 * state.x);
    // A slow wave runs through the letters, each puff riding it a little
    // out of step, so the line billows rather than wobbles.
    float wave = uBreeze * 0.5 + puff.x * 0.012 + vSeed * 2.4;
    vec2 billow = uBillow * vec2(sin(wave), 0.6 * cos(wave * 0.8 + puff.y * 0.02));
    vec2 at = puff.xy + state.yz + corner * size + uRock + billow;
    gl_Position = vec4(at / uSize * 2.0 - 1.0, 0.0, 1.0);
    gl_Position.y = -gl_Position.y;
  }
`;

const fragment = /* glsl */ `
  uniform float uNight;
  varying vec2 vCorner;
  varying float vSeed;
  varying float vLift;
  varying float vGone;
  varying float vShown;
  ${cloudNoise}
  void main() {
    float r = length(vCorner);
    if (r > 1.0) discard;
    float n = fbm(vCorner * 0.7 + vSeed * 17.0 + vGone * 0.9);
    // A round puff, soft all the way in, its rim gently lumpy.
    float body = pow(smoothstep(1.0, 0.0, r + (n - 0.5) * 0.3), 1.2);
    // Dissipating, it frays: the thin parts go first.
    float fray = smoothstep(vGone * 0.9, vGone * 0.9 + 0.3, n);
    float alpha = body * mix(1.0, fray, smoothstep(0.0, 0.4, vGone))
      * pow(1.0 - vGone, 1.3) * vShown * 0.6;
    // Lit from above: bright tops, cool blue-grey undersides, by puff and
    // by where it sits in its letter. By moonlight, silver over near-sky.
    // Mostly by the letter, so it reads as one soft mass, not beads.
    float light = clamp(0.45 - 0.06 * vCorner.y + 0.55 * vLift + 0.08 * (n - 0.5), 0.0, 1.0);
    vec3 shadow = mix(vec3(0.66, 0.75, 0.90), vec3(0.05, 0.06, 0.11), uNight);
    vec3 lit = mix(vec3(1.0, 0.995, 0.98), vec3(0.5, 0.54, 0.66), uNight);
    vec3 color = mix(shadow, lit, mix(light, light * light, uNight));
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

type Puff = {
  x: number;
  y: number;
  radius: number;
  seed: number;
  lift: number;
};

export type Skywriting = ReturnType<typeof createSkywriting>;

export function createSkywriting() {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(12), 3),
  );
  geometry.setAttribute(
    "corner",
    new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    // Flipped to stage coordinates, the quads wind the other way.
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uSize: { value: [1, 1] },
      uBreeze: { value: 0 },
      uRock: { value: [0, 0] },
      uBillow: { value: 0 },
      uForm: { value: 0 },
      uNight: { value: 0 },
    },
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  let puffs: Puff[] = [];
  let state = new Float32Array(0);
  // Each puff's drift speed (px/s), and seconds since it was breathed on.
  let velocity = new Float32Array(0);
  let rested = new Float32Array(0);
  let clock = 0;
  let stroke = 1;
  let written = "";

  // Packs the line into puffs, for a stage this size.
  const write = (
    lines: string[],
    width: number,
    height: number,
    face: Lettering,
  ) => {
    const key = `${lines.join("\n")}:${width}x${height}:${JSON.stringify(face)}`;
    if (key === written || !width || !height) return;
    written = key;
    const scale = width / MASK_WIDTH;
    const mask = lettered(lines, MASK_WIDTH, Math.round(height / scale), face);
    puffs = pack(mask).map((puff) => ({
      ...puff,
      x: puff.x * scale,
      y: puff.y * scale,
      radius: puff.radius * scale,
    }));
    stroke = mask.stroke * scale;

    state = new Float32Array(puffs.length * 3);
    velocity = new Float32Array(puffs.length * 2);
    rested = new Float32Array(puffs.length).fill(REST);
    geometry.instanceCount = puffs.length;
    geometry.setAttribute(
      "puff",
      new InstancedBufferAttribute(
        new Float32Array(
          puffs.flatMap((puff) => [puff.x, puff.y, puff.radius, puff.seed]),
        ),
        4,
      ),
    );
    geometry.setAttribute(
      "lift",
      new InstancedBufferAttribute(
        new Float32Array(puffs.map((puff) => puff.lift)),
        1,
      ),
    );
    geometry.setAttribute("state", new InstancedBufferAttribute(state, 3));
  };

  return {
    mesh,
    write,
    // One frame: how far the line has formed and blown apart, how far the
    // clouds around it have drifted (seconds at their natural speed), where
    // the pointer rests (stage px, or null), and how long since the last
    // frame.
    // Returns how much cloud the pointer breathed away this frame.
    update({
      width,
      height,
      form,
      scatter,
      drifted,
      pointer,
      dt,
      night,
    }: {
      width: number;
      height: number;
      form: number;
      scatter: number;
      drifted: number;
      pointer: { x: number; y: number } | null;
      dt: number;
      night: boolean;
    }) {
      // It stays where it was written but sways in the breeze the clouds
      // drift on: the whole line rocks a little, slow and uneven, and its
      // puffs billow, at a third of the clouds' pace. Still clouds, still
      // line.
      const swayed = drifted * SWAY;
      const rock = {
        x:
          stroke *
          0.14 *
          (Math.sin(swayed * 0.23) + 0.4 * Math.sin(swayed * 0.61)),
        y: stroke * 0.06 * Math.sin(swayed * 0.31 + 1.3),
      };
      material.uniforms.uBreeze!.value = swayed;
      material.uniforms.uRock!.value = [rock.x, rock.y];
      material.uniforms.uBillow!.value = stroke * 0.05;
      material.uniforms.uSize!.value = [width, height];
      material.uniforms.uForm!.value = form;
      material.uniforms.uNight!.value = night ? 1 : 0;
      mesh.visible = form > 0 && puffs.length > 0;
      if (!mesh.visible) return 0;
      const reach = stroke * REACH;
      clock += dt;
      let breathed = 0;
      puffs.forEach((puff, index) => {
        const at = index * 3;
        let gone = state[at]!;
        let shiftX = state[at + 1]!;
        let shiftY = state[at + 2]!;
        let speedX = velocity[index * 2]!;
        let speedY = velocity[index * 2 + 1]!;
        if (gone >= 1 && scatter > 0) return;
        let pushX = 0;
        let pushY = 0;
        // Breathed on: it thins where the pointer is, pushed away from it.
        let touched = false;
        if (pointer && form >= 1 && scatter === 0) {
          const dx = puff.x + rock.x + shiftX - pointer.x;
          const dy = puff.y + rock.y + shiftY - pointer.y;
          const distance = Math.hypot(dx, dy);
          const near = Math.max(0, 1 - distance / reach) ** 2;
          if (near > 0) {
            touched = true;
            const more = Math.max(0, Math.min(WISP - gone, near * BREATH * dt));
            gone += more;
            breathed += more;
            pushX += (dx / (distance || 1)) * PUSH * near;
            pushY += (dy / (distance || 1)) * PUSH * near;
          }
        }
        rested[index] = touched ? 0 : rested[index]! + dt;
        const away = Math.hypot(shiftX, shiftY);
        let pullX = 0;
        let pullY = 0;
        if (scatter > 0) {
          // The gust: every puff stirs at once and keeps moving; each tears
          // loose as the sweep reaches it, from the side the clouds drift
          // toward, and is carried off downwind, rising a little.
          const along = 1 - puff.x / width;
          const torn = Math.min(
            1,
            Math.max(0, scatter * 2.2 - along * 0.7 - puff.seed * 0.3),
          );
          gone = Math.max(gone, torn);
          if (gone > LOOSE) gone = Math.min(1, gone + FADE * dt);
          const gust = GUST * (0.25 * scatter + torn) * (0.6 + 0.8 * puff.seed);
          pullX = -gust + WANDER * Math.sin(clock * 1.7 + puff.seed * 40);
          pullY =
            -0.25 * gust + WANDER * Math.cos(clock * 1.3 + puff.seed * 23);
        } else if (rested[index] >= REST && (away > 0.5 || gone > 0)) {
          // Home: a spring toward its place, turned a little sideways (each
          // puff its own way round) and wandering, more the further out.
          const spin = puff.seed < 0.5 ? -1 : 1;
          const out = Math.min(1, away / stroke);
          pullX =
            -HOME * shiftX -
            spin * SWIRL * HOME * shiftY +
            WANDER * out * Math.sin(clock * 1.3 + puff.seed * 40);
          pullY =
            -HOME * shiftY +
            spin * SWIRL * HOME * shiftX +
            WANDER * out * Math.cos(clock * 1.1 + puff.seed * 23);
          // Thickening back up as it nears its place.
          const close = 1 - out;
          gone = Math.max(0, gone - dt * (0.12 + 0.75 * close * close));
        }
        speedX += (pushX + pullX - DRAG * speedX) * dt;
        speedY += (pushY + pullY - DRAG * speedY) * dt;
        shiftX += speedX * dt;
        shiftY += speedY * dt;
        state[at] = gone;
        state[at + 1] = shiftX;
        state[at + 2] = shiftY;
        velocity[index * 2] = speedX;
        velocity[index * 2 + 1] = speedY;
      });
      geometry.getAttribute("state").needsUpdate = true;
      return breathed;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// The line, lettered white on black into a mask the shape of the stage:
// heavy, widely spaced, as big as fits, in the upper middle of the sky.
function lettered(
  lines: string[],
  width: number,
  height: number,
  { family, weight, tracking }: Lettering,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const pen = canvas.getContext("2d", { willReadFrequently: true })!;
  pen.fillStyle = "black";
  pen.fillRect(0, 0, width, height);
  let fontSize = height * 0.2;
  const type = () => {
    pen.font = `${weight} ${fontSize}px ${family}`;
    // Spaced out, so the puffy letters don't run together.
    pen.letterSpacing = `${fontSize * tracking}px`;
  };
  type();
  const widest = Math.max(...lines.map((line) => pen.measureText(line).width));
  fontSize *= Math.min(1, (width * 0.88) / widest);
  type();
  pen.fillStyle = "white";
  pen.textAlign = "center";
  pen.textBaseline = "middle";
  const leading = fontSize * 1.15;
  const top = height * 0.4 - ((lines.length - 1) * leading) / 2;
  const rows = lines.map((line, index) => {
    const y = top + index * leading;
    // letterSpacing trails the last letter; shift back to stay centered.
    pen.fillText(line, width / 2 + (fontSize * tracking) / 2, y);
    return { top: y - fontSize * 0.5, bottom: y + fontSize * 0.35 };
  });
  const pixels = pen.getImageData(0, 0, width, height).data;
  const inside = new Uint8Array(width * height);
  for (let i = 0; i < inside.length; i++)
    inside[i] = pixels[i * 4]! > 127 ? 1 : 0;
  return { inside, width, height, rows, stroke: fontSize };
}

// Fills the letters with puffs. Each pixel's distance to the nearest edge
// says how thick the stroke is there; puffs are sized to it (a little
// fatter, so the letters swell), then placed at random wherever they don't
// crowd one already placed. Small ones fill in round the rims, so edges
// come out lumpy.
function pack({
  inside,
  width,
  height,
  rows,
  stroke,
}: ReturnType<typeof lettered>): Puff[] {
  const depth = distances(inside, width, height);
  const rng = random(1729, "skywriting");
  const smallest = stroke * 0.11;
  const largest = stroke * 0.3;
  const candidates: number[] = [];
  for (let i = 0; i < inside.length; i++)
    if (depth[i]! >= 1) candidates.push(i);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  // Placed puffs, bucketed so crowding checks only look nearby.
  const cell = largest * 2;
  const columns = Math.ceil(width / cell);
  const grid = new Map<number, Puff[]>();
  const placed: Puff[] = [];
  for (const index of candidates) {
    const x = index % width;
    const y = Math.floor(index / width);
    const radius = Math.min(
      largest,
      Math.max(smallest, depth[index]! * 1.7 * (0.85 + 0.3 * rng())),
    );
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    let crowded = false;
    for (let gx = cx - 1; gx <= cx + 1 && !crowded; gx++)
      for (let gy = cy - 1; gy <= cy + 1 && !crowded; gy++)
        for (const other of grid.get(gy * columns + gx) ?? [])
          if (
            Math.hypot(other.x - x, other.y - y) <
            0.45 * Math.min(radius, other.radius)
          ) {
            crowded = true;
            break;
          }
    if (crowded) continue;
    const row =
      rows.find((each) => y <= each.bottom + stroke * 0.3) ?? rows.at(-1)!;
    const puff = {
      x,
      y,
      radius,
      seed: rng(),
      lift: Math.min(1, Math.max(0, (row.bottom - y) / (row.bottom - row.top))),
    };
    placed.push(puff);
    const key = cy * columns + cx;
    grid.set(key, [...(grid.get(key) ?? []), puff]);
  }
  return placed;
}

// How far each pixel inside the letters is from the nearest pixel outside
// them: a two-pass chamfer distance.
function distances(inside: Uint8Array, width: number, height: number) {
  const far = 1e6;
  const depth = new Float32Array(inside.length);
  for (let i = 0; i < inside.length; i++) depth[i] = inside[i] ? far : 0;
  const pass = (x: number, y: number, dx: number, dy: number, cost: number) => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return far;
    return depth[ny * width + nx]! + cost;
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!depth[i]) continue;
      depth[i] = Math.min(
        depth[i],
        pass(x, y, -1, 0, 1),
        pass(x, y, 0, -1, 1),
        pass(x, y, -1, -1, Math.SQRT2),
        pass(x, y, 1, -1, Math.SQRT2),
      );
    }
  for (let y = height - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!depth[i]) continue;
      depth[i] = Math.min(
        depth[i],
        pass(x, y, 1, 0, 1),
        pass(x, y, 0, 1, 1),
        pass(x, y, 1, 1, Math.SQRT2),
        pass(x, y, -1, 1, Math.SQRT2),
      );
    }
  return depth;
}
