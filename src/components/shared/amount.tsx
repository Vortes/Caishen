import { cn } from "~/lib/utils";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const signedCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  signDisplay: "exceptZero",
});

export function Amount({
  value,
  signed = false,
  className,
}: {
  value: number;
  signed?: boolean;
  className?: string;
}) {
  const formatter = signed ? signedCurrencyFormatter : currencyFormatter;
  return (
    <span className={cn("money", className)}>
      {formatter.format(value / 100)}
    </span>
  );
}
