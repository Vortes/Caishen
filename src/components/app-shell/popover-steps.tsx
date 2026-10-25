import type { ReactNode } from "react";

export function PopoverSteps({
  step,
  children,
}: {
  step: string;
  children: ReactNode;
}) {
  return <div key={step}>{children}</div>;
}
