import { cloudNoise } from "./cloud";
import { config } from "./config";

// The near clouds' scale, and how fast they drift: in stage heights a
// second, leftward, at their natural speed.
const NEAR_SCALE = 1.3;
export const NEAR_DRIFT = 0.014 / NEAR_SCALE;

export const skyVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Each sky supplies its backdrop, where its light sits, and how that light
// falls on cloud; the clouds and the veil are shared.

// By day, haze runs from a deep, even blue with thin, bright cloud, like a
// photo shot looking up (0), to a paler sky fading to white low down, a
// soft sun up to the right, and puffier cloud with blue-grey shadows (1).
const daySky = /* glsl */ `
  #define FAR_COVER mix(0.58, 0.56, uHaze)
  #define NEAR_COVER mix(0.64, 0.6, uHaze)
  #define SOFTNESS mix(0.32, 0.18, uHaze)
  vec2 lightAt(float aspect) { return vec2(aspect * 0.86, 0.94); }

  vec3 backdrop(vec2 p, vec2 light) {
    vec3 zenith = mix(vec3(0.035, 0.22, 0.72), vec3(0.16, 0.45, 0.86), uHaze);
    vec3 horizon = mix(vec3(0.16, 0.42, 0.84), vec3(0.70, 0.86, 0.97), uHaze);
    float rise = mix(smoothstep(0.0, 1.0, vUv.y), pow(vUv.y, 0.8), uHaze);
    vec3 sky = mix(horizon, zenith, rise);
    float toward = distance(p, light);
    vec3 clear = vec3(0.5, 0.6, 0.7) * 0.12 * exp(-toward * 1.6);
    vec3 hazy = vec3(1.0, 0.93, 0.78) * (0.55 * exp(-toward * 7.0) + 0.18 * exp(-toward * 1.8));
    return sky + mix(clear, hazy, uHaze);
  }

  vec3 cloudColor(float shade, float near) {
    vec3 shadow = mix(vec3(0.52, 0.66, 0.88), vec3(0.72, 0.80, 0.92), uHaze);
    vec3 lit = mix(vec3(1.0, 1.0, 0.99), vec3(1.0, 0.995, 0.97), uHaze);
    return mix(shadow, lit, shade);
  }
`;

