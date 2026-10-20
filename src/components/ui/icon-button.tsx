import type { ComponentProps, ReactNode } from "react";
import styles from "./icon-button.module.css";
import { Tooltip } from "./tooltip";

// A button that is only an icon. The label is required: it names the button
// for screen readers and is shown as its tooltip. quiet sits on a surface
// with nothing around it; secondary is the bordered pill, for toolbars that
// sit next to secondary buttons.
export function IconButton({
  label,
  shortcut,
  variant = "quiet",
  size = "md",
  pressed,
  children,
  type = "button",
  ...props
}: Omit<
  ComponentProps<"button">,
  "className" | "style" | "aria-label" | "aria-pressed" | "children"
> & {
  label: string;
  shortcut?: string;
  variant?: "secondary" | "quiet";
  size?: "md" | "sm";
  pressed?: boolean;
  // The icon. Its size comes from the button.
  children: ReactNode;
}) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        type={type}
        className={styles.iconButton}
        data-variant={variant}
        data-size={size}
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={shortcut?.replace("⌘", "Meta+")}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  );
}
