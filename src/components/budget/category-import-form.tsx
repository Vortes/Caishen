"use client";

import { FormField } from "~/components/shared";
import { FormTextArea as TextArea } from "~/components/budget/form-textarea";

export function CategoryImportForm({
  fileText,
  readFile,
}: {
  fileText: string;
  readFile: React.ChangeEventHandler<HTMLInputElement>;
}) {
  return (
    <>
      <p className="small muted">
        Only category names and groups are imported. Account balances,
        transactions, assignments, and reimbursements are excluded.
      </p>
      <FormField
        label="YNAB categories file"
        name="file"
        type="file"
        accept=".csv,.json,text/csv,application/json"
        onChange={readFile}
        hint="CSV with Category Group,Category columns, or JSON with category_groups and categories."
      />
      <TextArea
        label="Or paste category data"
        name="importText"
        placeholder={
          "Category Group,Category\nEveryday,Groceries\nEveryday,Dining out"
        }
        required={!fileText}
      />
    </>
  );
}
