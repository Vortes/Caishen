"use client";

import { monthName, moveMonth, currentMonth } from "~/components/budget/format";
import { Icon } from "~/components/shared";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

export function MonthPicker({
  month,
  startMonth,
  timezone,
  onChange,
}: {
  month: string;
  startMonth: string;
  timezone: string;
  onChange: (month: string) => void;
}) {
  return (
    <div className="month-picker">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous month"
        disabled={month <= startMonth}
        onClick={() => onChange(moveMonth(month, -1))}
      >
        <Icon name="chevron-left" size={20} />
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" className="month-picker-label">
            {monthName(month)}
            <Icon name="chevron-down" size={14} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="month-popover">
          <label htmlFor="budget-month">Go to month</label>
          <input
            id="budget-month"
            type="month"
            min={startMonth}
            value={month}
            onChange={(event) => {
              if (event.target.value && event.target.value >= startMonth)
                onChange(event.target.value);
            }}
          />
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Next month"
        onClick={() => onChange(moveMonth(month, 1))}
      >
        <Icon name="chevron-right" size={20} />
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          onChange(
            currentMonth(timezone) < startMonth
              ? startMonth
              : currentMonth(timezone),
          )
        }
      >
        Today
      </Button>
    </div>
  );
}
