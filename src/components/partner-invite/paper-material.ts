import {
  DoubleSide,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import type { Washi } from "~/domain/invitation";
import { config } from "./config";
import { deckleMask } from "./deckle-mask";
import { CARD } from "./geometry";
import { sheetCreases } from "./harrier";

// Japanese origami paper. The outside of the plane is chiyogami: a dyed
// washi ground, silkscreened seigaiha waves in one ink, and the odd fleck of gold
// leaf, with kozo fibers (long, pale, wandering) and the uneven density of
// handmade pulp showing through the dye. The inside is the printed card:
// the same paper and deckle as the SVG card it hands over to.

const vertex = /* glsl */ `
  attribute vec2 rest;
  attribute float seam;
  attribute float torn;
  varying vec2 vRest;
  varying vec3 vWorld;
  varying vec3 vLocal;
  varying float vSeam;
  varying float vTorn;
  void main() {
    vRest = rest;
    vLocal = position;
    vSeam = seam;
    vTorn = torn;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragment = /* glsl */ `
  #define CREASES ${sheetCreases.length}
  uniform vec4 uCreases[CREASES];
  uniform float uCrease;
  uniform vec3 uCreaseShadow;
  uniform vec3 uCreaseLight;
  uniform vec3 uPaper;
  uniform vec3 uDye;
  uniform vec3 uInk;
  uniform vec3 uGold;
  uniform float uScale;
  uniform float uFibers;
  uniform float uMottle;
  uniform float uGoldAmount;
  uniform float uSeed;
  uniform sampler2D uPrint;
  uniform vec2 uSheet;
  uniform vec3 uLight;
  uniform float uTear;
  uniform float uLifted;
  uniform float uRagged;
  uniform vec3 uCore;
  uniform sampler2D uSeal;
  uniform float uStamped;
  uniform vec2 uSealAt;
  uniform float uSealTilt;
  uniform float uSealSize;
  uniform vec3 uSealField;
  uniform vec3 uSealPool;
  uniform float uSealWet;
  uniform float uInkTake;
  uniform float uDent;
  uniform vec2 uOver;
  uniform float uShown;
  uniform float uShimmer;
  uniform sampler2D uDeckle;
  varying vec2 vRest;
  varying vec3 vWorld;
  varying vec3 vLocal;
  varying float vSeam;
  varying float vTorn;

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

  // How much of this pixel a crease line covers. The lines are thinner
  // than a pixel, so they fade by coverage rather than vanish.
  float crease(vec2 p) {
    float d = 1e4;
    for (int i = 0; i < CREASES; i++) {
      d = min(d, segment(p, uCreases[i].xy, uCreases[i].zw));
    }
    float px = max(fwidth(d), 1e-4);
    return (1.0 - smoothstep(0.0, px, d - 0.35)) * min(1.0, 0.7 / px);
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

  float lighting(vec3 n) {
    float wrap = clamp((dot(n, uLight) + 0.35) / 1.35, 0.0, 1.0);
    return 0.22 + 0.9 * wrap;
  }

  // A torn edge, for one half of a sheet torn in two. vSeam is how far
  // inside this half's paper the pixel sits; vTorn is whether the tear has
  // reached it yet. Returns coverage, and how much bare pulp shows.
  vec2 tornEdge() {
    if (vTorn <= 0.0) return vec2(step(0.0, vSeam), 0.0);
    float along = vRest.x;
    float side = uLifted * 9.0;
    // The line wavers at the scale of single fiber bundles.
    float rag = (noise(vec2(along * 0.7, 3.0 + side)) - 0.5) * 2.2 * uRagged;
    float body = vSeam + rag * vTorn;
    // Fibers pulled out of the edge reach across the gap, thinning toward
    // their tips.
    float reach = (1.5 + 3.5 * noise(vec2(along * 0.45, 11.0 + side))) * uRagged * vTorn;
    float past = clamp(-body / max(reach, 1e-3), 0.0, 1.0);
    float strand = smoothstep(0.5 + 0.35 * past, 0.62 + 0.35 * past,
      noise(vec2(along * 1.9, 40.0 + side)));
    float coverage = body >= 0.0 ? 1.0 : strand * (1.0 - past) * 0.8;
    // The flap torn toward you is beveled: its top layer gives way first,
    // leaving a band of bare, unsized pulp along the edge.
    float width = (1.0 + 2.8 * noise(vec2(along * 0.22, 7.0))) * uRagged;
    float pulp = body < 0.0 ? 1.0 : (1.0 - smoothstep(0.0, width, body)) * uLifted;
    return vec2(coverage, pulp * vTorn);
  }

  vec2 turn(vec2 p, float a) {
    return vec2(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y);
  }

  // The seal's impression, in card coordinates (y down) like the print.
  vec3 stamp(vec3 color) {
    vec2 card = vec2(vRest.y - uSheet.y * 0.5, vRest.x);
    vec2 uv = turn(card - uSealAt, -uSealTilt) / (uSealSize * 2.0) + 0.5;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
      return color;
    }
    vec3 mask = texture2D(uSeal, uv).rgb;
    // The face is never quite flat, so ink takes where it first touches
    // and spreads out from there, unevenly, through the fibers.
    vec2 q = card - uSealAt;
    float contact = 0.55 * length(q) / (uSealSize * 0.72)
      + 0.45 * fbm(card * 0.22 + 7.0);
    float taken = smoothstep(contact - 0.12, contact, uInkTake * 1.15);
    vec3 ink = mix(uSealField, uSealPool, mask.g);
    color = mix(color, ink, 0.92 * max(mask.r, mask.g) * taken);
    color = mix(color, vec3(1.0), 0.37 * uSealWet * mask.b * taken);
    // The press leaves a dent the shape of the face. Lit from the upper
    // left, its far wall catches light and its near wall falls in shade.
    vec2 toLight = turn(vec2(-0.7, -0.7), -uSealTilt) / (uSealSize * 2.0);
    float here = max(mask.r, mask.g);
    float wall = here - max(texture2D(uSeal, uv + toLight * 1.4).r,
      texture2D(uSeal, uv + toLight * 1.4).g);
    color *= 1.0 - 0.16 * max(wall, 0.0) * uDent;
    color += 0.05 * max(-wall, 0.0) * uDent;
    return color;
  }

  // The right half, lying over the left, shades a sliver beside its torn
  // edge: vSeam + uOver.x is how far this pixel is from that edge, and the
  // higher the right half rides, the softer the shadow.
  float shaded() {
    if (uTear < 0.5 || uLifted > 0.5) return 0.0;
    float d = vSeam + uOver.x;
    // Below the tear's tip the paper is still one sheet: nothing to shade.
    return 0.24 * vTorn * exp(-max(d, 0.0) / (1.2 + uOver.y * 0.5));
  }

  void main() {
    vec2 edge = uTear > 0.5 ? tornEdge() : vec2(1.0, 0.0);
    // The card's deckled outline, shared with the printed card.
    float cut = texture2D(uDeckle, vec2(
      vRest.y / uSheet.y,
      (vRest.x + uSheet.x * 0.5) / uSheet.x
    )).r;
    // Only the torn card blends; the folded sheet cuts its edge clean.
    edge.x *= uTear > 0.5 ? cut : step(0.5, cut);
    edge.x *= uShown;
    if (edge.x < 0.03) discard;
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
      // The inside: undyed washi with the invitation printed on it. It's
      // the printed card's paper exactly, so the two can hand over without
      // the surface changing.
      color = uPaper;
      vec2 uv = vec2(p.y / uSheet.y, (p.x + uSheet.x * 0.5) / uSheet.x);
      vec4 ink = texture2D(uPrint, uv);
      color = mix(color, ink.rgb, ink.a * (0.88 + 0.12 * noise(p * 0.4)));
    } else {
      // The outside: dyed unevenly, so pale fibers and thin pulp show.
      color = uDye * (1.0 + pulp * 0.32 * uMottle);
      color = mix(color, color * 1.45 + 0.025, strands * 0.55);
      float d = seigaiha(p / uScale);
      float edge = fwidth(d) * 1.4;
      float line = 1.0 - smoothstep(0.014, 0.014 + edge, d);
      // Screen ink sits unevenly and skips where fibers stand proud.
      line *= (0.78 + 0.22 * noise(p * 0.35)) * (1.0 - strands * 0.35);
      color = mix(color, uInk, line);
      float leaf = noise(p * 0.32 + 50.0) * noise(p * 0.06 + 3.0);
      float fleck = smoothstep(0.5 - 0.22 * uGoldAmount, 0.53 - 0.22 * uGoldAmount, leaf)
        * step(0.001, uGoldAmount);
      color = mix(color, uGold * (0.85 + 0.3 * noise(p * 1.3)), fleck);
      shine = fleck;
    }

    // The folds stay pressed into the paper: a shadow along each crease
    // and a sliver of light just beside it, as on the printed card.
    float shadow = crease(p) * uCrease;
    float light = crease(p - vec2(0.6, 0.8)) * uCrease;
    if (gl_FrontFacing) {
      color = mix(color, uCreaseShadow, shadow);
      color = mix(color, uCreaseLight, light);
    } else {
      color = mix(color, color * 0.62, shadow);
      color = mix(color, color * 1.12, light);
    }

    if (uStamped > 0.5 && gl_FrontFacing) color = stamp(color);
    color = mix(color, uCore * (1.0 + pulp * 0.05), edge.y * 0.92);
    color *= 1.0 - shaded();
    // The other flap's edge dips away, a shade darker.
    float dip = (1.0 - smoothstep(0.0, 0.9, vSeam)) * vTorn * (1.0 - uLifted);
    color *= 1.0 - 0.16 * dip * uTear;

    // Normalized so paper lying flat shows its true color.
    float lit = lighting(n) / lighting(vec3(0.0, 0.0, 1.0));
    color *= lit;
    float glint = pow(max(dot(reflect(-uLight, n), view), 0.0), 18.0);
    color += uGold * glint * shine * 0.8;
    // Once, a sheen sweeps across the face as it catches the light, the
    // fibers standing proud of it catching most.
    if (uShimmer > 0.0 && uShimmer < 1.0 && gl_FrontFacing) {
      float across = (p.y - uSheet.y * 0.5) / (uSheet.y * 0.5)
        + (p.x / uSheet.x + 0.5) * 0.45;
      float band = exp(-pow((across - mix(-0.35, 1.8, uShimmer)) / 0.12, 2.0));
      color += vec3(1.0, 0.95, 0.85) * band * (0.22 + 0.35 * strands);
      color += uGold * band * 0.08;
    }
    gl_FragColor = vec4(color, edge.x);
    #include <colorspace_fragment>
  }
