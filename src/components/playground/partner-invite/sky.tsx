"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";
import { config } from "./config";
import { createSkywriting } from "./skywriting";
import { skyFragment, skyVertex } from "./sky-shader";
import { useFrame } from "./use-frame";
import styles from "./lab.module.css";

// A sky behind the whole stage. By day: a deep, saturated blue, lighter
// low down, and two layers of soft, wispy cloud drifting past, the nearer
// one faster, all of it hazier as asked. By night, see sky-shader.ts. A
// bank of thicker cloud crowds the edges. When the halves part the bank
// closes over the stage, then parts along the seams between its masses to
// show what's underneath.

// How far the bank has closed in, and how far it has parted again.
export type Veil = { cover: number; open: number };

export type SkyTime = "day" | "night";

// A line written in cloud: how far it has formed (0 to 1), and how far
// it has blown apart once it's been read (0 to 1).
export type Words = { lines: string[]; form: number; scatter: number };

export function Sky({
  still,
  time,
  read,
  onBreathe,
}: {
  still: boolean;
  time: SkyTime;
  // The veil and the line in the sky at a moment.
  read: (now: number) => { veil: Veil; words: Words | null };
  // Each frame the pointer breathes some of the line away: how much.
  onBreathe?: (amount: number, dt: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ read, onBreathe });
  latest.current = { read, onBreathe };
  const draw = useRef<((now: number) => void) | null>(null);
  useFrame((now) => draw.current?.(now), !still);
  // Held still, the sky only draws when asked: whenever the scene changes.
  useEffect(() => {
    if (still) draw.current?.(performance.now());
  });

  useLayoutEffect(() => {
    const element = host.current!;
    // Soft shapes only, so the sky draws at one pixel per CSS pixel.
    const renderer = new WebGLRenderer({ antialias: false, alpha: true });
    renderer.setPixelRatio(1);
    element.appendChild(renderer.domElement);
    const size = new Vector2(1, 1);
    // The line in the sky, on its own sharper canvas over the sky's, while
    // it's up; and where the pointer rests over it.
    let writing: ReturnType<typeof createSkywriting> | null = null;
    let pointer: { x: number; y: number } | null = null;
    const point = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    // A finger lifted is gone; a mouse that leaves the window is too.
    const lift = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") pointer = null;
    };
    const leave = (event: PointerEvent) => {
      if (!event.relatedTarget) pointer = null;
    };
    window.addEventListener("pointermove", point);
    window.addEventListener("pointerdown", point);
    window.addEventListener("pointerup", lift);
    window.addEventListener("pointercancel", lift);
    document.addEventListener("pointerout", leave);
    const material = new ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment(time === "night"),
      uniforms: {
        uTime: { value: 0 },
        uDrift: { value: 40 },
        uSize: { value: size },
        uCover: { value: 0 },
        uOpen: { value: 0 },
        uClouds: { value: config.sky.clouds },
      },
    });
    const geometry = new PlaneGeometry(2, 2);
    const scene = new Scene();
    scene.add(new Mesh(geometry, material));
    const camera = new OrthographicCamera();

    const isNight = time === "night";
    // Drift adds up frame by frame, so it holds while the sky is still.
    let drifted = 40;
    let last: number | null = null;
    draw.current = (time: number) => {
      const { uniforms } = material;
      const dt =
        still || last === null ? 0 : Math.min(0.1, (time - last) / 1000);
      drifted += dt * config.sky.drift;
      last = time;
      const { veil, words: line } = latest.current.read(time);
      uniforms.uTime!.value = still ? 40 : 40 + time / 1000;
      uniforms.uDrift!.value = drifted;
      uniforms.uCover!.value = veil.cover;
      uniforms.uOpen!.value = veil.open;
      renderer.render(scene, camera);
      // Once the line has blown away it's gone for good, and so is its
      // canvas.
      if (!line) {
        writing?.dispose();
        writing = null;
        return;
      }
      if (!writing) {
        writing = createSkywriting();
        writing.resize(size.x, size.y);
        element.appendChild(writing.canvas);
      }
      writing.write(line.lines, size.x, size.y);
      const breathed = writing.update({
        width: size.x,
        height: size.y,
        form: line.form,
        scatter: line.scatter,
        drifted,
        pointer,
        dt,
        night: isNight,
      });
      latest.current.onBreathe?.(breathed, dt);
      writing.render();
    };
    const fit = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      writing?.resize(width, height);
      size.set(width, height);
      draw.current?.(performance.now());
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);

    return () => {
      observer.disconnect();
      draw.current = null;
      geometry.dispose();
      material.dispose();
      writing?.dispose();
      window.removeEventListener("pointermove", point);
      window.removeEventListener("pointerdown", point);
      window.removeEventListener("pointerup", lift);
      window.removeEventListener("pointercancel", lift);
      document.removeEventListener("pointerout", leave);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [still, time]);

  return <div ref={host} className={styles.sky} aria-hidden />;
}
