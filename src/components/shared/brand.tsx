import { cn } from "~/lib/utils";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={cn("brand", light && "brand-light")}>
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>
        caishen<span className="brand-period">.</span>
      </span>
    </div>
  );
}
