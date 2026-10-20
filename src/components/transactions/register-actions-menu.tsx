"use client";

import { useRef } from "react";

import type { Panel } from "~/components/budget/types";
import { Icon } from "~/components/shared";
import { Button } from "~/components/ui-legacy/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui-legacy/dropdown-menu";

export function RegisterActionsMenu({
  accountId,
  hasCreditAccounts,
  disabled,
  onAction,
}: {
  accountId?: string;
  hasCreditAccounts: boolean;
  disabled: boolean;
  onAction: (panel: Panel) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nextAction = useRef<Panel | null>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={triggerRef} variant="ghost" size="sm" disabled={disabled}>
          Account actions
          <Icon name="chevron-down" size={12} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(event) => {
          const panel = nextAction.current;
          if (!panel) return;
          nextAction.current = null;
          event.preventDefault();
          triggerRef.current?.focus({ preventScroll: true });
          onAction(panel);
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            nextAction.current = { type: "reconcile", accountId };
          }}
        >
          <Icon name="shield" />
          Reconcile a statement
        </DropdownMenuItem>
        {hasCreditAccounts && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                nextAction.current = { type: "card-payment", accountId };
              }}
            >
              <Icon name="transactions" />
              Record a card payment
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                nextAction.current = { type: "statement-credit", accountId };
              }}
            >
              <Icon name="card" />
              Statement credit
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
