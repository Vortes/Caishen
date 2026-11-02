"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// The prototype picker: harness chrome, copied verbatim from the
// emil-prototype skill's PICKER.md. It is deliberately not themed.

const css = `
.proto-picker {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(10, 10, 10, 0.82);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  backdrop-filter: blur(12px) saturate(1.4);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.08) inset,
    0 8px 24px rgba(0, 0, 0, 0.24),
    0 2px 6px rgba(0, 0, 0, 0.12);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1;
  -webkit-font-smoothing: antialiased;
  user-select: none;
  -webkit-user-select: none;
}
.proto-picker-highlight {
  position: absolute;
  top: 4px;
  left: 0;
  height: 28px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  will-change: transform;
}
.proto-picker[data-ready] .proto-picker-highlight {
  transition:
    transform 250ms cubic-bezier(0.23, 1, 0.32, 1),
    width 250ms cubic-bezier(0.23, 1, 0.32, 1);
}
@media (prefers-reduced-motion: reduce) {
  .proto-picker[data-ready] .proto-picker-highlight { transition: none; }
}
.proto-picker-item {
  position: relative;
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  font: inherit;
  cursor: pointer;
  transition: color 150ms ease-out;
}
.proto-picker-item:hover {
  color: rgba(255, 255, 255, 0.85);
}
.proto-picker-item:active {
  transform: scale(0.97);
}
.proto-picker-item:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.4);
  outline-offset: 2px;
}
.proto-picker-item[data-active] {
  color: #fff;
}
.proto-picker-divider {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: rgba(255, 255, 255, 0.12);
}
.proto-picker-replay {
  padding: 0 10px;
  font-size: 14px;
}
.proto-picker[data-position="top"] {
  bottom: auto;
  top: 24px;
}
`;

export function Picker({
  names,
  current,
  onChange,
}: {
  names: string[];
  current: number;
  onChange: (index: number) => void;
}) {
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [highlight, setHighlight] = useState({ x: 0, width: 0 });
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      const el = items.current[current];
      if (el) setHighlight({ x: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [current]);

  // The slide is enabled only after first paint, so load doesn't animate.
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => setReady(true)),
    );
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
        target.isContentEditable
      )
        return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // An open share picker keeps its own keys.
      if (target.closest("[data-radix-popper-content-wrapper]")) return;
      const num = parseInt(event.key, 10);
      if (num >= 1 && num <= names.length) onChange(num - 1);
      else if (event.key === "ArrowRight")
        onChange((current + 1) % names.length);
      else if (event.key === "ArrowLeft")
        onChange((current - 1 + names.length) % names.length);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [current, names.length, onChange]);

  return (
    <>
      <style>{css}</style>
      <nav
        className="proto-picker"
        aria-label="Prototype variants"
        data-ready={ready ? "" : undefined}
      >
        <span
          className="proto-picker-highlight"
          aria-hidden="true"
          style={{
            width: highlight.width,
            transform: `translateX(${highlight.x}px)`,
          }}
        />
        {names.map((name, index) => (
          <button
            key={name}
            ref={(el) => {
              items.current[index] = el;
            }}
            type="button"
            className="proto-picker-item"
            data-active={index === current ? "" : undefined}
            aria-current={index === current ? "true" : undefined}
            onClick={() => onChange(index)}
          >
            {name}
          </button>
        ))}
      </nav>
    </>
  );
}
