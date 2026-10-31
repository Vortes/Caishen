"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field } from "~/components/ui/field";
import { IconButton } from "~/components/ui/icon-button";
import { Popover } from "~/components/ui/popover";
import { Select } from "~/components/ui/select";
import { useShellData } from "../shell-data";
import {
  filterableCategories,
  monthsBetween,
  PARTNER_ACCOUNT,
  presets,
  rangeLabel,
  resolveRange,
  shiftRange,
  UNCATEGORIZED,
  type DateRange,
  type ReflectFilters as Filters,
} from "./report";
import styles from "./reflect.module.css";

type Option = { id: string; label: string };
type Section = { label: string; options: Option[] };

export function ReflectFilters({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
}) {
  const { groups, accounts, partner, month } = useShellData();
  const categorySections: Section[] = [
    ...groups.map((group) => ({
      label: group.name,
      options: filterableCategories(group.categories).map((item) => ({
        id: item.id,
        label: item.name,
      })),
    })),
    {
      label: "Uncategorized",
      options: [{ id: UNCATEGORIZED, label: "Uncategorized" }],
    },
  ].filter((section) => section.options.length);
  const accountSections: Section[] = [
    {
      label: "Cash",
      options: accounts
        .filter((item) => item.kind === "cash")
        .map((item) => ({ id: item.id, label: item.name })),
    },
    {
      label: "Credit",
      options: accounts
        .filter((item) => item.kind === "credit")
        .map((item) => ({ id: item.id, label: item.name })),
    },
    ...(partner
      ? [
          {
            label: "Shared",
            options: [
              { id: PARTNER_ACCOUNT, label: `Paid by ${partner.name}` },
            ],
          },
        ]
      : []),
  ].filter((section) => section.options.length);
  const { from, to } = resolveRange(filters.range, month.current, month.start);
  return (
    <div className={styles.filters} role="group" aria-label="Report filters">
      <div className={styles.stepper}>
        <StepButton
          label="Earlier"
          icon={ChevronLeftIcon}
          to={shiftRange(filters.range, -1, month.current, month.start)}
          onStep={(range) => onChange({ ...filters, range })}
        />
        <DatesFilter
          label={from > to ? "No months" : rangeLabel(from, to)}
          range={filters.range}
          current={month.current}
          start={month.start}
          onChange={(range) => onChange({ ...filters, range })}
        />
        <StepButton
          label="Later"
          icon={ChevronRightIcon}
          to={shiftRange(filters.range, 1, month.current, month.start)}
          onStep={(range) => onChange({ ...filters, range })}
        />
      </div>
      <ChecklistFilter
        name="Categories"
        noun="categories"
        sections={categorySections}
        selected={filters.categoryIds}
        onChange={(categoryIds) => onChange({ ...filters, categoryIds })}
      />
      <ChecklistFilter
        name="Accounts"
        noun="accounts"
        sections={accountSections}
        selected={filters.accountIds}
        onChange={(accountIds) => onChange({ ...filters, accountIds })}
      />
    </div>
  );
}

// Steps the whole range one span earlier or later, like YNAB's month arrows.
function StepButton({
  label,
  icon: Icon,
  to,
  onStep,
}: {
  label: string;
  icon: typeof ChevronLeftIcon;
  to: DateRange | null;
  onStep: (range: DateRange) => void;
}) {
  return (
    <IconButton
      label={`${label} dates`}
      size="sm"
      disabled={!to}
      onClick={() => to && onStep(to)}
    >
      <Icon aria-hidden />
    </IconButton>
  );
}

function FilterPopover({
  name,
  label,
  variant = "secondary",
  children,
  open,
  onOpenChange,
}: {
  name: string;
  label: string;
  variant?: "secondary" | "quiet";
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Popover
      label={name}
      trigger={
        <Button
          size="sm"
          variant={variant}
          // Names the filter, so it isn't confused with the "All categories"
          // breadcrumb beside the report.
          aria-label={`${name}: ${label}`}
        >
          {label}
          <ChevronDownIcon aria-hidden />
        </Button>
      }
      open={open}
      onOpenChange={onOpenChange}
      size="form"
    >
      <div className={styles.filterPanel}>{children}</div>
    </Popover>
  );
}

