import "~/styles/globals.css";

import { ClerkProvider } from "@clerk/nextjs";
import { type Metadata } from "next";
import { Geist } from "next/font/google";

import { TRPCReactProvider } from "~/trpc/react";

const title = "Caishen · A little clarity, every day";
const description =
  "Your personal budget, shared expenses, and daily money review, in one calm place.";

// Link previews need absolute URLs; metadataBase covers images but not videos.
// The video is rendered by `npm run video:render` from src/video, and apps that
// can't play it show the poster.
const siteUrl = new URL("https://curate.is");

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title,
  description,
  openGraph: {
    type: "website",
    siteName: "Caishen",
    title,
    description,
    images: [{ url: "/og/caishen.png", width: 1200, height: 630 }],
    videos: [
      {
        url: new URL("/og/caishen.mp4", siteUrl),
        type: "video/mp4",
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: { card: "summary_large_image", title, description },
};

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geist.variable}>
      <body>
        <ClerkProvider>
          <TRPCReactProvider>{children}</TRPCReactProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
