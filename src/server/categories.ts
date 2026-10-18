import { z } from "zod";

const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  deleted: z.boolean().optional(),
});
const groupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  deleted: z.boolean().optional(),
  categories: z.array(categorySchema).max(500),
});

export function parseCategoryImport(
  text: string,
): { name: string; group: string }[] {
  if (text.length > 1_000_000)
    throw new Error("Category imports must be under 1 MB.");
  let categories: { name: string; group: string }[];
  if (text.trim().startsWith("{")) {
    const parsed: unknown = JSON.parse(text);
    const groups = z
      .object({ category_groups: z.array(groupSchema).max(100) })
      .parse(parsed).category_groups;
    categories = groups
      .filter(
        (g) =>
          !g.deleted &&
          g.name !== "Internal Master Category" &&
          g.name !== "Credit Card Payments",
      )
      .flatMap((g) =>
        g.categories
          .filter((c) => !c.deleted && c.name !== "Inflow: Ready to Assign")
          .map((c) => ({ name: c.name, group: g.name })),
      );
  } else {
    const rows = parseCsv(text);
    const headers = rows.shift()?.map((v) => v.trim().toLowerCase()) ?? [];
    const nameIndex = headers.indexOf("category");
    const groupIndex = headers.indexOf("category group");
    if (nameIndex < 0 || groupIndex < 0)
      throw new Error(
        'Use YNAB category JSON, or CSV with "Category Group,Category" headers. Only names are imported.',
      );
    categories = rows
      .filter((r) => r.some(Boolean))
      .map((r) => ({
        name: categorySchema.shape.name.parse(r[nameIndex]),
        group: groupSchema.shape.name.parse(r[groupIndex]),
      }));
  }
  const unique = new Map(
    categories.map((c) => [`${c.group}\u0000${c.name}`, c]),
  );
  if (!unique.size || unique.size > 500)
    throw new Error("Import between 1 and 500 categories.");
  return [...unique.values()];
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if (char === "\n" && !quoted) {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else value += char;
  }
  if (quoted) throw new Error("Close all quoted CSV fields.");
  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}
