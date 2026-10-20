"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";

import { Input } from "~/components/ui-legacy/input";
import { Label } from "~/components/ui-legacy/label";
import { cn } from "~/lib/utils";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  const child =
    Children.count(children) === 1 ? Children.toArray(children)[0] : null;
  const control = isValidElement(child)
    ? (child as ReactElement<{ id?: string; "aria-describedby"?: string }>)
    : null;
  const controlId = control?.props.id ?? id;
  const hintId = `${id}-hint`;
  return (
    <div className="field">
      <Label htmlFor={controlId}>{label}</Label>
      {control ? (
        cloneElement(control, {
          id: controlId,
          "aria-describedby":
            [control.props["aria-describedby"], hint && hintId]
              .filter(Boolean)
              .join(" ") || undefined,
        })
      ) : (
        <div>{children}</div>
      )}
      {hint && (
        <p id={hintId} className="field-hint text-body leading-[1.5]">
          {hint}
        </p>
      )}
    </div>
  );
}

export function FormField({
  label,
  hint,
  name,
  id,
  "aria-describedby": describedBy,
  ...props
}: {
  label: string;
  hint?: string;
  name: string;
} & ComponentProps<"input">) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = `${controlId}-hint`;
  return (
    <div className="field">
      <Label htmlFor={controlId}>{label}</Label>
      <Input
        {...props}
        id={controlId}
        name={name}
        aria-describedby={
          [describedBy, hint && hintId].filter(Boolean).join(" ") || undefined
        }
      />
      {hint && (
        <p id={hintId} className="field-hint text-body leading-[1.5]">
          {hint}
        </p>
      )}
    </div>
  );
}

export function SelectField({
  label,
  name,
  children,
  hint,
  id,
  className,
  "aria-describedby": describedBy,
  ...props
}: {
  label: string;
  name: string;
  children: ReactNode;
  hint?: string;
} & ComponentProps<"select">) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = `${controlId}-hint`;
  return (
    <div className="field">
      <Label htmlFor={controlId}>{label}</Label>
      <select
        {...props}
        id={controlId}
        name={name}
        className={cn(
          "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/20 text-body md:text-ui h-9 w-full rounded-md border px-3 leading-[1.4] outline-none focus-visible:ring-2 disabled:opacity-50",
          className,
        )}
        aria-describedby={
          [describedBy, hint && hintId].filter(Boolean).join(" ") || undefined
        }
      >
        {children}
      </select>
      {hint && (
        <p id={hintId} className="field-hint text-body leading-[1.5]">
          {hint}
        </p>
      )}
    </div>
  );
}
