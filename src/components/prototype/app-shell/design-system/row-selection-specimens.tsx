"use client";

import { useState } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { useRowSelection } from "~/components/ui/use-row-selection";
import selectionStyles from "~/components/ui/row-selection.module.css";
import styles from "./design-system.module.css";
import rowStyles from "./row-selection-specimens.module.css";

const rows = ["Groceries", "Dining out", "Transport", "Subscriptions", "Gifts"];

function SelectionExample({ table = false }: { table?: boolean }) {
  const [checked, setChecked] = useState(["Groceries", "Dining out", "Gifts"]);
  const selection = useRowSelection(checked);
  const checkbox = (name: string) => (
    <Checkbox
      aria-label={`Select ${name} in ${table ? "table" : "list"}`}
      checked={checked.includes(name)}
      onCheckedChange={(value) =>
        setChecked((previous) =>
          value === true
            ? [...previous, name]
            : previous.filter((item) => item !== name),
        )
      }
    />
  );
  return (
    <div className={rowStyles.example}>
      <h3>{table ? "Table rows" : "List rows"}</h3>
      {table ? (
        <table
          className={`${selectionStyles.list} ${rowStyles.table}`}
          {...selection.listProps}
        >
          <caption className="sr-only">Selectable table rows</caption>
          <tbody>
            {rows.map((name) => (
              <tr
                key={name}
                className={selectionStyles.row}
                {...selection.rowProps(name)}
              >
                <td>{checkbox(name)}</td>
                <td>{name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div
          className={selectionStyles.list}
          role="group"
          aria-label="Selectable list rows"
          {...selection.listProps}
        >
          {rows.map((name) => (
            <label
              key={name}
              className={`${selectionStyles.row} ${rowStyles.row}`}
              {...selection.rowProps(name)}
            >
              {checkbox(name)}
              <span>{name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function RowSelectionSpecimens() {
  return (
    <section className={styles.section} aria-labelledby="row-selection">
      <h2 id="row-selection">Row selection</h2>
      <p className={styles.lead}>
        One outline joins adjacent selected rows. Toggle the checkboxes to split
        or join a group; use Tab and Space to select without motion. The plan
        and transaction register share this pattern in both interfaces.
      </p>
      <div className={rowStyles.examples}>
        <SelectionExample />
        <SelectionExample table />
      </div>
    </section>
  );
}
