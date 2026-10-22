"use client";

import dynamic from "next/dynamic";

// The prototype reads its scenario from the address on first render, so it
// renders only in the browser.
export const LoansPrototypeClient = dynamic(
  () => import("./loans-prototype").then((module) => module.LoansPrototype),
  { ssr: false },
);
