"use client";

import { useId, useState, type ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui-legacy/dialog";

export function CommandModal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const descriptionId = useId();
  const [opener] = useState(() => {
    if (typeof document === "undefined") return null;
    const activeElement = document.activeElement;
    return activeElement instanceof HTMLElement &&
      activeElement !== document.body
      ? activeElement
      : null;
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="dialog"
        aria-describedby={description ? descriptionId : undefined}
        onCloseAutoFocus={(event) => {
          if (opener?.isConnected) {
            event.preventDefault();
            opener.focus({ preventScroll: true });
          }
        }}
      >
        <DialogHeader className="dialog-head pr-8">
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription id={descriptionId}>
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
