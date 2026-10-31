"use client";

import { ChevronDownIcon } from "lucide-react";
import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { useFieldControl } from "./field";
import styles from "./field.module.css";

// The button's own attributes pass through, so a Menu or Popover can make it
// its trigger; the Field gives its id and description.
type ButtonProps = Omit<
  ComponentPropsWithRef<"button">,
  "id" | "type" | "className" | "style" | "children"
>;

type WellButtonProps = ButtonProps & {
  // What the field holds; a string is cut short with an ellipsis.
  children?: ReactNode;
  // Shown, faint, while there are no children.
  placeholder?: string;
  // Short text at the well's end, part of the value: "Half", then "$12.50".
  suffix?: string;
  // For a field that opens a list.
  chevron?: boolean;
  valueId?: string;
};

// A field's value chosen in a menu or popover the site owns: a button drawn
// as the field's well, showing the value. It is named by the field's label
// and the value, so a screen reader hears both: "I want to, Set aside
// $0.00". Inside a Field, which names and describes it.
export function FieldButton(props: Omit<WellButtonProps, "valueId">) {
  const field = useFieldControl();
  const valueId = useId();
  return (
    <WellButton
      {...props}
      valueId={valueId}
      aria-labelledby={`${field.labelId} ${valueId}`}
    />
  );
}

// The well as a button, for the ui controls built on it (Select). Screens
// use FieldButton or Select.
export function WellButton({
  children,
  placeholder,
  suffix,
  chevron = false,
  valueId,
  disabled,
  ...button
}: WellButtonProps) {
  const field = useFieldControl();
  const empty = children === undefined || children === null;
  const shown = empty ? placeholder : children;
  return (
    <button
      {...button}
      type="button"
      id={field.id}
      className={`${styles.well} ${styles.button}`}
      disabled={disabled}
      data-well=""
      data-disabled={disabled ? "" : undefined}
      data-invalid={field.invalid ? "" : undefined}
      aria-describedby={field.describedBy}
    >
      <span
        id={valueId}
        className={styles.value}
        data-placeholder={empty ? "" : undefined}
      >
        {typeof shown === "string" ? (
          <span className={styles.valueText}>{shown}</span>
        ) : (
          shown
        )}
        {suffix && <span className={styles.affix}>{suffix}</span>}
      </span>
      {chevron && <ChevronDownIcon size={14} aria-hidden />}
    </button>
  );
}
