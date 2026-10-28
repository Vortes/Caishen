import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";
import { clamp, random, type Config } from "./config";
import { airSeconds, flightPose } from "./flight";
import { CARD } from "./geometry";

// A cloud sits on the plane's path. The plane flies straight into it and it
// goes "poof": its puffs burst outward, swell, thin into wisps, and are
// gone. Like the flight, it's a pure function of time.

export const cloudNoise = /* glsl */ `
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      amplitude *= 0.5;
    }
    return value;
  }
`;

// Each puff is a camera-facing sprite. It drifts out from the cloud's
// middle as the cloud bursts, faster the smaller it is, carried a little
// the way the plane was going.
const vertex = /* glsl */ `
  attribute vec3 offset;
  attribute vec2 corner;
  attribute vec3 puff;
  uniform float uPoof;
  uniform vec3 uPush;
  varying vec2 vCorner;
  varying float vSeed;
  varying float vHeight;
  void main() {
    float size = puff.x;
    float speed = puff.y;
    vSeed = puff.z;
    vCorner = corner;
    float burst = 1.0 - pow(1.0 - uPoof, 3.0);
    vec3 center = offset * (1.0 + 2.4 * speed * burst) + uPush * speed * burst;
    vHeight = offset.z;
    vec4 view = modelViewMatrix * vec4(center, 1.0);
    view.xy += corner * size * (1.0 + 1.1 * burst);
    gl_Position = projectionMatrix * view;
  }
`;

const fragment = /* glsl */ `
  uniform float uPoof;
  uniform float uRadius;
  uniform float uNight;
  varying vec2 vCorner;
  varying float vSeed;
  varying float vHeight;
  ${cloudNoise}
  void main() {
    float r = length(vCorner);
    if (r > 1.0) discard;
    float n = fbm(vCorner * 1.1 + vSeed * 7.0 + uPoof * 0.8);
    // A round, soft-edged puff with a lumpy rim.
    float body = smoothstep(1.0, 0.35, r + (n - 0.5) * 0.45);
    body *= body;
    // Bursting, it frays: the thin parts go first.
    float fray = smoothstep(uPoof * 0.8, uPoof * 0.8 + 0.3, n);
    float alpha = body * mix(1.0, fray, uPoof) * pow(1.0 - uPoof, 1.4);
    // Lit from above: bright tops, cool blue-grey undersides. By moonlight
    // the tops are silver and the undersides nearly the night sky.
    float light = clamp(0.62 + 0.3 * vCorner.y + 0.35 * vHeight / uRadius + 0.2 * (n - 0.5), 0.0, 1.0);
    vec3 shadow = mix(vec3(0.70, 0.78, 0.90), vec3(0.03, 0.04, 0.08), uNight);
    vec3 lit = mix(vec3(1.0, 0.995, 0.98), vec3(0.46, 0.5, 0.62), uNight);
    vec3 color = mix(shadow, lit, mix(light, light * light, uNight));
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

const PUFFS = 26;

// Where the cloud sits (table frame, y up the screen) and when the plane
// first touches it.
let hitCache: {
  key: string;
  value: { center: Vector3; contact: number; push: Vector3 };
} | null = null;
export function cloudHit(config: Config) {
  const key = JSON.stringify([config.flight, config.plane.tilt, config.cloud]);
  if (hitCache?.key === key) return hitCache.value;
  const at = config.cloud.at * airSeconds(config);
  const position = (t: number) => {
    const pose = flightPose(config, t);
    return new Vector3(pose.x, -pose.y, pose.z);
  };
  const center = position(at);
  const reach = config.cloud.size * CARD.width * 0.55;
  let contact = at;
  while (contact > 0 && position(contact).distanceTo(center) < reach)
    contact -= 1 / 240;
  const push = position(at + 0.05)
    .sub(position(at - 0.05))
    .normalize()
    .multiplyScalar(reach * 0.9);
  const value = { center, contact, push };
  hitCache = { key, value };
  return value;
}

// How far the burst has got, a given time into the arrival.
export const poofProgress = (config: Config, elapsed: number) =>
  clamp((elapsed - cloudHit(config).contact) / config.cloud.poof);

function puffGeometry(config: Config) {
  const rng = random(config.seed, "cloud");
  const radius = config.cloud.size * CARD.width;
  const offsets: number[] = [];
  const corners: number[] = [];
  const puffs: number[] = [];
  const quad = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (let i = 0; i < PUFFS; i++) {
    // A flattened heap: wide, a little deep, flat underneath.
    const angle = rng() * Math.PI * 2;
    const out = Math.sqrt(rng());
    const x = Math.cos(angle) * out * radius * 0.6;
    const y = Math.sin(angle) * out * radius * 0.35;
    const z = (rng() * 0.7 - 0.2) * radius * 0.45;
    const size = radius * (0.22 + 0.3 * rng()) * (1 - 0.35 * out);
    const speed = 0.6 + 0.8 * (1 - size / (radius * 0.52));
    for (const [cx, cy] of quad) {
      offsets.push(x, y, z);
      corners.push(cx!, cy!);
      puffs.push(size, speed, rng());
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(offsets), 3),
  );
  geometry.setAttribute(
    "offset",
    new BufferAttribute(new Float32Array(offsets), 3),
  );
  geometry.setAttribute(
    "corner",
    new BufferAttribute(new Float32Array(corners), 2),
  );
  geometry.setAttribute(
    "puff",
    new BufferAttribute(new Float32Array(puffs), 3),
  );
  return geometry;
}

export function createCloud() {
  const mesh = new Mesh(
    new BufferGeometry(),
    new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uPoof: { value: 0 },
        uPush: { value: new Vector3() },
        uRadius: { value: 1 },
        uNight: { value: 0 },
      },
    }),
  );
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

let shapeKey = "";
export function updateCloud(
  mesh: Mesh<BufferGeometry, ShaderMaterial>,
  config: Config,
  poof: number,
  night: boolean,
) {
  const key = JSON.stringify([config.seed, config.cloud.size]);
  if (key !== shapeKey || !mesh.geometry.getAttribute("offset")) {
    mesh.geometry.dispose();
    mesh.geometry = puffGeometry(config);
    shapeKey = key;
  }
  const { uniforms } = mesh.material;
  uniforms.uPoof!.value = poof;
  uniforms.uPush!.value = cloudHit(config).push;
  uniforms.uRadius!.value = config.cloud.size * CARD.width;
  uniforms.uNight!.value = night ? 1 : 0;
  mesh.visible = config.cloud.size > 0 && poof < 1;
}
