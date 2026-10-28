"use client";

// Prototype: cloud lettering faces. Throwaway; deleted once one is picked.
// Wraps the lab, hands the sky the chosen face through CSS custom
// properties, and replays the invite from the top on every switch.
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { variants } from "./fonts";
import "./picker.css";

export function CloudFontProto({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState(0);
  // Bumped to re-mount the lab: on a switch, and on replay.
  const [run, setRun] = useState(0);
  // The face is only handed over once loaded, so the canvas never letters
  // in a fallback.
  const [ready, setReady] = useState<number | null>(null);
  const picker = useRef<HTMLElement>(null);
  const highlight = useRef<HTMLSpanElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  const setActive = (index: number) => {
    if (index < 0 || index >= variants.length) return;
    setCurrent(index);
    setRun((count) => count + 1);
    const url = new URL(location.href);
    url.searchParams.set("v", String(index + 1));
    history.replaceState(null, "", url);
  };

  useEffect(() => {
    const initial =
      (parseInt(new URLSearchParams(location.search).get("v") ?? "", 10) || 1) -
      1;
    if (initial > 0 && initial < variants.length) setCurrent(initial);
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        picker.current?.setAttribute("data-ready", ""),
      ),
    );
  }, []);

  useEffect(() => {
    const { family, weight } = variants[current]!;
    let live = true;
    const done = () => live && setReady(current);
    if (!family) done();
    else void document.fonts.load(`${weight} 64px ${family}`).then(done, done);
    return () => {
      live = false;
    };
  }, [current]);

  useLayoutEffect(() => {
    const move = () => {
      const item = items.current[current];
      if (!item || !highlight.current) return;
      highlight.current.style.width = `${item.offsetWidth}px`;
      highlight.current.style.transform = `translateX(${item.offsetLeft}px)`;
    };
    move();
    window.addEventListener("resize", move);
    return () => window.removeEventListener("resize", move);
  }, [current]);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
        target.isContentEditable
      )
        return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const number = parseInt(event.key, 10);
      if (number >= 1 && number <= variants.length) setActive(number - 1);
      else if (event.key === "ArrowRight")
        setActive((current + 1) % variants.length);
      else if (event.key === "ArrowLeft")
        setActive((current - 1 + variants.length) % variants.length);
      else if (event.key === "r" || event.key === "R")
        setRun((count) => count + 1);
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  });

  const face = ready === null ? null : variants[ready]!;
  return (
    <>
      <div
        style={{
          display: "contents",
          ...(face?.family && { "--skywriting-family": face.family }),
          ...(face && {
            "--skywriting-weight": face.weight,
            "--skywriting-tracking": String(face.tracking),
          }),
        }}
      >
        {ready === current && <Fragment key={run}>{children}</Fragment>}
      </div>
      <nav
        ref={picker}
        className="proto-picker"
        data-position="top"
        aria-label="Prototype variants"
      >
        <span
          ref={highlight}
          className="proto-picker-highlight"
          aria-hidden="true"
        />
        {variants.map((variant, index) => (
          <button
            key={variant.name}
            ref={(element) => {
              items.current[index] = element;
            }}
            type="button"
            className="proto-picker-item"
            data-active={index === current || undefined}
            aria-current={index === current ? "true" : undefined}
            onClick={() => setActive(index)}
          >
            {variant.name}
          </button>
        ))}
        <span className="proto-picker-divider" aria-hidden="true" />
        <button
          type="button"
          className="proto-picker-item proto-picker-replay"
          aria-label="Replay animation (R)"
          onClick={() => setRun((count) => count + 1)}
        >
          ↻
        </button>
      </nav>
    </>
  );
}