// A clear night: deep indigo overhead, a faint glow of city light low
// down, a field of twinkling stars, and a gibbous moon up to the left with
// its maria and craters. The clouds are dark shapes against the stars, their
// edges silvered toward the moon, and they pass in front of it.
const nightSky = /* glsl */ `
  #define FAR_COVER 0.62
  #define NEAR_COVER 0.66
  #define SOFTNESS 0.18
  #define MOON_RADIUS 0.06
  vec2 lightAt(float aspect) { return vec2(max(aspect * 0.2, 0.14), 0.85); }

  // Small and sharp, a few bright; each twinkles at its own rate.
  float stars(vec2 p, float scale) {
    vec2 cell = floor(p * scale);
    vec2 at = fract(p * scale);
    float h = hash(cell);
    if (h > 0.16) return 0.0;
    vec2 center = vec2(hash(cell + 7.3), hash(cell + 1.9)) * 0.7 + 0.15;
    float size = mix(0.02, 0.07, pow(hash(cell + 3.7), 6.0));
    float d = length(at - center);
    float twinkle = 0.65 + 0.35 * sin(uTime * (1.0 + 3.0 * hash(cell + 5.1)) + h * 60.0);
    return smoothstep(size, 0.0, d) * twinkle;
  }

  // Craters: a dished floor with a raised, lit rim, in a jittered grid.
  float craters(vec2 p) {
    vec2 cell = floor(p);
    float relief = 0.0;
    for (int i = -1; i <= 1; i++) {
      for (int j = -1; j <= 1; j++) {
        vec2 c = cell + vec2(float(i), float(j));
        if (hash(c + 11.0) > 0.55) continue;
        vec2 center = c + vec2(hash(c), hash(c + 4.1));
        float r = mix(0.12, 0.42, pow(hash(c + 8.3), 2.0));
        float d = length(p - center) / r;
        relief += -0.6 * (1.0 - smoothstep(0.0, 1.0, d)) + 0.5 * exp(-pow((d - 1.0) * 5.0, 2.0));
      }
    }
    return relief;
  }

  float surface(vec2 s) {
    return craters(s * 3.2) * 0.5 + craters(s * 7.0 + 3.0) * 0.3;
  }

  vec4 moon(vec2 p, vec2 at) {
    vec2 d = (p - at) / MOON_RADIUS;
    float r = length(d);
    float pixel = 1.0 / (MOON_RADIUS * uSize.y);
    float disc = 1.0 - smoothstep(1.0 - pixel * 1.5, 1.0 + pixel * 1.5, r);
    if (disc <= 0.0) return vec4(0.0);
    vec3 n = vec3(d, sqrt(max(1.0 - r * r, 0.0)));
    // Surface coordinates squeeze toward the limb, as on a sphere.
    vec2 s = d / (0.6 + 0.4 * n.z);
    float maria = smoothstep(0.52, 0.66, fbm(s * 1.4 + 4.0));
    float relief = surface(s);
    vec3 sun = normalize(vec3(-0.62, 0.22, 0.75));
    // Craters tip the surface normal, so rims catch the sun and floors don't.
    vec2 slope = vec2(surface(s + vec2(0.01, 0.0)), surface(s + vec2(0.0, 0.01))) - relief;
    vec3 bumped = normalize(n - vec3(slope * 1.4, 0.0));
    float lit = smoothstep(-0.08, 0.3, dot(bumped, sun));
    vec3 ground = mix(vec3(0.93, 0.91, 0.84), vec3(0.52, 0.53, 0.55), maria * 0.75);
    ground *= 0.9 + 0.12 * fbm(s * 9.0) + relief * 0.12;
    // The limb darkens a little; the night side shows faint earthshine.
    vec3 color = ground * (0.72 + 0.28 * pow(n.z, 0.5)) * mix(0.035, 1.0, lit);
    return vec4(color, disc);
  }

  vec3 backdrop(vec2 p, vec2 light) {
    vec3 zenith = vec3(0.002, 0.003, 0.014);
    vec3 horizon = vec3(0.016, 0.022, 0.062);
    vec3 sky = mix(horizon, zenith, pow(vUv.y, 0.7));
    float toward = distance(p, light) / MOON_RADIUS;
    // The moon washes out the stars around it.
    float glare = exp(-toward * 1.1) * 0.4 + exp(-toward * 0.25) * 0.06;
    float field = stars(p, 70.0) + stars(p + 13.7, 140.0) * 0.6;
    field *= smoothstep(0.0, 0.35, vUv.y) * (1.0 - clamp(glare * 4.0, 0.0, 1.0));
    sky += vec3(0.8, 0.86, 1.0) * field * 0.8;
    sky += vec3(0.55, 0.62, 0.8) * glare;
    vec4 m = moon(p, light);
    return mix(sky, m.rgb, m.a);
  }

  vec3 cloudColor(float shade, float near) {
    vec3 body = vec3(0.006, 0.008, 0.02);
    vec3 rim = vec3(0.2, 0.22, 0.3) * (0.08 + 2.4 * near);
    return mix(body, rim, pow(smoothstep(0.4, 1.0, shade), 1.5));
  }
`;

