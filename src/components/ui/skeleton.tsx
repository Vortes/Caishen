import styles from "./skeleton.module.css";

export type SkeletonShape =
  | "text"
  | "figure"
  | "avatar"
  | "pill"
  | "button"
  | "button-sm"
  | "funding-bar";

// A placeholder for one piece of content that hasn't loaded, shaped like the
// element that replaces it. Hidden from assistive technology: the loading
// screen announces itself once, not once per bone. width is in pixels;
// without it the bone fills its container.
export function Skeleton({
  shape = "text",
  width,
}: {
  shape?: SkeletonShape;
  width?: number;
}) {
  return (
    <span
      className={styles.skeleton}
      data-shape={shape}
      style={width === undefined ? undefined : { width }}
      aria-hidden
    />
  );
}
