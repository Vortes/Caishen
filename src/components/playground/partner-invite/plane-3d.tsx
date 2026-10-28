"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  type Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type ShaderMaterial,
  type Texture,
  Vector3,
} from "three";
import { createCloud, updateCloud } from "./cloud";
import { CAMERA_DISTANCE, LANDING, SCENE, sceneFit } from "./geometry";
import { shapeSheet } from "./harrier";
import type { Stroke } from "./ink";
import { createPaperMaterial } from "./paper-material";
import type { PlaneFrame } from "./plane-motion";
import { measure, perf } from "./perf";
import { printTexture } from "./print";
import { sealTexture } from "./seal";
import {
  THEIRS_BOX,
  cardOpacity,
  createTornCard,
  disposeTornCard,
  updateTornCard,
  type CardFrame,
} from "./torn-card";
import { useFrame } from "./use-frame";
import { createVapor, updateVapor } from "./vapor";
import { writeAttribute } from "./write-attribute";
import styles from "./lab.module.css";

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
  seal: Texture;
};

export function Plane3D({
  night,
  plane,
  card: cardAt,
  strokes,
  inkAt,
  onKeepsake,
}: {
  night: boolean;
  // The paper plane at a moment, while it flies in and unfolds.
  plane: (now: number) => PlaneFrame | null;
  // The torn and bonded card at a moment, from the tear until your half is
  // put away.
  card: (now: number) => CardFrame | null;
  // Your signature, and when the card was printed with it (the bond), so
  // the torn card carries it as wet as it was then.
  strokes: Stroke[];
  inkAt: number | null;
  // Called once, soon after the card is bonded, with a picture of Jordan's
  // half on its own, flat and lit as it is here, for the Partner mark: an
  // object URL, which the caller revokes.
  onKeepsake?: (mark: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<Three | null>(null);
  const keepsakeTaken = useRef(false);

  // Layout effects, in order, so the renderer and print exist before the
  // first frame draws.
  useLayoutEffect(() => {
    const element = host.current!;
    // At twice the CSS pixels or more, edges are fine without multisampling,
    // which would cost four samples a pixel over the whole stage.
    const renderer = new WebGLRenderer({
      antialias: window.devicePixelRatio < 2,
      alpha: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    perf?.watch("plane", renderer);
    element.appendChild(renderer.domElement);
    const camera = new PerspectiveCamera(30, 1, 200, 60000);
    const geometry = new BufferGeometry();
    const mesh = new Mesh(geometry, createPaperMaterial());
    const print = printTexture();
    mesh.material.uniforms.uPrint!.value = print;
    const seal = sealTexture();
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    const scene = new Scene();
    const vapor = createVapor();
    const cloud = createCloud();
    const torn = createTornCard();
    scene.add(mesh, vapor, cloud, torn);
    // The paper's shader is big. Compiled now, in the background, it's
    // ready before the tap that throws the plane.
    void renderer.compileAsync(scene, camera);
    three.current = {
      renderer,
      scene,
      camera,
      mesh,
      vapor,
      cloud,
      card: torn,
      seal,
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
      print.dispose();
      seal.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  // The torn card's print carries the user's signature, as of the tear.
  const cardPrint = useMemo(
    () => (inkAt === null ? null : printTexture(strokes, inkAt)),
    [inkAt, strokes],
  );
  useLayoutEffect(() => () => cardPrint?.dispose(), [cardPrint]);

  useFrame((now) => {
    const current = three.current;
    if (!current) return;
    const frame = plane(now);
    const card = cardAt(now);
    const canvas = current.renderer.domElement;
    if (
      card &&
      cardPrint &&
      onKeepsake &&
      !keepsakeTaken.current &&
      card.bond >= 1
    ) {
      keepsakeTaken.current = true;
      const theirsAlone = () =>
        updateTornCard(current.card, cardPrint, current.seal, {
          ...card,
          sealWet: 0,
          peels: [],
          keep: null,
          shown: 0,
          shimmer: -1,
          genie: null,
        });
      // Encoded off the frame; it isn't needed until the half is filed.
      measure("keepsake", () =>
        pictureCard(current, theirsAlone, THEIRS_BOX),
      ).toBlob((picture) => {
        if (picture) onKeepsake(URL.createObjectURL(picture));
      });
    }
    if (card && cardPrint && cardOpacity(card) > 0) {
      canvas.style.visibility = "visible";
      canvas.style.opacity = String(cardOpacity(card));
      current.mesh.visible = false;
      current.vapor.visible = false;
      current.cloud.visible = false;
      current.card.visible = true;
      measure("card", () =>
        updateTornCard(current.card, cardPrint, current.seal, card),
      );
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
    const { positions, rests } = measure("plane:shape", () =>
      shapeSheet(frame.shape),
    );
    writeAttribute(current.mesh.geometry, "position", positions, 3);
    writeAttribute(current.mesh.geometry, "rest", rests, 2);
    current.mesh.matrix.copy(frame.matrix);
    current.mesh.matrixWorldNeedsUpdate = true;
    updateVapor(current.vapor, frame.trails, current.camera.position);
    current.cloud.matrix.copy(frame.cloud.matrix);
    current.cloud.matrixWorldNeedsUpdate = true;
    updateCloud(current.cloud, frame.cloud.poof, frame.cloud.gather, night);
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
  return picture;
}
