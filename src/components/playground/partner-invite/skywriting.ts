import {
  AddEquation,
  BufferAttribute,
  CustomBlending,
  DataTexture,
  DoubleSide,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  NoBlending,
  OneFactor,
  OrthographicCamera,
  PlaneGeometry,
  RedFormat,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { random } from "./config";
import { FACES, type Face } from "./skywriting-faces";

// A line skywritten in cloud. A plane lays one trail of smoke, an even
// width all along, so the line is lettered in a plain, even-stroked hand
// and the trail follows its strokes. The trail is a chain of cotton-ball
// puffs piled along each stroke, big ones down the middle and small ones
// beading its rims, melted into one soft mass and lit from above: bright
// domes, soft grey creases where they meet, a little haze round the edge.
//
// Each puff can be breathed away on its own: where the pointer rests it
// thins, swells, and drifts off, opening holes and breaking wisps loose;
// then, left alone, each wisp finds its own way back and the letters knit
// together again.
//
// Two passes: the puffs, free to drift anywhere, are summed into a soft
// height field; then the field is lit and grained into cloud. It draws on
// its own canvas at the screen's full resolution, over the sky (which
// draws at one pixel per CSS pixel, too soft for letters).

// How the line is lettered: in which hand, in capitals or not, how far
// the trail reaches either side of the pen's stroke (em), and how far
// apart the letters are spaced (em), so trails don't run together.
export type Lettering = {
  face: Face;
  capitals: boolean;
  trail: number;
  spacing: number;
};

// How the pointer breathes the line away, and how it heals.
//
// A puff within `reach` (× the letters' size) thins as fast as `strength`
// (of the whole puff, a second), never past `depth`, so you can watch it
// find its way home. It drifts off on a `push` (px/s²), slowed by `drag`.
// After `delay` seconds' rest it's drawn back: a spring of `home`, turned
// sideways by `swirl` (each puff its own way round) and wandering up to
// `wander` px/s², overshooting a touch, thickening back up `thicken` times
// as fast as it would on its own as it nears its place.
export type Breath = {
  reach: number;
  strength: number;
  depth: number;
  push: number;
  drag: number;
  delay: number;
  home: number;
  swirl: number;
  wander: number;
  thicken: number;
};

// The letters are measured out on a mask at most this wide.
const MASK_WIDTH = 1024;
// The distance to the stroke is kept out to this many trail-widths.
const REACH = 3;
// Puffs, each layer on a jittered grid this fine (× the trail), as big as
// they are near the stroke: `body` is how big a puff on the stroke is
// (× the trail), `fall` how fast they shrink with distance from it.
const LAYERS = [
  { cell: 0.7, body: 0.75, fall: 0.85 },
  { cell: 0.38, body: 0.5, fall: 0.55 },
];
// Caught, the wind takes the line for good: a gust that stirs every puff
// at once and builds, tearing them loose in a sweep along the way the
// clouds drift, then carrying them off, fading this fast once loose.
const GUST = 260;
const LOOSE = 0.35;
const FADE = 0.7;
// How fast the written line sways, against the clouds' drift.
const SWAY = 1 / 3;

const noise = /* glsl */ `
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash2(i).x;
    float b = hash2(i + vec2(1.0, 0.0)).x;
    float c = hash2(i + vec2(0.0, 1.0)).x;
    float d = hash2(i + vec2(1.0, 1.0)).x;
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p = p * 2.07 + vec2(3.1, 7.7);
      amplitude *= 0.5;
    }
    return value;
  }
`;

// Each puff is a quad round its dome.
const puffVertex = /* glsl */ `
  attribute vec2 corner;
  // Where the puff sits (px), its radius (px), and a seed.
  attribute vec4 puff;
  // How far it has dissipated, and how far it has drifted (px).
  attribute vec3 state;
  uniform vec2 uSize;
  uniform float uTrail;
  uniform float uForm;
  // The breeze: how far the clouds have drifted (seconds at their natural
  // speed); how far the whole line has rocked (px); and how far each puff
  // billows (px).
  uniform float uBreeze;
  uniform vec2 uRock;
  uniform float uBillow;
  varying vec2 vAt;
  varying vec2 vCenter;
  varying float vRadius;
  varying float vGone;
  varying float vShown;
  void main() {
    float seed = puff.w;
    vGone = state.x;
    // Forming, the puffs billow up in a scattered order, swelling into place.
    vShown = smoothstep(seed * 0.55, seed * 0.55 + 0.45, uForm);
    // Dissipating, a puff swells as it thins.
    vRadius = puff.z * (0.55 + 0.45 * vShown) * (1.0 + 0.6 * state.x);
    // A slow wave runs through the letters, each puff riding it a little
    // out of step, so the line billows rather than wobbles.
    float wave = uBreeze * 0.5 + puff.x * 0.012 + seed * 2.4;
    vec2 billow = uBillow * vec2(sin(wave), 0.6 * cos(wave * 0.8 + puff.y * 0.02));
    vCenter = puff.xy + state.yz + uRock + billow;
    // Room for the warp that keeps puffs from being perfect balls.
    vAt = vCenter + corner * (vRadius + uTrail * 0.2);
    gl_Position = vec4(vAt / uSize * 2.0 - 1.0, 0.0, 1.0);
    gl_Position.y = -gl_Position.y;
  }
`;

// Adds the puff's dome to the field, weighted by a soft maximum so puffs
// melt into each other instead of meeting at hard seams: the weight, and
// the weighted way its surface faces.
const puffFragment = /* glsl */ `
  uniform float uTrail;
  varying vec2 vAt;
  varying vec2 vCenter;
  varying float vRadius;
  varying float vGone;
  varying float vShown;
  ${noise}
  void main() {
    vec2 warp = uTrail * 0.3 * (vec2(noise(vAt / uTrail * 0.5), noise(vAt / uTrail * 0.5 + 5.2)) - 0.5);
    vec2 o = vAt + warp - vCenter;
    float q = vRadius * vRadius - dot(o, o);
    if (q <= 0.0) discard;
    float dome = sqrt(q);
    // Thinning, its dome sinks away.
    float height = dome * pow(1.0 - vGone, 1.3) * vShown;
    float soft = uTrail * 0.12;
    float weight = exp((height - uTrail) / soft) * smoothstep(0.0, uTrail * 0.05, height);
    gl_FragColor = vec4(weight, weight * vec3(o, dome) / vRadius);
  }
`;

const compositeVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const compositeFragment = /* glsl */ `
  uniform sampler2D uField;
  uniform sampler2D uDistance;
  uniform vec2 uSize;
  // The trail's reach either side of the stroke, and how far out the
  // distance is kept (px).
  uniform float uTrail;
  uniform float uReach;
  uniform float uForm;
  uniform float uScatter;
  uniform float uBreeze;
  uniform vec2 uRock;
  uniform float uNight;
  varying vec2 vUv;
  ${noise}
  void main() {
    vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSize;
    vec4 field = texture2D(uField, vUv);
    float soft = uTrail * 0.12;
    float height = field.x > 1e-7 ? max(0.0, soft * log(field.x) + uTrail) : 0.0;
    float far = texture2D(uDistance, (p - uRock) / uSize).r * uReach;
    if (height <= 0.0 && far > uTrail * 1.8) discard;

    // Cotton: fine, fibrous grain all through it, frayed at the rims.
    float grain = fbm(p / uTrail * 2.2 + uBreeze * 0.03);
    float fine = fbm(p / uTrail * 5.0 - uBreeze * 0.02);
    float body = smoothstep(0.0, uTrail * 0.45, height + (grain - 0.5) * uTrail * 0.5 + (fine - 0.5) * uTrail * 0.25)
      * smoothstep(0.0, uTrail * 0.12, height);
    // A thin haze round the trail.
    float haze = smoothstep(uTrail * 1.8, uTrail * 0.7, far) * smoothstep(0.5, 0.8, grain) * 0.18 * uForm * (1.0 - uScatter);
    float alpha = max(body * 0.96, haze);
    if (alpha <= 0.002) discard;

    // Lit from above and a little in front: mostly white, soft grey where
    // the puffs turn away underneath.
    vec3 facing = field.y == 0.0 && field.z == 0.0 && field.w == 0.0 ? vec3(0.0, 0.0, 1.0) : normalize(field.yzw);
    vec3 light = normalize(vec3(-0.2, -0.7, 0.7));
    float lit = clamp(dot(facing, light) * 0.5 + 0.5, 0.0, 1.0);
    float shade = clamp(0.1 + 0.95 * lit * lit + 0.25 * (fine - 0.5), 0.0, 1.0);
    shade = mix(shade, 0.9, 1.0 - body);
    vec3 shadow = mix(vec3(0.58, 0.64, 0.75), vec3(0.05, 0.06, 0.11), uNight);
    vec3 bright = mix(vec3(1.0, 0.995, 0.985), vec3(0.52, 0.56, 0.68), uNight);
    vec3 color = mix(shadow, bright, mix(shade, shade * shade, uNight));

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
    // The canvas composites premultiplied.
    gl_FragColor = vec4(gl_FragColor.rgb * alpha, alpha);
  }
`;

type Puff = { x: number; y: number; radius: number; seed: number };

export type Skywriting = ReturnType<typeof createSkywriting>;

export function createSkywriting() {
  const renderer = new WebGLRenderer({ antialias: false, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  const camera = new OrthographicCamera();

  // The puffs, summed into the field.
  const field = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
  });
  const puffGeometry = new InstancedBufferGeometry();
  puffGeometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(12), 3),
  );
  puffGeometry.setAttribute(
    "corner",
    new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2),
  );
  puffGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  const puffMaterial = new ShaderMaterial({
    vertexShader: puffVertex,
    fragmentShader: puffFragment,
    transparent: true,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneFactor,
    depthTest: false,
    depthWrite: false,
    // Flipped to stage coordinates, the quads wind the other way.
    side: DoubleSide,
    uniforms: {
      uSize: { value: [1, 1] },
      uTrail: { value: 1 },
      uForm: { value: 0 },
      uBreeze: { value: 0 },
      uRock: { value: [0, 0] },
      uBillow: { value: 0 },
    },
  });
  const puffMesh = new Mesh(puffGeometry, puffMaterial);
  puffMesh.frustumCulled = false;
  const puffScene = new Scene();
  puffScene.add(puffMesh);

  // The field, lit and grained into cloud.
  const empty = new DataTexture(new Uint8Array(1), 1, 1, RedFormat);
  empty.needsUpdate = true;
  const material = new ShaderMaterial({
    vertexShader: compositeVertex,
    fragmentShader: compositeFragment,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uField: { value: field.texture },
      uDistance: { value: empty },
      uSize: { value: [1, 1] },
      uTrail: { value: 1 },
      uReach: { value: 1 },
      uForm: { value: 0 },
      uScatter: { value: 0 },
      uBreeze: { value: 0 },
      uRock: { value: [0, 0] },
      uNight: { value: 0 },
    },
  });
  const geometry = new PlaneGeometry(2, 2);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);

  let puffs: Puff[] = [];
  let state = new Float32Array(0);
  // Each puff's drift speed (px/s), and seconds since it was breathed on.
  let velocity = new Float32Array(0);
  let rested = new Float32Array(0);
  let clock = 0;
  let trail = 1;
  // The letters' size (px), which the breath's reach is measured in.
  let stroke = 1;
  let written = "";

  return {
    canvas,
    resize(width: number, height: number) {
      renderer.setSize(width, height);
      field.setSize(width, height);
    },
    // Letters the line, for a stage this size. Waits for the hand to load.
    write(lines: string[], width: number, height: number, look: Lettering) {
      const key = `${lines.join("\n")}:${width}x${height}:${JSON.stringify(look)}`;
      if (key === written || !width || !height) return;
      const face = `40px ${FACES[look.face]}`;
      if (!document.fonts.check(face)) {
        void document.fonts.load(face);
        return;
      }
      written = key;
      const scale = Math.max(1, width / MASK_WIDTH);
      const mask = lettered(
        look.capitals ? lines.map((line) => line.toUpperCase()) : lines,
        Math.round(width / scale),
        Math.round(height / scale),
        look,
      );
      stroke = mask.fontSize * scale;
      trail = stroke * look.trail;
      const reach = trail * REACH;
      const far = distances(mask.ink, mask.width, mask.height);
      const data = new Uint8Array(far.length);
      for (let i = 0; i < far.length; i++)
        data[i] = Math.min(255, Math.round(((far[i]! * scale) / reach) * 255));
      const distance = new DataTexture(
        data,
        mask.width,
        mask.height,
        RedFormat,
      );
      distance.magFilter = distance.minFilter = LinearFilter;
      distance.needsUpdate = true;
      const previous = material.uniforms.uDistance!.value as DataTexture;
      if (previous !== empty) previous.dispose();
      material.uniforms.uDistance!.value = distance;
      material.uniforms.uTrail!.value = trail;
      material.uniforms.uReach!.value = reach;
      puffMaterial.uniforms.uTrail!.value = trail;
      puffMaterial.uniforms.uBillow!.value = trail * 0.4;

      // How far a point is from the pen's stroke (px).
      const strokeAt = (x: number, y: number) => {
        const mx = Math.min(mask.width - 1, Math.max(0, Math.round(x / scale)));
        const my = Math.min(
          mask.height - 1,
          Math.max(0, Math.round(y / scale)),
        );
        return far[my * mask.width + mx]! * scale;
      };
      const rng = random(1729, "skywriting");
      puffs = [];
      for (const { cell: size, body, fall } of LAYERS) {
        const cell = trail * size;
        for (let gy = 0; gy < height / cell; gy++)
          for (let gx = 0; gx < width / cell; gx++) {
            const x = (gx + 0.15 + 0.7 * rng()) * cell;
            const y = (gy + 0.15 + 0.7 * rng()) * cell;
            const radius =
              body * trail * (0.8 + 0.4 * rng()) - fall * strokeAt(x, y);
            if (radius > 0) puffs.push({ x, y, radius, seed: rng() });
          }
      }

      state = new Float32Array(puffs.length * 3);
      velocity = new Float32Array(puffs.length * 2);
      rested = new Float32Array(puffs.length).fill(Infinity);
      puffGeometry.instanceCount = puffs.length;
      puffGeometry.setAttribute(
        "puff",
        new InstancedBufferAttribute(
          new Float32Array(
            puffs.flatMap((puff) => [puff.x, puff.y, puff.radius, puff.seed]),
          ),
          4,
        ),
      );
      puffGeometry.setAttribute(
        "state",
        new InstancedBufferAttribute(state, 3),
      );
    },
    // One frame: how far the line has formed and blown apart, how far the
    // clouds around it have drifted (seconds at their natural speed), where
    // the pointer rests (stage px, or null), and how long since the last
    // frame. Returns how much cloud the pointer breathed away this frame,
    // in puffs about a fifth of the letters' size.
    update({
      width,
      height,
      form,
      scatter,
      drifted,
      pointer,
      dt,
      night,
      breath,
    }: {
      width: number;
      height: number;
      form: number;
      scatter: number;
      drifted: number;
      pointer: { x: number; y: number } | null;
      dt: number;
      night: boolean;
      breath: Breath;
    }) {
      // It stays where it was written but sways in the breeze the clouds
      // drift on: the whole line rocks a little, slow and uneven, and its
      // puffs billow, at a third of the clouds' pace.
      const swayed = drifted * SWAY;
      const rock = {
        x:
          trail *
          0.5 *
          (Math.sin(swayed * 0.23) + 0.4 * Math.sin(swayed * 0.61)),
        y: trail * 0.2 * Math.sin(swayed * 0.31 + 1.3),
      };
      for (const { uniforms } of [material, puffMaterial]) {
        uniforms.uSize!.value = [width, height];
        uniforms.uForm!.value = form;
        uniforms.uBreeze!.value = swayed;
        uniforms.uRock!.value = [rock.x, rock.y];
      }
      material.uniforms.uScatter!.value = scatter;
      material.uniforms.uNight!.value = night ? 1 : 0;
      mesh.visible = form > 0 && puffs.length > 0;
      if (!mesh.visible) return 0;

      const reach = stroke * breath.reach;
      const typical = (stroke * 0.2) ** 2;
      clock += dt;
      let breathed = 0;
      puffs.forEach((puff, index) => {
        const size = (puff.radius * puff.radius) / typical;
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
            const more = Math.max(
              0,
              Math.min(breath.depth - gone, near * breath.strength * dt),
            );
            gone += more;
            breathed += more * size;
            pushX += (dx / (distance || 1)) * breath.push * near;
            pushY += (dy / (distance || 1)) * breath.push * near;
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
          pullX =
            -gust + breath.wander * Math.sin(clock * 1.7 + puff.seed * 40);
          pullY =
            -0.25 * gust +
            breath.wander * Math.cos(clock * 1.3 + puff.seed * 23);
        } else if (rested[index] >= breath.delay && (away > 0.5 || gone > 0)) {
          // Home: a spring toward its place, turned a little sideways (each
          // puff its own way round) and wandering, more the further out.
          const spin = puff.seed < 0.5 ? -1 : 1;
          const out = Math.min(1, away / stroke);
          pullX =
            -breath.home * shiftX -
            spin * breath.swirl * breath.home * shiftY +
            breath.wander * out * Math.sin(clock * 1.3 + puff.seed * 40);
          pullY =
            -breath.home * shiftY +
            spin * breath.swirl * breath.home * shiftX +
            breath.wander * out * Math.cos(clock * 1.1 + puff.seed * 23);
          // Thickening back up as it nears its place.
          const close = 1 - out;
          gone = Math.max(
            0,
            gone - dt * breath.thicken * (0.12 + 0.75 * close * close),
          );
        }
        speedX += (pushX + pullX - breath.drag * speedX) * dt;
        speedY += (pushY + pullY - breath.drag * speedY) * dt;
        shiftX += speedX * dt;
        shiftY += speedY * dt;
        state[at] = gone;
        state[at + 1] = shiftX;
        state[at + 2] = shiftY;
        velocity[index * 2] = speedX;
        velocity[index * 2 + 1] = speedY;
      });
      puffGeometry.getAttribute("state").needsUpdate = true;
      return breathed;
    },
    render() {
      if (mesh.visible) {
        renderer.setRenderTarget(field);
        renderer.render(puffScene, camera);
        renderer.setRenderTarget(null);
      }
      renderer.render(scene, camera);
    },
    dispose() {
      puffGeometry.dispose();
      puffMaterial.dispose();
      field.dispose();
      geometry.dispose();
      (material.uniforms.uDistance!.value as DataTexture).dispose();
      empty.dispose();
      material.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

// The line, inked white on black into a mask the shape of the stage, as
// big as fits with room for the trail, in the upper middle of the sky.
function lettered(
  lines: string[],
  width: number,
  height: number,
  { face, spacing }: Lettering,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const pen = canvas.getContext("2d", { willReadFrequently: true })!;
  pen.fillStyle = "black";
  pen.fillRect(0, 0, width, height);
  let fontSize = height * 0.25;
  const type = () => {
    pen.font = `${fontSize}px ${FACES[face]}`;
    pen.letterSpacing = `${fontSize * spacing}px`;
  };
  type();
  const widest = Math.max(...lines.map((line) => pen.measureText(line).width));
  fontSize *= Math.min(1, (width * 0.84) / widest);
  type();
  pen.fillStyle = "white";
  pen.textAlign = "center";
  pen.textBaseline = "middle";
  const leading = fontSize * 1.05;
  const top = height * 0.4 - ((lines.length - 1) * leading) / 2;
  lines.forEach((line, index) =>
    // letterSpacing trails the last letter; shift back to stay centered.
    pen.fillText(
      line,
      width / 2 + (fontSize * spacing) / 2,
      top + index * leading,
    ),
  );
  const pixels = pen.getImageData(0, 0, width, height).data;
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) ink[i] = pixels[i * 4]! > 110 ? 1 : 0;
  return { ink, width, height, fontSize };
}

// How far each pixel is from the nearest inked one (px): an exact
// Euclidean distance transform, one axis at a time (Felzenszwalb).
function distances(ink: Uint8Array, width: number, height: number) {
  const squared = new Float32Array(ink.length);
  for (let i = 0; i < ink.length; i++) squared[i] = ink[i] ? 0 : 1e10;
  const size = Math.max(width, height);
  const f = new Float32Array(size);
  const d = new Float32Array(size);
  const v = new Int32Array(size);
  const z = new Float32Array(size + 1);
  const meet = (q: number, k: number) =>
    (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
  const pass = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = meet(q, k);
      while (s <= z[k]!) s = meet(q, --k);
      v[++k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1]! < q) k++;
      d[q] = (q - v[k]!) ** 2 + f[v[k]!]!;
    }
  };
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = squared[y * width + x]!;
    pass(height);
    for (let y = 0; y < height; y++) squared[y * width + x] = d[y]!;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = squared[y * width + x]!;
    pass(width);
    for (let x = 0; x < width; x++) squared[y * width + x] = Math.sqrt(d[x]!);
  }
  return squared;
}
