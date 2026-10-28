"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  type Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type ShaderMaterial,
  Vector3,
} from "three";
import { createCloud, updateCloud } from "./cloud";
import type { Config } from "./config";
import { CAMERA_DISTANCE, LANDING, SCENE, sceneFit } from "./geometry";
import { shapeSheet } from "./harrier";
import { createPaperMaterial, updatePaperMaterial } from "./paper-material";
import type { PlaneFrame } from "./plane-motion";
import { printTexture } from "./print";
import { sealTexture } from "./seal";
import {
  cardOpacity,
  createTornCard,
  disposeTornCard,
  joinedBox,
  tearLine,
  theirsBox,
  updateTornCard,
  type CardFrame,
} from "./torn-card";
import { createVapor, updateVapor } from "./vapor";
import styles from "./lab.module.css";

// The bonded card's halves, pictured apart in the same box, so laid one
// over the other they make the whole card again; and Jordan's on its own,
// cropped to its box, for the Partner mark.
export type Halves = { yours: string; theirs: string; mark: string };

// The camera sits straight above the middle of the scene, at a distance
// where the z = 0 plane lines up with the SVG drawn underneath.

type Three = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  mesh: Mesh<BufferGeometry, ShaderMaterial>;
  vapor: Mesh<BufferGeometry, ShaderMaterial>;
  cloud: Mesh<BufferGeometry, ShaderMaterial>;
  card: Group;
};

export function Plane3D({
  config,
  night,
  frame,
  card,
  onKeepsake,
}: {
  config: Config;
  night: boolean;
  frame: PlaneFrame | null;
  // The torn and bonded card, from the tear until your half is put away.
  card: CardFrame | null;
  // Called once, as soon as the card is bonded, with pictures of each half
  // on its own, flat and lit as they are here, to carry into the next
  // screen.
  onKeepsake?: (halves: Halves) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<Three | null>(null);
  const keepsakeTaken = useRef(false);

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
    const cloud = createCloud();
    const torn = createTornCard();
    scene.add(mesh, vapor, cloud, torn);
    three.current = {
      renderer,
      scene,
      camera,
      mesh,
      vapor,
      cloud,
      card: torn,
    };

    const fit = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      // Match the SVG's viewBox, so the sheet lands on the printed card.
      const visible = height / sceneFit(width, height).scale;
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
      cloud.geometry.dispose();
      cloud.material.dispose();
      disposeTornCard(torn);
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

  // The torn card's print carries the user's signature, as of the tear.
  const inkAt = card?.inkAt ?? null;
  const strokes = card?.strokes;
  const cardPrint = useMemo(
    () =>
      inkAt === null || !strokes ? null : printTexture(config, strokes, inkAt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inkAt, strokes, printKey],
  );
  useLayoutEffect(() => () => cardPrint?.dispose(), [cardPrint]);
  const sealKey = JSON.stringify([config.seed, config.seal, config.ink.pool]);
  const seal = useMemo(
    () => (typeof document === "undefined" ? null : sealTexture(config)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sealKey],
  );
  useLayoutEffect(() => () => seal?.dispose(), [seal]);
  const line = useMemo(
    () => tearLine(config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.seed, config.tear.ragged],
  );

  useLayoutEffect(() => {
    const current = three.current;
    if (!current) return;
    const canvas = current.renderer.domElement;
    if (
      card &&
      cardPrint &&
      seal &&
      onKeepsake &&
      !keepsakeTaken.current &&
      card.bond >= 1
    ) {
      keepsakeTaken.current = true;
      const pose = (shown: CardFrame["shown"]) => () =>
        updateTornCard(current.card, config, line, cardPrint, seal, {
          ...card,
          sealWet: 0,
          peels: [],
          keep: null,
          shown,
          shimmer: -1,
          genie: null,
        });
      const box = joinedBox(config);
      const theirs = pose({ yours: 0, theirs: 1 });
      onKeepsake({
        yours: pictureCard(current, pose({ yours: 1, theirs: 0 }), box),
        theirs: pictureCard(current, theirs, box),
        mark: pictureCard(current, theirs, theirsBox(config)),
      });
    }
    if (card && cardPrint && seal && cardOpacity(card) > 0) {
      canvas.style.visibility = "visible";
      canvas.style.opacity = String(cardOpacity(card));
      current.mesh.visible = false;
      current.vapor.visible = false;
      current.cloud.visible = false;
      current.card.visible = true;
      updateTornCard(current.card, config, line, cardPrint, seal, card);
      current.renderer.render(current.scene, current.camera);
      return;
    }
    if (!frame || frame.opacity <= 0) {
      canvas.style.visibility = "hidden";
      return;
    }
    current.mesh.visible = true;
    current.card.visible = false;
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
    current.cloud.matrix.copy(frame.cloud.matrix);
    current.cloud.matrixWorldNeedsUpdate = true;
    updateCloud(
      current.cloud,
      config,
      frame.cloud.poof,
      frame.cloud.gather,
      night,
    );
    current.renderer.render(current.scene, current.camera);
  });

  return <div ref={host} className={styles.plane} aria-hidden />;
}

// The card as posed, flat in the middle of the scene, cropped to a box in
// card coordinates. Read straight after drawing, before the frame is
// shown, so the buffer still holds it.
function pictureCard(
  three: Three,
  pose: () => void,
  box: { left: number; right: number; top: number; bottom: number },
) {
  const { renderer, scene, camera, mesh, vapor, cloud, card } = three;
  for (const object of [mesh, vapor, cloud]) object.visible = false;
  card.visible = true;
  pose();
  renderer.render(scene, camera);
  const canvas = renderer.domElement;
  const corner = (x: number, y: number) => {
    const point = new Vector3(LANDING.x + x, -(LANDING.y + y), 0).project(
      camera,
    );
    return {
      x: ((point.x + 1) / 2) * canvas.width,
      y: ((1 - point.y) / 2) * canvas.height,
    };
  };
  const from = corner(box.left, box.top);
  const to = corner(box.right, box.bottom);
  const picture = document.createElement("canvas");
  picture.width = Math.round(to.x - from.x);
  picture.height = Math.round(to.y - from.y);
  picture
    .getContext("2d")!
    .drawImage(
      canvas,
      from.x,
      from.y,
      to.x - from.x,
      to.y - from.y,
      0,
      0,
      picture.width,
      picture.height,
    );
  return picture.toDataURL("image/png");
}
