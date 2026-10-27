import { DoubleSide, ShaderMaterial, Texture, Vector2, Vector3 } from "three";
import { CARD } from "./geometry";
import type { Config, Pattern } from "./config";

// Japanese origami paper. The outside of the plane is chiyogami: a dyed
// washi ground, a silkscreened pattern in one ink, and the odd fleck of gold
// leaf. The inside is undyed washi carrying the printed invitation. Both
// sides show kozo fibers (long, pale, wandering) and the uneven density of
// handmade pulp.

const vertex = /* glsl */ `
  attribute vec2 rest;
  varying vec2 vRest;
  varying vec3 vWorld;
  void main() {
    vRest = rest;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uPaper;
  uniform vec3 uDye;
  uniform vec3 uInk;
  uniform vec3 uGold;
  uniform int uPattern;
  uniform float uScale;
  uniform float uFibers;
  uniform float uMottle;
  uniform float uGoldAmount;
  uniform float uSeed;
  uniform sampler2D uPrint;
  uniform vec2 uSheet;
  uniform vec3 uLight;
  varying vec2 vRest;
  varying vec3 vWorld;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21) + uSeed);
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
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p *= 2.03;
      amplitude *= 0.5;
    }
    return value;
  }

  // Kozo fibers: isolines of stretched noise make long, thin, wandering
  // strands; a second noise thins them out into clumps.
  float fibers(vec2 p) {
    float strands = 0.0;
    for (int i = 0; i < 3; i++) {
      float a = float(i) * 2.17 + uSeed * 6.0;
      mat2 turn = mat2(cos(a), -sin(a), sin(a), cos(a));
      vec2 q = turn * p;
      float n = noise(vec2(q.x * 0.03, q.y * 0.28) + float(i) * 17.0);
      float width = fwidth(n) * 1.2 + 0.006;
      float strand = 1.0 - smoothstep(0.0, width, abs(n - 0.5));
      float clump = smoothstep(0.4, 0.8, noise(q * 0.015 + float(i) * 31.0));
      strands += strand * clump;
    }
    return clamp(strands, 0.0, 1.0);
  }

  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
  }

  // Seigaiha: rows of concentric arcs, each row tucked under the one below.
  float seigaiha(vec2 p) {
    float first = floor((p.y - 1.0) / 0.5);
    for (int k = 0; k < 6; k++) {
      float row = first + float(k);
      float offset = mod(row, 2.0);
      vec2 center = vec2(floor((p.x - offset) / 2.0 + 0.5) * 2.0 + offset, row * 0.5);
      float d = length(p - center);
      if (d < 1.0) {
        float rings = d * 4.0;
        return abs(rings - floor(rings + 0.5)) / 4.0;
      }
    }
    return 1.0;
  }

  // Asanoha: a triangular lattice, each triangle split from its center to
  // its corners, making six-pointed hemp leaves.
  float asanoha(vec2 p) {
    const float h = 0.8660254;
    float b = p.y / h;
    float a = p.x - 0.5 * b;
    vec2 cell = floor(vec2(a, b));
    vec2 f = vec2(a, b) - cell;
    vec2 origin = vec2(cell.x + 0.5 * cell.y, cell.y * h);
    vec2 v0 = origin;
    vec2 v1 = origin + vec2(1.0, 0.0);
    vec2 v2 = origin + vec2(0.5, h);
    if (f.x + f.y >= 1.0) v0 = origin + vec2(1.5, h);
    vec2 c = (v0 + v1 + v2) / 3.0;
    float d = min(min(segment(p, v0, v1), segment(p, v1, v2)), segment(p, v2, v0));
    return min(d, min(min(segment(p, c, v0), segment(p, c, v1)), segment(p, c, v2)));
  }

  // Shippo: interlocking rings, one on every lattice point.
  float shippo(vec2 p) {
    vec2 base = floor(p);
    float d = 1.0;
    for (int i = 0; i < 2; i++) {
      for (int j = 0; j < 2; j++) {
        d = min(d, abs(length(p - base - vec2(float(i), float(j))) - 0.70710678));
      }
    }
    return d;
  }

  float pattern(vec2 p) {
    if (uPattern == 0) return seigaiha(p);
    if (uPattern == 1) return asanoha(p);
    if (uPattern == 2) return shippo(p);
    return 1.0;
  }

  float lighting(vec3 n) {
    float wrap = clamp((dot(n, uLight) + 0.35) / 1.35, 0.0, 1.0);
    return 0.22 + 0.9 * wrap;
  }

  void main() {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 view = normalize(cameraPosition - vWorld);
    if (dot(n, view) < 0.0) n = -n;

    vec2 p = vRest;
    float pulp = fbm(p * 0.018) - 0.5;
    float strands = fibers(p) * uFibers;
    vec3 color;
    float shine = 0.0;

    // A paper plane's wing tops and nose flaps show the back of the sheet,
    // so the pattern goes there (-z) and the invitation on the front.
    if (gl_FrontFacing) {
      // The inside: undyed washi with the invitation printed on it.
      color = uPaper * (1.0 + pulp * 0.07 * uMottle);
      color = mix(color, color * 1.04 + 0.015, strands * 0.7);
      vec2 uv = vec2(p.y / uSheet.y, (p.x + uSheet.x * 0.5) / uSheet.x);
      vec4 ink = texture2D(uPrint, uv);
      color = mix(color, ink.rgb, ink.a * (0.88 + 0.12 * noise(p * 0.4)));
    } else {
      // The outside: dyed unevenly, so pale fibers and thin pulp show.
      color = uDye * (1.0 + pulp * 0.32 * uMottle);
      color = mix(color, color * 1.45 + 0.025, strands * 0.55);
      float d = pattern(p / uScale);
      float edge = fwidth(d) * 1.4;
      // Seigaiha's rings sit closer together than the other lattices.
      float width = uPattern == 0 ? 0.014 : 0.035;
      float line = 1.0 - smoothstep(width, width + edge, d);
      // Screen ink sits unevenly and skips where fibers stand proud.
      line *= (0.78 + 0.22 * noise(p * 0.35)) * (1.0 - strands * 0.35);
      color = mix(color, uInk, line);
      float leaf = noise(p * 0.32 + 50.0) * noise(p * 0.06 + 3.0);
      float fleck = smoothstep(0.5 - 0.22 * uGoldAmount, 0.53 - 0.22 * uGoldAmount, leaf)
        * step(0.001, uGoldAmount);
      color = mix(color, uGold * (0.85 + 0.3 * noise(p * 1.3)), fleck);
      shine = fleck;
    }

    // Normalized so paper lying flat shows its true color.
    float lit = lighting(n) / lighting(vec3(0.0, 0.0, 1.0));
    color *= lit;
    float glint = pow(max(dot(reflect(-uLight, n), view), 0.0), 18.0);
    color += uGold * glint * shine * 0.8;
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const patterns: Record<Pattern, number> = {
  seigaiha: 0,
  asanoha: 1,
  shippo: 2,
  plain: 3,
};

// OKLCH to linear sRGB, so shader colors match the CSS colors exactly.
export function oklchLinear(l: number, c: number, h: number) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lms = [
    l + 0.3963377774 * a + 0.2158037573 * b,
    l - 0.1055613458 * a - 0.0638541728 * b,
    l - 0.0894841775 * a - 1.291485548 * b,
  ].map((value) => value ** 3) as [number, number, number];
  const [x, y, z] = lms;
  const clampUnit = (value: number) => Math.min(1, Math.max(0, value));
  return new Vector3(
    clampUnit(4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z),
    clampUnit(-1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z),
    clampUnit(-0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z),
  );
}

export function createPaperMaterial() {
  return new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: DoubleSide,
    uniforms: {
      uPaper: { value: new Vector3() },
      uDye: { value: new Vector3() },
      uInk: { value: new Vector3() },
      uGold: { value: oklchLinear(0.8, 0.12, 85) },
      uPattern: { value: 0 },
      uScale: { value: 22 },
      uFibers: { value: 0.5 },
      uMottle: { value: 0.5 },
      uGoldAmount: { value: 0.3 },
      uSeed: { value: 0 },
      uPrint: { value: new Texture() },
      uSheet: { value: new Vector2(CARD.height, CARD.width) },
      uLight: { value: new Vector3(0, 0, 1) },
    },
  });
}

export function updatePaperMaterial(material: ShaderMaterial, config: Config) {
  const { washi, paper, plane } = config;
  const u = material.uniforms;
  u.uPaper!.value = oklchLinear(paper.lightness, paper.warmth, 80);
  u.uDye!.value = oklchLinear(washi.lightness, washi.chroma, washi.hue);
  u.uInk!.value = oklchLinear(
    washi.inkLightness,
    Math.min(washi.chroma, 0.1),
    washi.inkHue,
  );
  u.uPattern!.value = patterns[config.pattern];
  u.uScale!.value = washi.scale;
  u.uFibers!.value = washi.fibers;
  u.uMottle!.value = washi.mottle;
  u.uGoldAmount!.value = washi.gold;
  u.uSeed!.value = (config.seed % 1000) / 1000;
  const angle = (plane.light * Math.PI) / 180;
  // Low and from the upper left, so each facet catches it differently.
  u.uLight!.value = new Vector3(
    -Math.cos(angle) * 1.1,
    Math.sin(angle) * 1.1,
    1,
  ).normalize();
}
