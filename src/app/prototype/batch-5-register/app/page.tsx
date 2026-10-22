import { type Metadata } from "next";
import { Batch5Prototype } from "~/components/prototype/batch-5-register/prototype";

export const metadata: Metadata = {
  title: "Register, imports, reimbursements · Caishen",
  robots: { index: false },
};

export default function Batch5PrototypePage() {
  return <Batch5Prototype />;
}
