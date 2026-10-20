import { Tag } from "~/components/ui/tag";
import styles from "./design-system.module.css";

// A Tag marks an exception: one transaction that needs a category among a
// register of ones that are fine.

type Item = { payee: string; detail: string; tag?: string; amount: number };

const register: Item[] = [
  { payee: "Trader Joe's", detail: "Groceries", amount: -6418 },
  { payee: "Shell", detail: "Gas", amount: -5230 },
  {
    payee: "Venmo from Mei",
    detail: "Transfer",
    tag: "Uncategorized",
    amount: 6150,
  },
  { payee: "PG&E", detail: "Utilities", amount: -11820 },
  { payee: "Acme Corp payroll", detail: "Ready to Assign", amount: 240000 },
];

const money = (cents: number) =>
  `${cents < 0 ? "-" : "+"}$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
  })}`;

export function TagSpecimens() {
  return (
    <section className={styles.section} aria-labelledby="tag">
      <h2 id="tag">Tag</h2>
      <p className={styles.lead}>
        A tag marks an exception. If every row in a list would carry one, the
        list drops them: its heading already says what the rows share.
      </p>
      <div className={styles.contexts}>
        <figure className={styles.context}>
          <div className={styles.surface}>
            <strong>Chase Checking · October</strong>
            <ul className={styles.specimenList}>
              {register.map((item) => (
                <li key={item.payee} className={styles.specimenRow}>
                  <span className={styles.specimenName}>
                    <strong>{item.payee}</strong>
                    <small>{item.detail}</small>
                  </span>
                  {item.tag && <Tag tone="attention">{item.tag}</Tag>}
                  <span
                    className={styles.specimenAmount}
                    data-inflow={item.amount > 0 || undefined}
                  >
                    {money(item.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <figcaption>
            Register: attention marks the one row that needs you.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
