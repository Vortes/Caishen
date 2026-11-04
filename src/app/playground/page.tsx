import Link from "next/link";
import styles from "~/components/playground/playground.module.css";

const pages = [
  {
    href: "/playground/people",
    title: "People picker stress cases",
    description:
      "Long names, large balances, empty lists, and 1,000 people in the real picker primitive.",
  },
  {
    href: "/playground/partner-invite",
    title: "Partner invite lab",
    description:
      "A paper plane delivers a signed card; countersign, tally seal, and slot it in.",
  },
];

export default function PlaygroundIndex() {
  return (
    <main className={styles.column}>
      <h1 className={styles.title}>Playground</h1>
      <ul className={styles.index}>
        {pages.map((page) => (
          <li key={page.href}>
            <Link href={page.href} className={styles.indexLink}>
              <span className={styles.label}>{page.title}</span>
              <span className={styles.hint}>{page.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