const fragment = (variant: string) => /* glsl */ `
  uniform float uTime;
  // How far the clouds have drifted, in seconds at their natural speed.
  uniform float uDrift;
  uniform vec2 uSize;
  uniform float uCover;
  uniform float uOpen;
  // Fixed, so the compiler folds the day sky's blends away.
  #define uHaze ${config.sky.haze.toFixed(3)}
  // How much of the open sky the drifting clouds fill, 0 to 1.
  uniform float uClouds;
  varying vec2 vUv;
  ${cloudNoise}
  ${variant}

  float heapDensity(vec2 p) {
    vec2 warp = vec2(fbm(p * 0.6 + 3.1), fbm(p * 0.6 - 5.7));
    return fbm(p + warp * 0.8);
  }

  // Puffy cumulus: warped fbm, cut off below a coverage threshold, lit from
  // the light's side by sampling a step toward it. Hands back the density
  // too, so the bank's seams can be cut from it without working it out again.
  vec4 clouds(vec2 p, float cover, vec2 toLight, float near, out float density) {
    vec2 warp = vec2(fbm(p * 0.6 + 3.1), fbm(p * 0.6 - 5.7));
    density = fbm(p + warp * 0.8);
    float shape = smoothstep(cover, cover + SOFTNESS, density);
    float lit = fbm(p + warp * 0.8 + toLight * 0.12);
    float shade = clamp(0.5 + (density - lit) * 4.0, 0.0, 1.0);
    return vec4(cloudColor(shade, near), shape);
  }

  void main() {
    float aspect = uSize.x / uSize.y;
    vec2 p = vec2(vUv.x * aspect, vUv.y);
    vec2 light = lightAt(aspect);

    // 0 in the middle of the stage, 1 at the middle of each edge.
    vec2 middle = vec2(aspect * 0.5, 0.5);
    vec2 fromMiddle = p - middle;
    float edge = length(fromMiddle / middle);
    // Parting, the clouds stream outward past the edges.
    vec2 q = middle + fromMiddle / (1.0 + uOpen * 1.8);
    float ragged = fbm(q * 3.0 + uDrift * 0.02) - 0.5;

    vec3 sky = backdrop(p, light);
    vec2 toLight = normalize(light - p);
    float near = exp(-distance(p, light) * 4.0);
    float unused;
    vec4 far = clouds(p * 2.2 + vec2(uDrift * 0.006, 0.0), FAR_COVER - uClouds * 0.14, toLight, near, unused);
    sky = mix(sky, mix(far.rgb, sky, 0.35), far.a * 0.8);
    vec4 close = clouds(p * ${NEAR_SCALE.toFixed(4)} + vec2(uDrift * ${(NEAR_DRIFT * NEAR_SCALE).toFixed(4)}, 7.0), NEAR_COVER - uClouds * 0.12, toLight, near, unused);
    sky = mix(sky, close.rgb, close.a * 0.95);

    // The bank's inner front sits near the edges and closes to the middle.
    float front = mix(0.72, -0.4, uCover);
    float bank = smoothstep(front, front + 0.5, edge + ragged * 0.5);
    // Where the bank hasn't reached and nothing is parting, the heap would
    // add nothing, so it's skipped. Its density is only read while parting.
    float density = 0.0;
    if (bank > 0.0 || uOpen > 0.0) {
      vec2 heapAt = q * 1.6 + vec2(uDrift * 0.01, -3.0);
      if (uOpen > 0.0) {
        // Parting, each mass draws back from the seams around it: the heap
        // is read from a little further down its own broad slope.
        float e = 0.12;
        vec2 slope = vec2(
          heapDensity(heapAt + vec2(e, 0.0)) - heapDensity(heapAt - vec2(e, 0.0)),
          heapDensity(heapAt + vec2(0.0, e)) - heapDensity(heapAt - vec2(0.0, e))
        );
        heapAt -= slope / (length(slope) + 0.04) * uOpen * 0.22;
      }
      vec4 heap = clouds(heapAt, mix(0.62, 0.02, bank), toLight, near, density);
      sky = mix(sky, heap.rgb, heap.a * bank);
    }

    // The heap opens at its seams: the thinnest parts clear first, all
    // across the stage, then each gap widens until only the thickest cores
    // are left, and they go too. Seams near the middle open a little sooner.
    // The cut starts below the thinnest seam so each gap grows from nothing.
    // Most of the heap sits in a narrow band of density, so the cut sweeps
    // that band steadily and only races through the thick cores at the end.
    // The opening eases out; the cut takes it back a little so the seams
    // have time to read before the bank goes.
    float cut = mix(0.12, 0.82, pow(uOpen, 1.6)) + 0.3 * smoothstep(0.8, 1.0, uOpen)
      + 0.08 * (0.6 - edge) * (1.0 - uOpen);
    float alpha = uOpen > 0.0 ? smoothstep(cut - 0.04, cut + 0.04, density) : 1.0;
    // Where it's about to open the cloud is thin, and the light comes through.
    float thin = uOpen > 0.0 ? 1.0 - smoothstep(cut, cut + 0.08, density) : 0.0;
    sky = mix(sky, cloudColor(1.0, near), thin * 0.35);

    // In display space here: the sky is drawn off screen and copied onto
    // the canvas as it is. The canvas composites premultiplied.
    gl_FragColor = sRGBTransferOETF(vec4(sky, 1.0));
    gl_FragColor = vec4(gl_FragColor.rgb * alpha, alpha);
  }
`;

export const skyFragment = (night: boolean) =>
  fragment(night ? nightSky : daySky);

// The sky as drawn, stretched over the canvas.
export const copyFragment = /* glsl */ `
  uniform sampler2D uSky;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(uSky, vUv);
  }
`;
