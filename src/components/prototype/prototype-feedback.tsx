"use client";

import dynamic from "next/dynamic";

import "./prototype-feedback.css";

// The dynamic import sits behind a build-time constant so production
// bundles drop Agentation entirely instead of shipping an unused chunk.
const Agentation =
  process.env.NODE_ENV === "development"
    ? dynamic(() => import("agentation").then((mod) => mod.Agentation), {
        ssr: false,
      })
    : null;

export function PrototypeFeedback() {
  return Agentation ? <Agentation appName="Caishen prototype" /> : null;
}
