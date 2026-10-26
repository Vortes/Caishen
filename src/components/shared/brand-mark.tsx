"use client";

import { useId } from "react";
import {
  BRAND_BLADES,
  BRAND_BLADE_STOPS,
  BRAND_EDGE_OPACITY,
  BRAND_SHEEN_OPACITY,
  BRAND_SMALL_MARK_SCALE,
  BRAND_TILE_RADIUS,
  BRAND_TILE_SLANT,
  BRAND_TILE_STOPS,
} from "~/components/shared/brand-geometry";

const markOffset = (100 - 100 * BRAND_SMALL_MARK_SCALE) / 2;

// The pinwheel on its lit tile, as the favicon draws it.
export function BrandMark() {
  const id = useId();
  return (
    <svg viewBox="0 0 100 100" aria-hidden>
      <defs>
        <linearGradient
          id={`${id}tile`}
          x1="0"
          y1="0"
          x2={BRAND_TILE_SLANT}
          y2="1"
        >
          {BRAND_TILE_STOPS.map(([offset, color]) => (
            <stop key={offset} offset={offset} stopColor={color} />
          ))}
        </linearGradient>
        <linearGradient id={`${id}sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={BRAND_SHEEN_OPACITY} />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}blade`} x1="0" y1="0" x2="0" y2="1">
          {BRAND_BLADE_STOPS.map(([offset, color]) => (
            <stop key={offset} offset={offset} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      <rect
        width="100"
        height="100"
        rx={BRAND_TILE_RADIUS}
        fill={`url(#${id}tile)`}
      />
      <rect
        width="100"
        height="100"
        rx={BRAND_TILE_RADIUS}
        fill={`url(#${id}sheen)`}
      />
      <rect
        x="0.75"
        y="0.75"
        width="98.5"
        height="98.5"
        rx={BRAND_TILE_RADIUS - 0.75}
        fill="none"
        stroke="#fff"
        strokeOpacity={BRAND_EDGE_OPACITY}
        strokeWidth="1.5"
      />
      <g
        fill={`url(#${id}blade)`}
        transform={`translate(${markOffset} ${markOffset}) scale(${BRAND_SMALL_MARK_SCALE})`}
      >
        {BRAND_BLADES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}
