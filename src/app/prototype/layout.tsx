import { PrototypeFeedback } from "~/components/prototype/prototype-feedback";

export default function PrototypeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <PrototypeFeedback />
    </>
  );
}
