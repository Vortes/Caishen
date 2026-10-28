"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  LinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { config } from "./config";
import { measure, perf } from "./perf";
import { createSkywriting } from "./skywriting";
import { copyFragment, skyFragment, skyVertex } from "./sky-shader";
import { useFrame } from "./use-frame";
import styles from "./lab.module.css";

// A sky behind the whole stage. By day: a deep, saturated blue, lighter
// low down, and two layers of soft, wispy cloud drifting past, the nearer
// one faster, all of it hazier as asked. By night, see sky-shader.ts. A
// bank of thicker cloud crowds the edges. When the halves part the bank
// closes over the stage, then parts along the seams between its masses to
// show what's underneath.

// How finely the sky is drawn, in pixels per CSS pixel: by day, all soft
// shapes, at half; by night at one, for the stars. If frames keep running
// slow it draws coarser, a step at a time, down to a floor.
const DETAIL = { day: 0.5, night: 1, floor: { day: 0.3, night: 0.5 } };
const COARSER = 0.8;
// Slow: the middle frame of a second's worth (60) took longer than this
// (ms), twice running.
const SLOW = { ms: 20, frames: 60, times: 2 };
// The sky draws at most this often (ms), so a 120 Hz display doesn't draw
// it twice as often for drift too slow to see between frames.
const SKY_EVERY = 1000 / 75;

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
    // One canvas for the sky and the line in it. While the line is up the
    // canvas runs at the screen's resolution, for the letters, and the sky
    // is drawn off screen at its own detail and stretched over it; after,
    // the canvas runs at the sky's detail and the sky draws straight on.
    const renderer = new WebGLRenderer({
      antialias: false,
      alpha: true,
      depth: false,
      stencil: false,
    });
    const sharp = Math.min(2, window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    perf?.watch("sky", renderer);
    element.appendChild(renderer.domElement);
    const size = new Vector2(1, 1);
    const isNight = time === "night";
    let detail = isNight ? DETAIL.night : DETAIL.day;
    const floor = isNight ? DETAIL.floor.night : DETAIL.floor.day;
    perf?.note("sky detail", detail);
    const drawn = new WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    });
    const fitDrawn = () =>
      drawn.setSize(
        Math.max(1, Math.round(size.x * detail)),
        Math.max(1, Math.round(size.y * detail)),
      );
    // The line in the sky, while it's up; and where the pointer rests
    // over it.
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
    scene.userData.pass = "sky";
    const copy = new ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: copyFragment,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
      uniforms: { uSky: { value: drawn.texture } },
    });
    const copyScene = new Scene();
    copyScene.add(new Mesh(geometry, copy));
    copyScene.userData.pass = "sky:copy";
    const camera = new OrthographicCamera();

    // Drift adds up frame by frame, so it holds while the sky is still.
    let drifted = 40;
    let last: number | null = null;
    // When the sky was last drawn, and whether it must be drawn afresh.
    let skyAt = -Infinity;
    let stale = true;
    // A second's frame times (ms), and how many seconds have run slow.
    let frames: number[] = [];
    let slow = 0;
    const keepUp = (ms: number) => {
      frames.push(ms);
      if (frames.length < SLOW.frames) return;
      frames.sort((a, b) => a - b);
      slow = frames[SLOW.frames / 2]! > SLOW.ms ? slow + 1 : 0;
      frames = [];
      if (slow < SLOW.times || detail <= floor) return;
      slow = 0;
      detail = Math.max(floor, detail * COARSER);
      perf?.note("sky detail", detail);
      fitDrawn();
      stale = true;
    };
    draw.current = (time: number) => {
      const { uniforms } = material;
      const dt =
        still || last === null ? 0 : Math.min(0.1, (time - last) / 1000);
      drifted += dt * config.sky.drift;
      last = time;
      if (dt > 0) keepUp(dt * 1000);
      const { veil, words: line } = latest.current.read(time);
      uniforms.uTime!.value = still ? 40 : 40 + time / 1000;
      uniforms.uDrift!.value = drifted;
      uniforms.uCover!.value = veil.cover;
      uniforms.uOpen!.value = veil.open;
      const ratio = line ? sharp : detail;
      if (renderer.getPixelRatio() !== ratio) {
        renderer.setPixelRatio(ratio);
        stale = true;
      }
      const due = still || stale || time - skyAt >= SKY_EVERY;
      if (due) {
        renderer.setRenderTarget(line ? drawn : null);
        renderer.render(scene, camera);
        skyAt = time;
        stale = false;
      }
      // Once the line has blown away it's gone for good.
      if (!line) {
        writing?.dispose();
        writing = null;
        return;
      }
      renderer.setRenderTarget(null);
      renderer.render(copyScene, camera);
      if (!writing) {
        writing = createSkywriting(renderer, () => {
          if (still) draw.current?.(performance.now());
        });
        writing.resize(size.x, size.y);
      }
      measure("skywriting:write", () =>
        writing!.write(line.lines, size.x, size.y),
      );
      const breathed = measure("skywriting:update", () =>
        writing!.update({
          width: size.x,
          height: size.y,
          form: line.form,
          scatter: line.scatter,
          drifted,
          pointer,
          dt,
          night: isNight,
        }),
      );
      latest.current.onBreathe?.(breathed, dt);
      writing.render();
    };
    const fit = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      writing?.resize(width, height);
      size.set(width, height);
      fitDrawn();
      stale = true;
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
      copy.dispose();
      drawn.dispose();
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
