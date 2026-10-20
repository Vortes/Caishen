"use client";

import { useMemo } from "react";
import { api } from "~/trpc/react";
import type { ShellData } from "../model";
import { SLOTS } from "./chart-utils";
import {
  buildReport,
  type DrillPath,
  type Grouping,
  type ReflectFilters,
} from "./report";

// Loads every month of personal spending once, then filters and groups it
// locally, so changing a filter or drilling down is instant.
export function useSpendingReport({
  data,
  filters,
  path,
  grouping,
  enabled,
}: {
  data: ShellData;
  filters: ReflectFilters;
  path: DrillPath;
  grouping: Grouping;
  enabled: boolean;
}) {
  const {
    categories,
    today,
    month: { start },
  } = data;
  const query = api.budget.spending.useQuery(undefined, { enabled });
  const report = useMemo(
    () =>
      query.data &&
      buildReport({
        entries: query.data.entries,
        categories,
        filters,
        path,
        grouping,
        today,
        start,
        slots: SLOTS,
      }),
    [query.data, categories, filters, path, grouping, today, start],
  );
  return { report, error: query.error?.message };
}

export type SpendingReport = ReturnType<typeof useSpendingReport>;
