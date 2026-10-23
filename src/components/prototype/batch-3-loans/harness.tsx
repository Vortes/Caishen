"use client";

import { useState } from "react";
import { scenarios, type ScenarioId } from "./data";
import type { Variants } from "./store";
import styles from "./loans.module.css";

// Each variant moves one design variable; the harness names it.
const variantGroups: {
  key: keyof Variants;
  variable: string;
  short: string;
  options: { value: string; label: string }[];
}[] = [
  {
    key: "add",
    variable: "Add loan: where the form opens",
    short: "Add loan",
    options: [
      { value: "panel", label: "Details panel" },
      { value: "row", label: "List row" },
    ],
  },
  {
    key: "compare",
    variable: "Extra payment: how it compares",
    short: "Compare",
    options: [
      { value: "numbers", label: "Numbers" },
      { value: "chart", label: "Numbers + chart" },
    ],
  },
  {
    key: "cadence",
    variable: "Extra payment: what it takes",
    short: "Extra",
    options: [
      { value: "once", label: "One time" },
      { value: "both", label: "One time or monthly" },
    ],
  },
];

// Prototype chrome, not product UI, along the top: scenario, the variants,
// theme, and Reset.
export function Harness({
  scenario,
  onScenario,
  variants,
  onVariants,
  theme,
  onTheme,
  onReset,
}: {
  scenario: ScenarioId;
  onScenario: (scenario: ScenarioId) => void;
  variants: Variants;
  onVariants: (variants: Variants) => void;
  theme: "dark" | "light";
  onTheme: (theme: "dark" | "light") => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(true);
  if (!open)
    return (
      <div className={styles.harness}>
        <button
          type="button"
          className={styles.harnessButton}
          onClick={() => setOpen(true)}
        >
          Prototype controls
        </button>
      </div>
    );
  return (
    <div className={styles.harness} role="toolbar" aria-label="Prototype">
      <a href="/prototype/batch-3-loans" className={styles.harnessLink}>
        Batch 3
      </a>
      <Choice
        label="Scenario"
        title="Scenario"
        value={scenario}
        options={Object.entries(scenarios).map(([value, item]) => ({
          value,
          label: item.label,
        }))}
        onChange={(value) => onScenario(value as ScenarioId)}
      />
      {variantGroups.map((group) => (
        <Choice
          key={group.key}
          label={group.short}
          title={group.variable}
          value={variants[group.key]}
          options={group.options}
          onChange={(value) => onVariants({ ...variants, [group.key]: value })}
        />
      ))}
      <button
        type="button"
        className={styles.harnessButton}
        aria-pressed={theme === "light"}
        onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
      >
        {theme === "dark" ? "Light" : "Dark"}
      </button>
      <button type="button" className={styles.harnessButton} onClick={onReset}>
        Reset
      </button>
      <button
        type="button"
        className={styles.harnessButton}
        aria-label="Hide prototype controls"
        onClick={() => setOpen(false)}
      >
        ×
      </button>
    </div>
  );
}

function Choice({
  label,
  title,
  value,
  options,
  onChange,
}: {
  label: string;
  // The variable the choice moves, in full.
  title: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.harnessChoice} title={title}>
      <span>{label}</span>
      <select
        aria-label={title}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
