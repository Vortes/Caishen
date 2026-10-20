"use client";

import { Field } from "~/components/shared";
import { Textarea } from "~/components/ui-legacy/textarea";

export function FormTextArea({
  label,
  name,
  ...props
}: {
  label: string;
  name: string;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label}>
      <Textarea
        name={name}
        {...props}
        onKeyDown={(event) => {
          props.onKeyDown?.(event);
          if (
            !event.defaultPrevented &&
            (event.metaKey || event.ctrlKey) &&
            event.key === "Enter"
          ) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
    </Field>
  );
}
