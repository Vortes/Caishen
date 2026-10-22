"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import entry from "../app-shell/transaction-entry.module.css";
import target from "../app-shell/target-editor.module.css";
import {
  addMonths,
  balanceOn,
  durationLabel,
  endOf,
  forecast,
  monthLabel,
  money,
  parseAmount,
  percent,
  rateOn,
  schedule,
  type Loan,
} from "./data";
import { Field, Well } from "./fields";
import { useStore } from "./store";
import styles from "./loans.module.css";

type Cadence = "once" | "monthly";

// YNAB's loan planner, scoped to the glossary's extra-payment preview: try an
// extra payment and see the payoff move. It changes no money.
export function ExtraPayment({ loan }: { loan: Loan }) {
  const { month, variants } = useStore();
  const [cadence, setCadence] = useState<Cadence>("once");
  const [input, setInput] = useState("");
  const id = useId();
  const parsed = parseAmount(input);
  const invalid = parsed !== null && Number.isNaN(parsed);
  const balance = balanceOn(loan, endOf(month));
  const mode: Cadence = variants.cadence === "both" ? cadence : "once";
  const capped =
    mode === "once" && parsed !== null && !invalid && parsed > balance;
  const amount = parsed === null || invalid ? 0 : Math.min(parsed, balance);
  const extra = mode === "once" ? { once: amount } : { monthly: amount };
  const before = forecast(loan, month);
  const after = forecast(loan, month, extra);
  const rate = rateOn(loan, endOf(month)).annualRateBps;
  const error = invalid
    ? "Enter an amount like 500.00."
    : capped
      ? `Only ${money(balance)} is left. Paying that clears the loan this month.`
      : undefined;

  if (before.payoffMonth === null && amount === 0)
    return (
      <div className={styles.tabStack}>
        <p className={entry.notice}>
          At {percent(rate)}, the {money(loan.minimumPayment)} payment doesn’t
          cover the monthly interest, so this loan never pays off. Raise the
          payment target, or confirm the rate if it has changed.
        </p>
        <ExtraField
          id={id}
          mode={mode}
          cadence={cadence}
          onCadence={setCadence}
          input={input}
          onInput={setInput}
          error={error}
          payment={loan.minimumPayment}
        />
        <Note loan={loan} rate={rate} />
      </div>
    );

  const saved =
    before.interest !== null && after.interest !== null
      ? before.interest - after.interest
      : null;
  const sooner =
    before.payoffMonth && after.payoffMonth
      ? Math.max(0, before.months! - after.months!)
      : null;
  return (
    <div className={styles.tabStack}>
      <ExtraField
        id={id}
        mode={mode}
        cadence={cadence}
        onCadence={setCadence}
        input={input}
        onInput={setInput}
        error={error}
        payment={loan.minimumPayment}
      />
      {amount > 0 ? (
        <dl className={styles.compare}>
          <div>
            <dt>Payoff</dt>
            <dd>
              {before.payoffMonth ? monthLabel(before.payoffMonth) : "Never"} →{" "}
              <strong>
                {after.payoffMonth
                  ? after.months === 0
                    ? "This month"
                    : monthLabel(after.payoffMonth)
                  : "Never"}
              </strong>
            </dd>
          </div>
          <div>
            <dt>Interest</dt>
            <dd>
              {before.interest === null ? "Unknown" : money(before.interest)} →{" "}
              <strong>
                {after.interest === null ? "Unknown" : money(after.interest)}
              </strong>
            </dd>
          </div>
          {saved !== null && (
            <div>
              <dt>You’d save</dt>
              <dd>
                <strong>{money(saved)}</strong>
                {sooner ? ` and ${durationLabel(sooner)} sooner` : ""}
              </dd>
            </div>
          )}
          {saved === null && after.payoffMonth && (
            <div>
              <dt>You’d save</dt>
              <dd>
                A payoff in <strong>{durationLabel(after.months ?? 0)}</strong>,
                where there was none
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <dl className={styles.compare}>
          <div>
            <dt>Payoff</dt>
            <dd>
              <strong>{monthLabel(before.payoffMonth!)}</strong>, in{" "}
              {durationLabel(before.months!)}
            </dd>
          </div>
          <div>
            <dt>Interest</dt>
            <dd>
              <strong>{money(before.interest!)}</strong> left to pay
            </dd>
          </div>
        </dl>
      )}
      {variants.compare === "chart" && (
        <PayoffChart
          loan={loan}
          month={month}
          extra={amount > 0 ? extra : null}
        />
      )}
      {mode === "monthly" && amount > 0 && (
        <p className={target.hint}>
          To plan for it, set the payment category’s target to{" "}
          {money(loan.minimumPayment + amount)} a month.
        </p>
      )}
      <Note loan={loan} rate={rate} />
    </div>
  );
}

function ExtraField({
  id,
  mode,
  cadence,
  onCadence,
  input,
  onInput,
  error,
  payment,
}: {
  id: string;
  mode: Cadence;
  cadence: Cadence;
  onCadence: (cadence: Cadence) => void;
  input: string;
  onInput: (value: string) => void;
  error?: string;
  payment: number;
}) {
  const { variants } = useStore();
  return (
    <>
      {variants.cadence === "both" && (
        <SegmentedControl
          fill
          aria-label="Extra payment cadence"
          value={cadence}
          onValueChange={(value) => onCadence(value as Cadence)}
        >
          <SegmentedControlItem value="once">One time</SegmentedControlItem>
          <SegmentedControlItem value="monthly">
            Every month
          </SegmentedControlItem>
        </SegmentedControl>
      )}
      <Field
        id={`${id}-extra`}
        label={mode === "once" ? "Extra payment" : "Extra each month"}
        error={error}
        hint={
          mode === "once"
            ? "Paid once this month, on top of the regular payment."
            : `Added to the ${money(payment)} payment every month.`
        }
      >
        <Well
          id={`${id}-extra`}
          value={input}
          prefix="$"
          placeholder="0.00"
          align="end"
          error={error}
          hint
          onChange={onInput}
        />
      </Field>
    </>
  );
}

function Note({ loan, rate }: { loan: Loan; rate: number }) {
  return (
    <p className={target.hint}>
      A preview only: it moves no money and makes no payment.{" "}
      {loan.variable
        ? `Assumes ${percent(rate)} holds until you confirm a new rate.`
        : `Uses the fixed ${percent(rate)} rate.`}{" "}
      Your lender’s charges may differ.
    </p>
  );
}

// The balance month by month, today's plan against the plan with the extra
// payment. Two neutral lines, told apart by weight and dash, since color in
// the shell is kept for money states.
function PayoffChart({
  loan,
  month,
  extra,
}: {
  loan: Loan;
  month: string;
  extra: { once?: number; monthly?: number } | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const base = schedule(loan, month);
  const next = extra ? schedule(loan, month, extra) : null;
  const empty = Math.max(base.length, next?.length ?? 0) < 2;
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([item]) =>
      setWidth(item!.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [empty]);
  const height = 132;
  const pad = { top: 10, right: 4, bottom: 22, left: 4 };
  const span = Math.max(base.length, next?.length ?? 0) - 1;
  const top = Math.max(...base, ...(next ?? []), 1);
  const x = (index: number) =>
    pad.left + (index / Math.max(1, span)) * (width - pad.left - pad.right);
  const y = (value: number) =>
    pad.top + (1 - value / top) * (height - pad.top - pad.bottom);
  const path = (points: number[]) =>
    points
      .map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`)
      .join("");
  // A tick each January, thinned to fit.
  const years: number[] = [];
  for (let index = 0; index <= span; index++)
    if (addMonths(month, index).endsWith("-01")) years.push(index);
  const step = Math.ceil(years.length / Math.max(1, Math.floor(width / 56)));
  const ticks = years.filter((_, index) => index % step === 0);
  const index =
    hover === null ? null : Math.max(0, Math.min(span, Math.round(hover)));
  if (empty) return null;
  const label = extra ? "Payoff with and without the extra payment" : "Payoff";

  return (
    <figure className={styles.chart}>
      {next && (
        <figcaption className={styles.legend}>
          <span>
            <i data-line="base" aria-hidden />
            Current plan
          </span>
          <span>
            <i data-line="extra" aria-hidden />
            With extra
          </span>
        </figcaption>
      )}
      <div
        ref={box}
        className={styles.plot}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio =
            (event.clientX - rect.left - pad.left) /
            (rect.width - pad.left - pad.right);
          setHover(ratio * span);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${label}: balance falls from ${money(base[0]!)} to zero by ${monthLabel(addMonths(month, base.length - 1))}${next ? `, or by ${monthLabel(addMonths(month, next.length - 1))} with the extra payment` : ""}.`}
          >
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(0)}
              y2={y(0)}
              className={styles.axis}
            />
            {ticks.map((tick) => (
              <text
                key={tick}
                x={x(tick)}
                y={height - 6}
                className={styles.tick}
                textAnchor={tick === 0 ? "start" : "middle"}
              >
                {addMonths(month, tick).slice(0, 4)}
              </text>
            ))}
            <path
              d={path(base)}
              className={styles.line}
              data-line={next ? "base" : "only"}
            />
            {next && (
              <path d={path(next)} className={styles.line} data-line="extra" />
            )}
            {index !== null && (
              <>
                <line
                  x1={x(index)}
                  x2={x(index)}
                  y1={pad.top}
                  y2={y(0)}
                  className={styles.crosshair}
                />
                {[base, next].map(
                  (points, series) =>
                    points && (
                      <circle
                        key={series}
                        cx={x(index)}
                        cy={y(points[index] ?? 0)}
                        r={4}
                        className={styles.dot}
                        data-line={series ? "extra" : next ? "base" : "only"}
                      />
                    ),
                )}
              </>
            )}
          </svg>
        )}
        {index !== null && width > 0 && (
          <div
            className={styles.tooltip}
            style={{
              left: Math.min(Math.max(x(index), 70), width - 70),
            }}
          >
            <strong>{monthLabel(addMonths(month, index))}</strong>
            <span>
              {next ? "Current " : ""}
              {money(base[index] ?? 0)}
            </span>
            {next && <span>With extra {money(next[index] ?? 0)}</span>}
          </div>
        )}
      </div>
    </figure>
  );
}
