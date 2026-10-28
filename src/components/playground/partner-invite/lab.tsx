"use client";

import { useSyncExternalStore } from "react";
import type { Config } from "./config";
import { Scene } from "./scene";
import type { SkyTime } from "./sky";

const subscribeMotion = (onChange: () => void) => {
  const query = matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

export function PartnerInviteLab({
  sky,
  config,
}: {
  sky: SkyTime;
  config: Config;
}) {
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  return <Scene config={config} sky={sky} reducedMotion={reducedMotion} />;
}
