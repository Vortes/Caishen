import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";
import type { Config } from "./config";
import type { Trail } from "./plane-motion";

// Wingtip vapor: a ribbon along each trail that always faces the camera,
// thin and faint right behind the tip, spreading and thinning out as it
// ages, soft at its edges.

const vertex = /* glsl */ `
  attribute float alpha;
  attribute float across;
  varying float vAlpha;
  varying float vAcross;
  void main() {
    vAlpha = alpha;
    vAcross = across;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vAcross;
  void main() {
    float edge = 1.0 - vAcross * vAcross;
    gl_FragColor = vec4(uColor, vAlpha * edge * edge);
    #include <colorspace_fragment>
  }
`;

// Vapor condenses a moment behind the wingtip, not at it.
const FORMS = 0.06;

export function createVapor() {
  const mesh = new Mesh(
    new BufferGeometry(),
    new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: { uColor: { value: new Vector3(0.96, 0.95, 0.93) } },
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

export function updateVapor(
  mesh: Mesh<BufferGeometry, ShaderMaterial>,
  trails: Trail[],
  config: Config,
  camera: Vector3,
) {
  const { life, width, spread, opacity } = config.trail;
  const positions: number[] = [];
  const alphas: number[] = [];
  const acrosses: number[] = [];
  const side = new Vector3();
  const tangent = new Vector3();
  const toward = new Vector3();

  for (const { points, ages } of trails) {
    const left: Vector3[] = [];
    const right: Vector3[] = [];
    const strength: number[] = [];
    points.forEach((point, i) => {
      const age = ages[i]!;
      tangent
        .copy(points[Math.max(0, i - 1)]!)
        .sub(points[Math.min(points.length - 1, i + 1)]!);
      if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0);
      toward.copy(camera).sub(point);
      side.crossVectors(tangent, toward).normalize();
      const half = (width + spread * age) / 2;
      left.push(point.clone().addScaledVector(side, half));
      right.push(point.clone().addScaledVector(side, -half));
      const fade = Math.max(0, 1 - age / life) ** 1.6;
      const formed = Math.min(1, age / FORMS);
      strength.push(opacity * fade * formed);
    });
    for (let i = 0; i < points.length - 1; i++) {
      const quad = [
        [left[i]!, strength[i]!, -1],
        [right[i]!, strength[i]!, 1],
        [left[i + 1]!, strength[i + 1]!, -1],
        [right[i]!, strength[i]!, 1],
        [right[i + 1]!, strength[i + 1]!, 1],
        [left[i + 1]!, strength[i + 1]!, -1],
      ] as const;
      for (const [corner, alpha, across] of quad) {
        positions.push(corner.x, corner.y, corner.z);
        alphas.push(alpha);
        acrosses.push(across);
      }
    }
  }

  const geometry = mesh.geometry;
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setAttribute(
    "alpha",
    new BufferAttribute(new Float32Array(alphas), 1),
  );
  geometry.setAttribute(
    "across",
    new BufferAttribute(new Float32Array(acrosses), 1),
  );
  mesh.visible = positions.length > 0;
}
