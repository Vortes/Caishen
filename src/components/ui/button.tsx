import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import styles from "./button.module.css";

// primary: the one committing action in a form or dialog. secondary: every
// other button, and the default. quiet: inline actions inside rows and
// sections. danger: only the confirm button of a destructive dialog.
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export type ButtonProps = Omit<
  ComponentProps<"button">,
  "className" | "style"
> & {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  // Renders the single child element instead of a <button>, for Radix
  // triggers and closes or links that should look like a button.
  asChild?: boolean;
};

export function Button({
  variant = "secondary",
  size = "md",
  asChild = false,
  type = "button",
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      className={styles.button}
      data-variant={variant}
      data-size={size}
      {...(asChild ? {} : { type })}
      {...props}
    />
  );
}
