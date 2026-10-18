import { type Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of service · Caishen",
  description: "Terms for using Caishen’s budgeting and shared expense tools.",
  alternates: { canonical: "https://curate.is/terms" },
};

export default function TermsPage() {
  return (
    <>
      <header>
        <h1>Terms of service</h1>
        <p>Last updated October 17, 2026</p>
        <p>
          These terms govern your use of Caishen at curate.is. By creating an
          account or using Caishen, you agree to these terms. If you do not
          agree, do not use the service. Questions can be sent to{" "}
          <a href="mailto:zeyu.weng@gmail.com">zeyu.weng@gmail.com</a>.
        </p>
      </header>
      <section>
        <h2>Your account</h2>
        <p>
          You must be at least 18 and legally able to enter this agreement.
          Provide accurate account information, protect your sign-in
          credentials, and tell us if you believe someone has accessed your
          account without permission. You are responsible for activity you
          authorize through your account.
        </p>
      </section>
      <section>
        <h2>What Caishen provides</h2>
        <p>
          Caishen provides tools for planning a budget, recording transactions,
          tracking shared expenses, and reviewing financial information. It is
          not a bank, lender, payment processor, financial adviser, or tax
          adviser. Recording a transfer, payment, loan, or settlement in Caishen
          does not move money or change an obligation you have to another
          person.
        </p>
        <p>
          You are responsible for your financial decisions. Check balances,
          imported transactions, calculations, and suggestions against your
          financial institution’s records before relying on them. Bank data can
          be delayed or incomplete. AI category suggestions can be wrong and
          require your review.
        </p>
      </section>
      <section>
        <h2>Your information and shared records</h2>
        <p>
          You retain your rights to information you enter. You give Caishen
          permission to store and process that information as needed to provide
          the features you use, as described in our{" "}
          <Link href="/privacy">privacy policy</Link>. Only enter information
          you have the right to use and share.
        </p>
        <p>
          Inviting someone into a shared workspace gives them access to the
          shared information shown there. A shared record does not establish
          that another person has agreed to pay it. Keep your own copies of
          records you need, including records of actual payments.
        </p>
      </section>
      <section>
        <h2>Connected services</h2>
        <p>
          Authentication, hosting, bank connections, email delivery, and AI
          features rely on third-party services. Their terms and privacy
          policies may also apply. Connecting an account authorizes the access
          presented in that connection flow. Availability depends on the
          provider, your financial institution, and the integrations enabled for
          Caishen.
        </p>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <p>
          Use Caishen lawfully. Do not access another person’s information
          without permission, submit malicious content, attempt to bypass access
          controls, interfere with the service, or use it for fraud. Do not use
          automated requests in a way that disrupts the service for others.
        </p>
      </section>
      <section>
        <h2>Availability and responsibility</h2>
        <p>
          Caishen is provided as available. Features can change, and the service
          may be interrupted or contain errors. To the extent permitted by
          applicable law, we do not warrant uninterrupted availability, complete
          accuracy, or suitability for a particular purpose. We are not
          responsible for losses caused by inaccurate information you provide,
          decisions you make based on the service, or failures outside our
          reasonable control.
        </p>
        <p>
          Nothing in these terms excludes liability that cannot legally be
          excluded or limits mandatory consumer rights available to you.
        </p>
      </section>
      <section>
        <h2>Stopping use or closing an account</h2>
        <p>
          You may stop using Caishen at any time. Contact us to request account
          closure or data deletion. Our privacy policy explains retention of
          budget history and shared records. We may restrict or suspend access
          to address misuse, a security issue, or a legal requirement. Closing
          an account does not cancel debts, settle shared expenses, or revoke
          every third-party authorization; manage those with the relevant
          provider.
        </p>
      </section>
      <section>
        <h2>Changes and questions</h2>
        <p>
          We may update these terms as Caishen changes. We will post the updated
          version here and revise the date above. If a change materially affects
          your use, we will provide notice through the service or your account
          email before it takes effect. If you do not agree with revised terms,
          stop using Caishen.
        </p>
        <p>
          Contact <a href="mailto:zeyu.weng@gmail.com">zeyu.weng@gmail.com</a>{" "}
          with questions about these terms or the service.
        </p>
      </section>
    </>
  );
}
