"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { cn } from "~/lib/utils";
import type { Command, Target } from "~/domain/engine";
import type { Category } from "~/components/budget/category-table";
import {
  currentMonth,
  formatMoney,
  money,
  newId,
  text,
} from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import { Amount, FormField, Icon, SelectField } from "~/components/shared";
import { Button } from "~/components/ui-legacy/button";
import { Checkbox } from "~/components/ui-legacy/checkbox";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui-legacy/popover";

type Cadence = Target["cadence"];
type Behavior = Target["behavior"];

const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const ordinal = (day: number) => {
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  return `${day}${suffix}`;
};

const longDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

const cents = (input: string) => {
  const data = new FormData();
  data.set("amount", input || "0");
  try {
    return money(data, "amount");
  } catch {
    return 0;
  }
};

function tabsFor(category: Category): { value: Cadence; label: string }[] {
  if (category.pairedAccountId)
    return [
      { value: "card-monthly", label: "Monthly" },
      { value: "card-payoff", label: "Pay off by date" },
    ];
  if (category.pairedLoanId) return [{ value: "loan", label: "Monthly" }];
  return [
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
    { value: "yearly", label: "Yearly" },
    { value: "custom", label: "Custom" },
  ];
}

export function TargetSection({
  view,
  month,
  category,
  busy,
  run,
}: {
  view: View;
  month: string;
  category: Category;
  busy: boolean;
  run: (command: Command) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const saved = useRef(category.target);
  useEffect(() => {
    if (saved.current === category.target) return;
    saved.current = category.target;
    setEditing(false);
  }, [category.target]);
  return (
    <section className="inspector-section target-section">
      <h3>
        {category.target && !editing ? (
          <button
            type="button"
            className="target-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            Target
            <Icon name="chevron-down" size={13} />
          </button>
        ) : (
          "Target"
        )}
      </h3>
      {editing ? (
        <TargetEditor
          month={month}
          category={category}
          busy={busy}
          run={run}
          onCancel={() => setEditing(false)}
        />
      ) : !category.target ? (
        <div className="target-empty">
          <h4>How much do you need for {category.name}?</h4>
          <p>
            When you create a target, we’ll let you know how much money to set
            aside to stay on track over time.
          </p>
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Create target for ${category.name}`}
            onClick={() => setEditing(true)}
          >
            Create target
          </Button>
        </div>
      ) : (
        expanded &&
        category.targetProgress && (
          <TargetSummary
            view={view}
            month={month}
            category={category}
            target={category.target}
            progress={category.targetProgress}
            busy={busy}
            run={run}
            onEdit={() => setEditing(true)}
          />
        )
      )}
    </section>
  );
}

export function describeTarget(target: Target) {
  const amount = formatMoney(target.amount);
  const action =
    target.cadence === "card-monthly" || target.cadence === "loan"
      ? `Pay ${amount} each month`
      : target.cadence === "card-payoff"
        ? "Pay off the balance"
        : target.behavior === "balance"
          ? `Have a balance of ${amount}`
          : `${target.behavior === "refill" ? "Refill up to" : "Set aside another"} ${amount}${
              target.cadence === "weekly"
                ? " each week"
                : target.cadence === "monthly"
                  ? " each month"
                  : target.cadence === "yearly"
                    ? " each year"
                    : target.repeatEvery
                      ? ` every ${target.repeatEvery === 1 ? "" : `${target.repeatEvery} `}${target.repeatEvery === 1 ? target.repeatUnit!.slice(0, -1) : target.repeatUnit}`
                      : ""
            }`;
  const when =
    target.cadence === "weekly"
      ? `Every ${weekdays[target.weekday ?? 0]}`
      : target.dueDate
        ? `By ${longDate(target.dueDate)}`
        : target.monthDay
          ? `By the ${ordinal(target.monthDay)} of the month`
          : target.cadence === "custom"
            ? "No due date"
            : "By the end of the month";
  return { action, when };
}

function TargetSummary({
  view,
  month,
  category,
  target,
  progress,
  busy,
  run,
  onEdit,
}: {
  view: View;
  month: string;
  category: Category;
  target: Target;
  progress: NonNullable<Category["targetProgress"]>;
  busy: boolean;
  run: (command: Command) => void;
  onEdit: () => void;
}) {
  const { action, when } = describeTarget(target);
  const assigned = Math.max(0, category.assigned);
  const { needed, snoozed } = progress;
  const ratio =
    target.behavior === "balance"
      ? progress.total
        ? progress.funded / progress.total
        : 1
      : assigned + needed
        ? assigned / (assigned + needed)
        : 1;
  const percent = Math.min(100, Math.floor(ratio * 100));
  const assignable = Math.min(needed, Math.max(0, view.readyToAssign));
  const today = currentMonth(view.budget.settings.timezone);
  const canSnooze = !category.pairedAccountId && month === today;
  return (
    <div
      className={cn(
        "target-summary",
        snoozed ? "is-snoozed" : needed === 0 ? "is-funded" : "is-underfunded",
      )}
    >
      <div className="target-description">
        <strong>{action}</strong>
        <span>{when}</span>
      </div>
      <div
        className="target-ring"
        role="progressbar"
        aria-label="Target progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        style={{ "--target-progress": `${percent}%` } as React.CSSProperties}
      >
        <span>{percent}%</span>
      </div>
      <div className="target-callout">
        {snoozed ? (
          <p>Target snoozed for this month</p>
        ) : needed > 0 ? (
          <>
            <p>
              Assign <Amount value={needed} /> more to meet your target
            </p>
            <Button
              size="sm"
              disabled={busy || assignable === 0}
              title={
                assignable === 0 ? "Nothing is ready to assign" : undefined
              }
              onClick={() =>
                run({
                  type: "assign",
                  id: newId(),
                  categoryId: category.id,
                  month,
                  amount: assignable,
                })
              }
            >
              Assign
            </Button>
          </>
        ) : (
          <p>
            <Icon name="check" size={15} />
            You’ve assigned enough to meet your target
          </p>
        )}
      </div>
      <dl className="inspector-values">
        <div>
          <dt>Amount to assign this month</dt>
          <dd>
            <Amount value={assigned + needed} />
          </dd>
        </div>
        <div>
          <dt>Assigned so far</dt>
          <dd>
            <Amount value={assigned} />
          </dd>
        </div>
        <div className="target-to-go">
          <dt>To go</dt>
          <dd>
            <Amount value={needed} />
          </dd>
        </div>
      </dl>
      <Button
        variant="secondary"
        size="sm"
        className="inspector-wide-action"
        onClick={onEdit}
      >
        Edit target
      </Button>
      {canSnooze && (
        <label className="target-snooze">
          <button
            type="button"
            role="switch"
            aria-checked={snoozed}
            className="switch"
            disabled={busy}
            onClick={() =>
              run({
                type: "target.snooze",
                id: newId(),
                categoryId: category.id,
                month,
                currentMonth: today,
                snoozed: !snoozed,
              })
            }
          />
          Snooze target for this month
        </label>
      )}
    </div>
  );
}

function TargetEditor({
  month,
  category,
  busy,
  run,
  onCancel,
}: {
  month: string;
  category: Category;
  busy: boolean;
  run: (command: Command) => void;
  onCancel: () => void;
}) {
  const existing = category.target;
  const tabs = tabsFor(category);
  const [cadence, setCadence] = useState<Cadence>(
    existing?.cadence ??
      tabs.find((tab) => tab.value === "monthly")?.value ??
      tabs[0]!.value,
  );
  const [behavior, setBehavior] = useState<Behavior>(
    existing?.behavior ?? "contribution",
  );
  const [amount, setAmount] = useState(
    existing ? (existing.amount / 100).toFixed(2) : "",
  );
  const [repeat, setRepeat] = useState(Boolean(existing?.repeatEvery));
  const paired = Boolean(category.pairedAccountId ?? category.pairedLoanId);
  const behaviors: Behavior[] = paired
    ? ["contribution"]
    : cadence === "custom" && !repeat
      ? ["contribution", "refill", "balance"]
      : ["contribution", "refill"];
  const activeBehavior = behaviors.includes(behavior)
    ? behavior
    : "contribution";
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const monthDay = text(data, "monthDay");
    run({
      type: "target.set",
      id: newId(),
      categoryId: category.id,
      target: {
        cadence,
        behavior: activeBehavior,
        amount: money(data, "amount"),
        startMonth: existing?.startMonth ?? month,
        dueDate: text(data, "dueDate") || undefined,
        weekday:
          cadence === "weekly" ? Number(text(data, "weekday")) : undefined,
        monthDay:
          cadence === "monthly" && monthDay !== "last"
            ? Number(monthDay)
            : undefined,
        repeatEvery:
          cadence === "custom" && repeat
            ? Number(text(data, "repeatEvery"))
            : undefined,
        repeatUnit:
          cadence === "custom" && repeat
            ? (text(data, "repeatUnit") as "months" | "years")
            : undefined,
        snoozedMonths: existing?.snoozedMonths ?? [],
      },
    });
  };
  return (
    <form className="target-editor" onSubmit={submit}>
      {tabs.length > 1 && (
        <div className="target-tabs" role="radiogroup" aria-label="Schedule">
          {tabs.map((tab) => (
            <button
              type="button"
              role="radio"
              key={tab.value}
              aria-checked={cadence === tab.value}
              onClick={() => setCadence(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {cadence !== "card-payoff" && (
        <FormField
          label="I need"
          name="amount"
          inputMode="decimal"
          placeholder="$0.00"
          required
          autoFocus
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      )}
      {cadence === "card-payoff" && (
        <input type="hidden" name="amount" value="0" />
      )}
      {cadence === "weekly" && (
        <SelectField
          label="Every"
          name="weekday"
          defaultValue={existing?.weekday ?? 6}
        >
          {weekdays.map((day, index) => (
            <option value={index} key={day}>
              {day}
            </option>
          ))}
        </SelectField>
      )}
      {cadence === "monthly" && (
        <SelectField
          label="By"
          name="monthDay"
          defaultValue={existing?.monthDay ?? "last"}
        >
          <option value="last">Last day of month</option>
          {Array.from({ length: 31 }, (_, index) => (
            <option value={index + 1} key={index}>
              {ordinal(index + 1)}
            </option>
          ))}
        </SelectField>
      )}
      {(cadence === "yearly" ||
        cadence === "custom" ||
        cadence === "card-payoff") && (
        <FormField
          label="By"
          name="dueDate"
          type="date"
          defaultValue={existing?.dueDate}
          min={`${month}-01`}
          required={!(cadence === "custom" && activeBehavior === "balance")}
        />
      )}
      {cadence === "custom" && (
        <div className="target-repeat">
          <label>
            <Checkbox
              checked={repeat}
              onCheckedChange={(value) => setRepeat(value === true)}
            />
            Repeat
          </label>
          {repeat && (
            <>
              <span>Every</span>
              <input
                aria-label="Repeat interval"
                name="repeatEvery"
                type="number"
                min="1"
                max="120"
                required
                defaultValue={existing?.repeatEvery ?? 1}
              />
              <select
                aria-label="Repeat unit"
                name="repeatUnit"
                defaultValue={existing?.repeatUnit ?? "months"}
              >
                <option value="months">Months</option>
                <option value="years">Years</option>
              </select>
            </>
          )}
        </div>
      )}
      {behaviors.length > 1 && (
        <BehaviorPicker
          label={
            cadence === "weekly" || cadence === "monthly"
              ? "Next month I want to"
              : cadence === "yearly"
                ? "Next year I want to"
                : "Then I want to"
          }
          behaviors={behaviors}
          value={activeBehavior}
          amount={cents(amount)}
          suffix={cadence === "weekly" ? "/week" : ""}
          onChange={setBehavior}
        />
      )}
      <div className="target-editor-actions">
        {existing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="target-delete"
            disabled={busy}
            onClick={() =>
              run({
                type: "target.set",
                id: newId(),
                categoryId: category.id,
                target: null,
              })
            }
          >
            <Icon name="trash" size={14} />
            Delete
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          Save target
        </Button>
      </div>
    </form>
  );
}

const behaviorCopy: Record<
  Behavior,
  {
    label: string;
    use: string;
    detail?: (amount: string) => string;
    popular?: boolean;
  }
> = {
  contribution: {
    label: "Set aside another",
    use: "Bills, subscriptions, saving over time",
    popular: true,
  },
  refill: {
    label: "Refill up to",
    use: "Gasoline, fun money, dining out",
    detail: (amount) =>
      `Sets a target to have ${amount} on hand each month. Whatever you don’t spend will get applied toward next month’s ${amount}.`,
  },
  balance: {
    label: "Have a balance of",
    use: "Saving up a specific amount, with or without a date",
  },
};

function BehaviorPicker({
  label,
  behaviors,
  value,
  amount,
  suffix,
  onChange,
}: {
  label: string;
  behaviors: Behavior[];
  value: Behavior;
  amount: number;
  suffix: string;
  onChange: (behavior: Behavior) => void;
}) {
  const formatted = formatMoney(amount);
  return (
    <div className="field">
      <span className="target-field-label" id="target-behavior-label">
        {label}
      </span>
      <Popover>
        <PopoverTrigger
          className="target-behavior-trigger"
          aria-labelledby="target-behavior-label target-behavior-value"
        >
          <span id="target-behavior-value">
            {behaviorCopy[value].label} {formatted}
            {suffix}
          </span>
          <Icon name="chevron-down" size={14} />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="target-behavior-menu"
        >
          <div role="listbox" aria-label={label}>
            {behaviors.map((behavior) => {
              const copy = behaviorCopy[behavior];
              return (
                <PopoverClose asChild key={behavior}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={behavior === value}
                    onClick={() => onChange(behavior)}
                  >
                    <strong>
                      {behavior === value && <Icon name="check" size={14} />}
                      {copy.label} {formatted}
                      {suffix}
                    </strong>
                    <span>Use for: {copy.use}</span>
                    {copy.popular && <em>Most people choose this</em>}
                    {copy.detail && <small>{copy.detail(formatted)}</small>}
                  </button>
                </PopoverClose>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
