"use client";

import { CircleAlertIcon } from "lucide-react";
import { AlertDialog, Dialog as Primitive } from "radix-ui";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./button";
import { usePortalContainer, useSurfaceMotion } from "./surface";
import surface from "./surface.module.css";
import styles from "./dialog.module.css";

export type DialogSize = "default" | "wide";

type DialogProps = {
  // The accessible name. The content draws its own heading.
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Wide content pins its own header and footer and scrolls only its body.
  size?: DialogSize;
  // Lands on a scrim already up, as after Plaid's window, so the scrim
  // doesn't fade in a second time.
  continued?: boolean;
  // Off to focus the dialog itself, so no control opens wearing a focus
  // ring; Tab then moves to the first control.
  autoFocus?: boolean;
  children: ReactNode;
};

// A free-form dialog on the raised surface, centered over a scrim and above
// every popover. Dialogs are occasional: the pointer opening one animates
// it, the keyboard opens it instantly.
export function Dialog({
  label,
  open,
  onOpenChange,
  size = "default",
  continued = false,
  autoFocus = true,
  children,
}: DialogProps) {
  const container = usePortalContainer();
  const motion = useSurfaceMotion(open, "occasional");
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal container={container}>
        <Primitive.Overlay
          {...motion}
          // Only the entrance is skipped; the scrim still leaves with the
          // dialog.
          data-instant={(open && continued) || motion["data-instant"]}
          className={surface.scrim}
        />
        <Primitive.Content
          {...motion}
          data-size={size}
          className={surface.dialog}
          aria-label={label}
          aria-describedby={undefined}
          onOpenAutoFocus={
            autoFocus
              ? undefined
              : (event) => {
                  event.preventDefault();
                  (event.currentTarget as HTMLElement).focus();
                }
          }
        >
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

// The scrim alone, for a window drawn by someone else that has no backdrop
// of its own, like Plaid's. A Dialog that follows it with `continued` lands
// on the same dimming.
export function DialogScrim() {
  const container = usePortalContainer();
  const motion = useSurfaceMotion(true, "occasional");
  if (!container) return null;
  return createPortal(
    <div {...motion} data-state="open" className={surface.scrim} aria-hidden />,
    container,
  );
}

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The button that opens it, which takes focus back when it closes.
  trigger?: ReactElement;
  title: string;
  description: ReactNode;
  cancel: string;
  confirm: string;
  tone: "danger" | "primary";
  // The dialog stays open; the site closes it once the work is done.
  onConfirm: () => void;
  // While the work runs, neither button acts and nothing closes the dialog.
  pending?: boolean;
  // Why the work failed, shown above the buttons.
  error?: string;
};

// A question with two answers. Cancel takes focus when it opens, and Escape
// answers Cancel; a click outside does nothing.
export function ConfirmDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  cancel,
  confirm,
  tone,
  onConfirm,
  pending = false,
  error,
}: ConfirmDialogProps) {
  const container = usePortalContainer();
  const motion = useSurfaceMotion(open, "occasional");
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      {trigger && <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>}
      <AlertDialog.Portal container={container}>
        <AlertDialog.Overlay {...motion} className={surface.scrim} />
        <AlertDialog.Content {...motion} className={surface.dialog}>
          <div className={styles.header}>
            <AlertDialog.Title className={styles.title}>
              {title}
            </AlertDialog.Title>
            <AlertDialog.Description className={styles.description}>
              {description}
            </AlertDialog.Description>
          </div>
          {error && (
            <p className={styles.error} role="alert">
              <CircleAlertIcon size={13} aria-hidden />
              {error}
            </p>
          )}
          <div className={styles.footer}>
            <AlertDialog.Cancel asChild>
              <Button disabled={pending}>{cancel}</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                variant={tone}
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  onConfirm();
                }}
              >
                {confirm}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
