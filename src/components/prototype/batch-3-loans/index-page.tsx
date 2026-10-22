import styles from "./loans.module.css";

const base = "/prototype/batch-3-loans/shell";

const groups: {
  title: string;
  links: { href: string; label: string; detail: string }[];
}[] = [
  {
    title: "Flows",
    links: [
      {
        href: `${base}?open=add`,
        label: "Add a loan",
        detail:
          "Opens Add loan. Submit it empty to see every field’s error; type terms to watch the payoff fill in.",
      },
      {
        href: `${base}?loan=sofi&open=rate`,
        label: "Update a confirmed rate",
        detail:
          "SoFi’s variable rate, due for a check. Try 7.62% again, a new rate, Feb 1, 2026 (taken), or a future date.",
      },
      {
        href: `${base}?loan=nelnet&tab=extra`,
        label: "Preview an extra payment",
        detail:
          "Nelnet, fixed 5.50%. Enter 2,000 to see the new payoff and interest saved; more than the balance caps it.",
      },
      {
        href: `${base}?loan=nelnet&open=payment`,
        label: "Record a lender payment",
        detail:
          "October’s Nelnet payment, from the details panel. Leave interest empty or above the payment to see errors.",
      },
      {
        href: `${base}?loan=nelnet&open=payment&pay=register`,
        label: "Record a lender payment in the register",
        detail:
          "The same payment handed to Chase Total Checking’s register, in the shell’s transaction editor.",
      },
    ],
  },
  {
    title: "States",
    links: [
      {
        href: `${base}?scenario=empty`,
        label: "No loans",
        detail: "The empty Loans screen and its Add loan action.",
      },
      {
        href: `${base}?loan=honda&tab=payments`,
        label: "Paid off",
        detail: "Honda, paid off in June 2025: totals and its payment history.",
      },
      {
        href: `${base}?loan=sofi&tab=rates`,
        label: "Variable rate due for an update",
        detail:
          "Last confirmed eight months ago: a tag in the list, Update rate as the primary action, and a note in Rates.",
      },
      {
        href: `${base}?scenario=underwater&loan=sofi`,
        label: "Payment below interest",
        detail:
          "SoFi reset to 17.25%, so $225 a month never pays it off. No payoff date, and the preview says why.",
      },
      {
        href: `${base}?loan=nelnet&tab=extra&cadence=both`,
        label: "Extra payment, one time or monthly",
        detail:
          "The cadence variant, with a monthly extra on top of the payment.",
      },
    ],
  },
];

export function LoansIndex() {
  return (
    <main className={styles.index} data-theme="dark">
      <div className={styles.indexInner}>
        <header>
          <h1>Batch 3 · Loans</h1>
          <p>
            Add a loan, confirm a variable rate, preview an extra payment, and
            record a lender payment, on the shell’s Loans screen. Hardcoded data
            for October 21, 2026; nothing reaches a budget. Every page has
            prototype controls along the bottom: scenario, the four variants,
            theme, and Reset. Hover a control to see the variable it moves.
          </p>
        </header>
        {groups.map((group) => (
          <section key={group.title}>
            <h2>{group.title}</h2>
            <ul className={styles.links}>
              {group.links.map((link) => (
                <li key={link.href}>
                  <a href={link.href}>
                    {link.label}
                    <span>{link.detail}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
