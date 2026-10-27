"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type ShaderMaterial,
} from "three";
import type { Config } from "./config";
import { CAMERA_DISTANCE, SCENE } from "./geometry";
import { shapeSheet } from "./harrier";
import { createPaperMaterial, updatePaperMaterial } from "./paper-material";
import type { PlaneFrame } from "./plane-motion";
import { printTexture } from "./print";
import { createVapor, updateVapor } from "./vapor";
import styles from "./lab.module.css";

// The camera sits straight above the middle of the scene, at a distance
// where the z = 0 plane lines up with the SVG drawn underneath.

type Three = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  mesh: Mesh<BufferGeometry, ShaderMaterial>;
  vapor: Mesh<BufferGeometry, ShaderMaterial>;
};

export function Plane3D({
  config,
  frame,
}: {
  config: Config;
  frame: PlaneFrame | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<Three | null>(null);

  // Layout effects, in order, so the renderer and print exist before the
  // first frame draws.
  useLayoutEffect(() => {
    const element = host.current!;
    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    const camera = new PerspectiveCamera(30, 1, 200, 60000);
    const geometry = new BufferGeometry();
    const mesh = new Mesh(geometry, createPaperMaterial());
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    const scene = new Scene();
    const vapor = createVapor();
    scene.add(mesh, vapor);
    three.current = { renderer, scene, camera, mesh, vapor };

    const fit = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      // Match the SVG's viewBox fit ("meet"): the scene scales to fit and
      // centers in whichever direction has room to spare.
      const scale = Math.min(width / SCENE.width, height / SCENE.height);
      const visible = height / scale;
      camera.aspect = width / height;
      camera.fov =
        (2 * Math.atan(visible / 2 / CAMERA_DISTANCE) * 180) / Math.PI;
      camera.position.set(SCENE.width / 2, -SCENE.height / 2, CAMERA_DISTANCE);
      camera.lookAt(SCENE.width / 2, -SCENE.height / 2, 0);
      camera.updateProjectionMatrix();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => {
      observer.disconnect();
      geometry.dispose();
      mesh.material.dispose();
      vapor.geometry.dispose();
      vapor.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  // The print only changes with the seed, paper, and ink.
  const printKey = JSON.stringify([config.seed, config.paper, config.ink]);
  const print = useMemo(
    () => (typeof document === "undefined" ? null : printTexture(config)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [printKey],
  );
  useLayoutEffect(() => {
    if (!print || !three.current) return;
    three.current.mesh.material.uniforms.uPrint!.value = print;
    return () => print.dispose();
  }, [print]);

  useLayoutEffect(() => {
    const current = three.current;
    if (!current) return;
    const canvas = current.renderer.domElement;
    if (!frame || frame.opacity <= 0) {
      canvas.style.visibility = "hidden";
      return;
    }
    canvas.style.visibility = "visible";
    canvas.style.opacity = String(frame.opacity);
    const { positions, rests } = shapeSheet(frame.shape);
    const geometry = current.mesh.geometry;
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(positions), 3),
    );
    geometry.setAttribute(
      "rest",
      new BufferAttribute(new Float32Array(rests), 2),
    );
    current.mesh.matrix.copy(frame.matrix);
    current.mesh.matrixWorldNeedsUpdate = true;
    updatePaperMaterial(current.mesh.material, config);
    updateVapor(current.vapor, frame.trails, config, current.camera.position);
    current.renderer.render(current.scene, current.camera);
  });

  return <div ref={host} className={styles.plane} aria-hidden />;
}