`;

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

// Dyes the outside of the sheet.
export function dyePaper(material: ShaderMaterial, { dye, ink }: Washi) {
  material.uniforms.uDye!.value = oklchLinear(
    dye.lightness,
    dye.chroma,
    dye.hue,
  );
  material.uniforms.uInk!.value = oklchLinear(
    ink.lightness,
    Math.min(dye.chroma, 0.1),
    ink.hue,
  );
}

export function createPaperMaterial(dyed: Washi) {
  const { washi, paper, plane } = config;
  const angle = (plane.light * Math.PI) / 180;
  const material = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: DoubleSide,
    uniforms: {
      uPaper: { value: oklchLinear(paper.lightness, paper.warmth, 80) },
      uDye: { value: new Vector3() },
      uInk: { value: new Vector3() },
      uGold: { value: oklchLinear(0.8, 0.12, 85) },
      uScale: { value: washi.scale },
      uFibers: { value: washi.fibers },
      uMottle: { value: washi.mottle },
      uGoldAmount: { value: washi.gold },
      uSeed: { value: (config.seed % 1000) / 1000 },
      uPrint: { value: new Texture() },
      uSheet: { value: new Vector2(CARD.height, CARD.width) },
      // Low and from the upper left, so each facet catches it differently.
      uLight: {
        value: new Vector3(
          -Math.cos(angle) * 1.1,
          Math.sin(angle) * 1.1,
          1,
        ).normalize(),
      },
      uCreases: {
        value: sheetCreases.map(([a, b]) => new Vector4(a.x, a.y, b.x, b.y)),
      },
      uCrease: { value: paper.crease },
      uCreaseShadow: {
        value: oklchLinear(paper.lightness - 0.16, paper.warmth, 80),
      },
      uCreaseLight: {
        value: oklchLinear(paper.lightness + 0.04, paper.warmth, 80),
      },
      uTear: { value: 0 },
      uLifted: { value: 0 },
      uRagged: { value: config.tear.ragged },
      uCore: {
        value: oklchLinear(
          Math.min(1, paper.lightness + 0.045),
          paper.warmth * 0.2,
          80,
        ),
      },
      uSeal: { value: new Texture() },
      uStamped: { value: 0 },
      uSealAt: { value: new Vector2() },
      uSealTilt: { value: 0 },
      uSealSize: { value: config.seal.size },
      uSealField: { value: new Vector3() },
      uSealPool: { value: new Vector3() },
      uSealWet: { value: 0 },
      uInkTake: { value: 0 },
      uDent: { value: 0 },
      // How far the right half's edge sits from the left's, and how high.
      uOver: { value: new Vector2(1e4, 0) },
      uShown: { value: 1 },
      uShimmer: { value: -1 },
      uDeckle: { value: deckleMask() },
    },
  });
  dyePaper(material, dyed);
  return material;
}
