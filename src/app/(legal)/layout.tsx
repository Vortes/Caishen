import Link from "next/link";
import styles from "./legal.module.css";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#policy">
        Skip to policy
      </a>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          Caishen
        </Link>
        <nav aria-label="Policy pages">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </header>
      <main id="policy" className={styles.content}>
        {children}
      </main>
      <footer className={styles.footer}>
        <Link href="/">Back to Caishen</Link>
        <a href="mailto:zeyu.weng@gmail.com">Contact us</a>
      </footer>
    </div>
  );
}
