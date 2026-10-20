import { type Metadata } from "next";
import { SkeletonPreview } from "~/components/prototype/app-shell/skeleton-preview";

export const metadata: Metadata = {
  title: "Loading skeleton prototype · Caishen",
  robots: { index: false },
};

export default function LoadingSkeletonPrototypePage() {
  return <SkeletonPreview />;
}
