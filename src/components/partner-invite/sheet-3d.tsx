"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import {
  BufferGeometry,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Scene,
  type ShaderMaterial,
  type Texture,
  WebGLRenderer,
} from "three";
import { config, washiById } from "./config";
import { CAMERA_DISTANCE, LANDING, type View } from "./geometry";
import { shapeSheet } from "./harrier";
import type { Stroke } from "./ink";
import { createPaperMaterial, dyePaper } from "./paper-material";
import { sheet } from "./plane-motion";
import { printTexture, type Invitation } from "./print";
import { useFrame } from "./use-frame";
import { writeAttribute } from "./write-attribute";
import styles from "./lab.module.css";

type Three = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  mesh: Mesh<BufferGeometry, ShaderMaterial>;
};

const { keel, dihedral } = config.plane;
const flat = shapeSheet({ folds: [0, 0, 0, 0, 0, 0], body: 0, keel, dihedral });

// The unfolded sheet, lying where the printed card lies in the scene, as
// the sender turns it over: 0 is printed side up, 1 is the washi up.
// Drawn on the frame loop only while `moving`, and once whenever the paper,
// the print, or the size changes.
export function Sheet3D({
  invitation,
  strokes,
  turned,
  moving,
  view,
}: {
  invitation: Invitation;
  // The sender's signature, printed on the inside.
  strokes: Stroke[];
  turned: (now: number) => number;
  moving: boolean;
  // The part of the scene in view, matching the element's aspect ratio.
  view: View;
}) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<Three | null>(null);
  const drawn = useRef<number | null>(null);
  const print = useRef<Texture | null>(null);
  const latestTurned = useRef(turned);
  latestTurned.current = turned;

  // Draws the sheet as turned at `now`, unless that's already on screen.
  // It reads only refs, so it never changes.
  const draw = useCallback((now: number) => {
    const current = three.current;
    if (!current) return;
    const turn = latestTurned.current(now);
    if (turn === drawn.current) return;
    drawn.current = turn;
    const angle = Math.PI * turn;
    // Turning over, the sheet lifts off the table so its edge clears it.
    current.mesh.matrix
      .makeTranslation(LANDING.x, -LANDING.y, 90 * Math.sin(angle))
      .multiply(new Matrix4().makeRotationY(angle))
      .multiply(sheet);
    current.mesh.matrixWorldNeedsUpdate = true;
    current.renderer.render(current.scene, current.camera);
    // Faded in on its first frame, rather than popping into the empty well
    // once the paper's shader has compiled.
    current.renderer.domElement.style.opacity = "1";
  }, []);
  const redraw = useCallback(() => {
    drawn.current = null;
    draw(performance.now());
  }, [draw]);

  useLayoutEffect(() => {
    const element = host.current!;
    const renderer = new WebGLRenderer({
      antialias: window.devicePixelRatio < 2,
      alpha: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    Object.assign(renderer.domElement.style, {
      opacity: "0",
      transition: "opacity 200ms ease-out",
    });
    element.appendChild(renderer.domElement);
    const camera = new PerspectiveCamera(30, 1, 200, 60000);
    const geometry = new BufferGeometry();
    writeAttribute(geometry, "position", flat.positions, 3);
    writeAttribute(geometry, "rest", flat.rests, 2);
    const mesh = new Mesh(
      geometry,
      createPaperMaterial(washiById(invitation.washi)),
    );
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    const scene = new Scene();
    scene.add(mesh);
    three.current = { renderer, scene, camera, mesh };

    const fit = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      const middle = {
        x: view.x + view.width / 2,
        y: -(view.y + view.height / 2),
      };
      camera.aspect = width / height;
      camera.fov =
        (2 * Math.atan(view.height / 2 / CAMERA_DISTANCE) * 180) / Math.PI;
      camera.position.set(middle.x, middle.y, CAMERA_DISTANCE);
      camera.lookAt(middle.x, middle.y, 0);
      camera.updateProjectionMatrix();
      redraw();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => {
      observer.disconnect();
      geometry.dispose();
      print.current?.dispose();
      mesh.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
    // The renderer starts once, for a fixed view; the paper is dyed and
    // printed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!three.current) return;
    dyePaper(three.current.mesh.material, washiById(invitation.washi));
    redraw();
  }, [invitation.washi, redraw]);

  useLayoutEffect(() => {
    if (!three.current) return;
    print.current?.dispose();
    print.current = printTexture(invitation, strokes, 0, "sender");
    three.current.mesh.material.uniforms.uPrint!.value = print.current;
    redraw();
  }, [invitation, strokes, redraw]);

  useFrame(draw, moving);
  // Where the turn came to rest, after the loop's last frame.
  useLayoutEffect(() => {
    if (!moving) draw(performance.now());
  }, [moving, draw]);

  return <div ref={host} className={styles.plane} aria-hidden />;
}
