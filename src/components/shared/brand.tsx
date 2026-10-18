import { useId } from "react";

import { cn } from "~/lib/utils";

import {
  BRAND_BLADES,
  BRAND_SMALL_MARK_SCALE,
  BRAND_TILE_RADIUS,
  BRAND_TILE_STOPS,
} from "./brand-geometry";

const markOffset = (100 - 100 * BRAND_SMALL_MARK_SCALE) / 2;

function BrandMark() {
  const gradientId = useId();
  return (
    <svg className="brand-mark" viewBox="0 0 100 100" aria-hidden="true">
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
  );
}

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={cn("brand", light && "brand-light")}>
      <BrandMark />
      <span>
        caishen<span className="brand-period">.</span>
      </span>
    </div>
  );
}
