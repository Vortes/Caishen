"use client";

import { DropdownMenu } from "radix-ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { names, type Person } from "./data";
import type { ShareVariant } from "./register";
import type { SimulatedEvent } from "./store";
import styles from "./harness.module.css";

// Prototype chrome, not part of the design: who you're viewing as, the
// variant picker, simulated bank events, and Reset. Its look is fixed so it
// never reads as app UI.

export type HarnessEvent = { id: SimulatedEvent; label: string };

const variants: { id: ShareVariant; label: string }[] = [
  { id: "column", label: "Share column" },
  { id: "editor", label: "Share in editor" },
];

export function Harness({
  viewer,
  onViewer,
  variant,
  onVariant,
  events,
  onSimulate,
  onReset,
}: {
  viewer: Person;
  onViewer: (person: Person) => void;
  variant: ShareVariant;
  onVariant: (variant: ShareVariant) => void;
  events: (HarnessEvent & { disabled: boolean })[];
  onSimulate: (id: SimulatedEvent) => void;
  onReset: () => void;
}) {
  return (
    <div className={styles.harness}>
      <div className={styles.side}>
        <span className={styles.caption}>Viewing as</span>
        <Pills
          label="Viewing as"
          items={(["alan", "anna"] as const).map((person) => ({
            id: person,
            label: names[person],
          }))}
          value={viewer}
          onChange={onViewer}
        />
      </div>
      <Picker value={variant} onChange={onVariant} />
      <div className={styles.side} data-end>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button type="button" className={styles.chromeButton}>
              Simulate
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={styles.menu}
              side="top"
              align="end"
              sideOffset={8}
            >
              {events.map((event) => (
                <DropdownMenu.Item
                  key={event.id}
                  className={styles.menuItem}
                  disabled={event.disabled}
                  onSelect={() => onSimulate(event.id)}
                >
                  {event.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button type="button" className={styles.chromeButton} onClick={onReset}>
          Reset
        </button>
      </div>
    </div>
  );
}

function Pills<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.pills} role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={styles.pill}
          aria-pressed={item.id === value}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

// The variant picker, per the prototype skill's spec: a dark pill whose
// highlight slides to the active variant. 1 and 2 or the arrow keys switch.
function Picker({
  value,
  onChange,
}: {
  value: ShareVariant;
  onChange: (variant: ShareVariant) => void;
}) {
  const nav = useRef<HTMLElement>(null);
  const highlight = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  const index = variants.findIndex((item) => item.id === value);

  useLayoutEffect(() => {
    const move = () => {
      const items =
        nav.current?.querySelectorAll<HTMLButtonElement>(":scope > button");
      const element = items?.[index];
      if (!element || !highlight.current) return;
      highlight.current.style.width = `${element.offsetWidth}px`;
      highlight.current.style.transform = `translateX(${element.offsetLeft}px)`;
    };
    move();
    window.addEventListener("resize", move);
    return () => window.removeEventListener("resize", move);
  }, [index]);

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
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
        target.isContentEditable ||
        target.closest("[data-radix-popper-content-wrapper], [role=dialog]")
      )
        return;
      const number = Number.parseInt(event.key, 10);
      let next = -1;
      if (number >= 1 && number <= variants.length) next = number - 1;
      else if (event.key === "ArrowRight") next = (index + 1) % variants.length;
      else if (event.key === "ArrowLeft")
        next = (index - 1 + variants.length) % variants.length;
      if (next < 0) return;
      onChange(variants[next]!.id);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [index, onChange]);

  return (
    <nav
      ref={nav}
      className="proto-picker"
      aria-label="Prototype variants"
      data-ready={ready || undefined}
    >
      <span ref={highlight} className="proto-picker-highlight" aria-hidden />
      {variants.map((item, i) => (
        <button
          key={item.id}
          type="button"
          className="proto-picker-item"
          data-active={i === index || undefined}
          aria-current={i === index ? "true" : undefined}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
