"use client";

import { useId } from "react";
import {
  BRAND_BLADES,
  BRAND_SMALL_MARK_SCALE,
  BRAND_TILE_RADIUS,
  BRAND_TILE_STOPS,
} from "~/components/shared/brand-geometry";
import { useStored } from "./prototype";
import styles from "./batch.module.css";

const markOffset = (100 - 100 * BRAND_SMALL_MARK_SCALE) / 2;

export type BrandName = "Caishen" | "Curate";

// The product's name is an open question while the app moves to curate.is;
// every screen in the batch reads the same choice.
export function useBrandName() {
  return useStored<BrandName>("brand-name", "Caishen");
}

// The pinwheel mark from the favicon, beside the product's name.
export function Brand({ name }: { name: BrandName }) {
  const gradientId = useId();
  return (
    <span className={styles.brand}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            {BRAND_TILE_STOPS.map(([offset, color]) => (
              <stop key={offset} offset={offset} stopColor={color} />
            ))}
          </linearGradient>
        </defs>
        <rect
          width="100"
          height="100"
          rx={BRAND_TILE_RADIUS}
          fill={`url(#${gradientId})`}
        />
        <g
          fill="#fff"
          transform={`translate(${markOffset} ${markOffset}) scale(${BRAND_SMALL_MARK_SCALE})`}
        >
          {BRAND_BLADES.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </svg>
      {name}
    </span>
  );
}
