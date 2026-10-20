"use client";

import { EllipsisIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "~/components/ui/icon-button";
import styles from "./shell.module.css";

export function Title({
  icon,
  title,
  subtitle,
  menu,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  menu?: boolean;
}) {
  return (
    <div className={styles.cardTitle}>
      <div className={styles.cardTitleRow}>
        {icon}
        <h2 className={styles.truncate}>{title}</h2>
        {menu && (
          <IconButton label={`${title} actions`}>
            <EllipsisIcon aria-hidden />
          </IconButton>
        )}
      </div>
      {subtitle && <p>{subtitle}</p>}
    </div>
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
