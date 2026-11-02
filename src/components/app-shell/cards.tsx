"use client";

import { type LucideIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react";
import { Card } from "~/components/ui/card";
import { Caret } from "./sidebar";
import styles from "./shell.module.css";

type Folds = { closed: string[]; toggle: (id: string) => void };

const FoldContext = createContext<Folds | null>(null);

// Which inspector cards are folded. Like the sidebar's sections, they stay
// folded as the selection changes, until the page reloads.
export function FoldProvider({ children }: { children: ReactNode }) {
  const [closed, setClosed] = useState<string[]>([]);
  const toggle = useCallback(
    (id: string) =>
      setClosed((values) =>
        values.includes(id)
          ? values.filter((value) => value !== id)
          : [...values, id],
      ),
    [],
  );
  return (
    <FoldContext.Provider value={{ closed, toggle }}>
      {children}
    </FoldContext.Provider>
  );
}

// A titled inspector card. Its title folds it to just the title and opens
// it again; id names the kind of card, so a category's Target card stays
// folded on the next category.
export function Section({
  id,
  icon,
  title,
  subtitle,
  children,
}: {
  id: string;
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const folds = useContext(FoldContext);
  if (!folds) throw new Error("Section needs a FoldProvider.");
  const open = !folds.closed.includes(id);
  const bodyId = useId();
  return (
    <Card>
      <h2 className={styles.cardTitle}>
        <button
          type="button"
          className={styles.cardToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => folds.toggle(id)}
        >
          {icon}
          <span className={styles.truncate}>{title}</span>
          <Caret />
        </button>
      </h2>
      {/* Folded content stays mounted for the fold animation. */}
      <div
        id={bodyId}
        className={styles.cardBody}
        data-open={open}
        inert={!open}
        aria-hidden={!open || undefined}
      >
        <div>
          {subtitle && <p className={styles.cardSubtitle}>{subtitle}</p>}
          {children}
        </div>
      </div>
    </Card>
  );
}

// A Section as the loading skeleton draws it: the same title and body,
// with nothing to fold yet.
export function SkeletonSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <h2 className={styles.cardTitle}>
        <span className={styles.cardToggle}>
          <span className={styles.truncate}>{title}</span>
          <Caret />
        </span>
      </h2>
      <div className={styles.cardBody}>
        <div>{children}</div>
      </div>
    </Card>
  );
}

export function Figure({
  value,
  caption,
  tone,
}: {
  value: string;
  caption: string;
  tone?: string;
}) {
  return (
    <div className={styles.figure} data-state={tone}>
      <strong>{value}</strong>
      <span>{caption}</span>
    </div>
  );
}

export function Property({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className={styles.property}>
      <span className={styles.propertyLabel}>{label}</span>
      <span className={styles.propertyValue}>
        {Icon && <Icon size={13} aria-hidden />}
        {children}
      </span>
    </div>
  );
}