// YNAB's category and account menus: Select all, Select none, and one
// checkbox per item under its group. Changes apply as you check.
function ChecklistFilter({
  name,
  noun,
  sections,
  selected,
  onChange,
}: {
  name: string;
  noun: string;
  sections: Section[];
  selected: string[] | null;
  onChange: (selected: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const all = sections.flatMap((section) =>
    section.options.map((item) => item.id),
  );
  const chosen = new Set(selected ?? all);
  const count = all.filter((id) => chosen.has(id)).length;
  const set = (ids: string[], value: boolean) => {
    const next = new Set(chosen);
    for (const id of ids) {
      if (value) next.add(id);
      else next.delete(id);
    }
    onChange(all.every((id) => next.has(id)) ? null : [...next]);
  };
  const label =
    count === all.length
      ? `All ${noun}`
      : count === 0
        ? `No ${noun}`
        : `${count} of ${all.length} ${noun}`;
  return (
    <FilterPopover name={name} label={label} open={open} onOpenChange={setOpen}>
      <div className={styles.popoverHeader}>
        <Button
          variant="quiet"
          size="sm"
          disabled={count === all.length}
          onClick={() => onChange(null)}
        >
          Select all
        </Button>
        <Button
          variant="quiet"
          size="sm"
          disabled={count === 0}
          onClick={() => onChange([])}
        >
          Select none
        </Button>
      </div>
      <div className={styles.checklist}>
        {sections.map((section) => {
          const ids = section.options.map((item) => item.id);
          const on = ids.filter((id) => chosen.has(id)).length;
          const single =
            section.options.length === 1 &&
            section.options[0]!.label === section.label;
          return (
            <fieldset key={section.label} className={styles.checkGroup}>
              <Check
                label={section.label}
                strong
                checked={on === ids.length}
                mixed={on > 0 && on < ids.length}
                onChange={(value) => set(ids, value)}
              />
              {!single &&
                section.options.map((item) => (
                  <Check
                    key={item.id}
                    label={item.label}
                    checked={chosen.has(item.id)}
                    onChange={(value) => set([item.id], value)}
                  />
                ))}
            </fieldset>
          );
        })}
      </div>
      <div className={styles.popoverFooter}>
        <Button size="sm" onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
    </FilterPopover>
  );
}

function Check({
  label,
  checked,
  mixed = false,
  strong = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  mixed?: boolean;
  strong?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={styles.check} data-strong={strong || undefined}>
      <Checkbox
        checked={mixed ? "indeterminate" : checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <span>{label}</span>
    </label>
  );
}

const monthOption = (month: string) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });

// Presets as rows, then a custom From and To range behind a hairline.
function DatesFilter({
  label,
  range,
  current,
  start,
  onChange,
}: {
  label: string;
  range: DateRange;
  current: string;
  start: string;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const resolved = resolveRange(range, current, start);
  const [from, setFrom] = useState(resolved.from);
  const [to, setTo] = useState(resolved.to);
  const monthOptions = monthsBetween(start, current).map((month) => ({
    value: month,
    label: monthOption(month),
  }));
  const choose = (next: DateRange) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <FilterPopover
      name="Dates"
      label={label}
      variant="quiet"
      open={open}
      onOpenChange={(value) => {
        if (value) {
          setFrom(resolved.from > current ? start : resolved.from);
          setTo(resolved.to > current ? current : resolved.to);
        }
        setOpen(value);
      }}
    >
      <ul className={styles.presets}>
        {presets.map((preset) => (
          <li key={preset.id}>
            <button
              type="button"
              className={styles.preset}
              aria-pressed={range.preset === preset.id}
              onClick={() => choose({ preset: preset.id })}
            >
              <span>{preset.label}</span>
              {range.preset === preset.id && (
                <CheckIcon size={14} strokeWidth={2.5} aria-hidden />
              )}
            </button>
          </li>
        ))}
      </ul>
      <form
        className={styles.custom}
        onSubmit={(event) => {
          event.preventDefault();
          choose({ preset: "custom", from, to });
        }}
      >
        <span className={styles.customTitle}>
          Custom
          {range.preset === "custom" && (
            <CheckIcon size={14} strokeWidth={2.5} aria-hidden />
          )}
        </span>
        <Field label="From">
          <Select
            value={from}
            onChange={(next) => {
              setFrom(next);
              if (next > to) setTo(next);
            }}
            options={monthOptions}
          />
        </Field>
        <Field label="To">
          <Select
            value={to}
            onChange={(next) => {
              setTo(next);
              if (next < from) setFrom(next);
            }}
            options={monthOptions}
          />
        </Field>
        <div className={styles.customSubmit}>
          <Button variant="primary" size="sm" type="submit">
            Apply
          </Button>
        </div>
      </form>
    </FilterPopover>
  );
}
