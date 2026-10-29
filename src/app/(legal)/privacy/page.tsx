import { type Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy policy · Caishen",
  description:
    "How Caishen handles your account, budget, and connected services.",
  alternates: { canonical: "https://curate.is/privacy" },
};

export default function PrivacyPage() {
  return (
    <>
      <header>
        <h1>Privacy policy</h1>
        <p>Last updated October 23, 2026</p>
        <p>
          Caishen, available at curate.is, helps you manage a personal budget,
          track shared expenses, and review your transactions. This policy
          explains what information we handle, why we use it, and the choices
          available to you.
        </p>
      </header>
      <section>
        <h2>Information we collect</h2>
        <ul>
          <li>
            Account information, including your email address, name, profile
            picture when provided, and an account identifier managed through
            Clerk, our authentication provider.
          </li>
          <li>
            Information you enter into Caishen, such as accounts, balances,
            transactions, payees, notes, categories, targets, loans, shared
            expenses, and budget preferences.
          </li>
          <li>
            When you connect a supported bank through Plaid, the account and
            transaction information you authorize, along with connection
            identifiers and credentials used to retrieve updates.
          </li>
          <li>
            Service records, including budget changes, invitation activity,
            reconciliation evidence, email delivery status, and technical
            information processed by our hosting and authentication providers,
            such as IP addresses and request logs.
          </li>
        </ul>
      </section>
      <section>
        <h2>Signing in with Google</h2>
        <p>
          If you choose Google sign-in, Google shares your account identifier,
          email address, and basic profile information, such as your name and
          profile picture, with Clerk to create or authenticate your Caishen
          account. Caishen can store your email address and profile details to
          identify your account and deliver enabled account features.
        </p>
        <p>
          Google sign-in does not give Caishen access to your Gmail messages,
          Google Drive files, contacts, or calendar. We use Google account
          information for authentication and account features, not advertising.
          Google profile information is not included in requests for AI
          transaction categorization.
        </p>
      </section>
      <section>
        <h2>How we use information</h2>
        <p>
          We use your information to sign you in, save and calculate your
          budget, import bank transactions you authorize, support shared
          expenses, generate requested category suggestions, and send daily
          review emails when you enable them. We also use service records to
          investigate errors, prevent misuse, and keep the service working.
        </p>
      </section>
      <section>
        <h2>Services that process information</h2>
        <p>
          Caishen uses Clerk for authentication, Neon for database storage, and
          Vercel for hosting. These providers process information needed to
          operate their part of the service. Optional features use additional
          providers when configured and used:
        </p>
        <ul>
          <li>
            Plaid handles bank connections and the financial information you
            authorize. Bank connection tokens stored by Caishen are encrypted.
          </li>
          <li>
            Resend processes your email address and daily review message when
            daily emails are enabled. Those messages include review counts and a
            link back to Caishen.
          </li>
        </ul>
        <p>
          Providers may process information in countries other than where you
          live. Their own privacy policies describe their processing practices.
          We may also disclose information when required by law or necessary to
          protect the service and its users. We do not sell your personal
          information or share it for targeted advertising.
        </p>
      </section>
      <section>
        <h2>Shared expenses</h2>
        <p>
          Shared expense and settlement records are visible to the people
          participating in that shared workspace. Your personal budget is kept
          separate from the shared view. Only invite people you intend to share
          with, and avoid putting private information in shared descriptions.
        </p>
        <p>
          When you invite someone by email, the invitation holds the address you
          typed, your name, and your handwritten signature. It lasts seven days.
          We delete it as soon as it is accepted, cancelled, replaced, or
          expired.
        </p>
      </section>
      <section>
        <h2>Cookies and security</h2>
        <p>
          Caishen and Clerk use cookies or similar browser storage to maintain
          your session and protect sign-in. Blocking these may prevent the app
          from working. Caishen does not include advertising trackers.
        </p>
        <p>
          We use access controls and encrypted connections to protect
          information. No online service can guarantee complete security.
        </p>
      </section>
      <section>
        <h2>Retention, deletion, and your choices</h2>
        <p>
          We retain information needed to provide your account and budget,
          maintain shared records, troubleshoot the service, and meet legal
          obligations. Closing a sign-in account does not automatically erase
          all budget history, shared records, or backups. Contact us to request
          access, correction, an export, or deletion of your personal
          information. We may need to verify your identity and explain any
          records that must be retained. Your rights may vary depending on where
          you live.
        </p>
        <p>
          You can turn daily review emails off in settings and revoke Google
          access through your Google account. You can also revoke a bank
          connection through the controls offered by your bank or Plaid.
          Revoking a connection stops that authorization; it does not itself
          delete information already saved in Caishen.
        </p>
      </section>
      <section>
        <h2>Children, changes, and contact</h2>
        <p>
          Caishen is intended for adults and is not directed to children under
          18. If you believe a child has provided personal information, contact
          us. We will update this page when our practices change and identify
          the date above.
        </p>
        <p>
          For privacy questions or requests, email{" "}
          <a href="mailto:zeyu.weng@gmail.com">zeyu.weng@gmail.com</a>. Our{" "}
          <Link href="/terms">terms of service</Link> describe use of Caishen.
        </p>
      </section>
    </>
  );
}
