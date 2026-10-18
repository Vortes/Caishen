"use client";

import { useEffect, useRef, useState } from "react";
import { money } from "~/components/budget/format";
import { Amount } from "~/components/shared";
import { Input } from "~/components/ui/input";

export function AssignedInput({
  name,
  value,
  busy,
  onChange,
  onError,
}: {
  name: string;
  value: number;
  busy: boolean;
  onChange: (value: number) => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const finished = useRef(false);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (editing) ref.current?.select();
    else if (returnFocus.current && !busy) {
      buttonRef.current?.focus();
      returnFocus.current = false;
    }
  }, [editing, busy]);
  const commit = (input: string) => {
    if (finished.current) return;
    try {
      const data = new FormData();
      data.set("amount", input);
      const next = money(data, "amount");
      finished.current = true;
      if (next !== value) onChange(next);
      setEditing(false);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Enter a dollar amount.",
      );
    }
  };
  if (!editing)
    return (
      <button
        ref={buttonRef}
        className="assigned-value"
        title={`Assign money to ${name}`}
        aria-label={`Assigned to ${name}: ${value / 100} dollars. Edit amount`}
        aria-disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          if (busy) return;
          finished.current = false;
          setEditing(true);
        }}
      >
        <Amount value={value} />
      </button>
    );
  return (
    <form
      className="assigned-form"
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        returnFocus.current = true;
        commit(ref.current?.value ?? "");
      }}
    >
      <Input
        ref={ref}
        aria-label={`Assigned amount for ${name}`}
        name="amount"
        inputMode="decimal"
        defaultValue={(value / 100).toFixed(2)}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            finished.current = true;
            returnFocus.current = true;
            setEditing(false);
          }
        }}
      />
    </form>
  );
}
