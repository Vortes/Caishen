import { type Metadata } from "next";
import { notFound } from "next/navigation";
import { EntryPage } from "~/components/entry/entry-page";

export const metadata: Metadata = {
  title: "Playground · Caishen",
  robots: { index: false },
};

// A scratch space for UI concepts, served only by the dev server. Pages here
// hardcode their data and never call the API.
export default function PlaygroundLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  return <EntryPage>{children}</EntryPage>;
}
