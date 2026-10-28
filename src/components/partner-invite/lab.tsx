"use client";

import { Volume2, VolumeOff } from "lucide-react";
import { useState } from "react";
import { GuidedOnboarding } from "~/components/entry/guided-onboarding";
import { useMediaQuery } from "~/components/shared/use-media-query";
import { IconButton } from "~/components/ui/icon-button";
import { config } from "./config";
import { signature } from "./ink";
import { INVITE, type Invitation } from "./print";
import { Scene } from "./scene";
import type { SkyTime } from "./sky";
import { useSound } from "./use-sound";
import styles from "./lab.module.css";

// Stand-in invitation for the playground.
const invitation: Invitation = {
  from: "Jordan Lee",
  signature: signature(config.seed, "partner", INVITE.signed),
  washi: "indigo",
};

export function PartnerInviteLab({ sky }: { sky: SkyTime }) {
  // On the onboarding, the invite and its sound are over.
  const [over, setOver] = useState(false);
  const { sound, soundOn, chooseSound } = useSound(!over);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  return (
    <>
      <Scene
        invitation={invitation}
        sky={sky}
        reducedMotion={reducedMotion}
        sound={sound}
        next={
          <GuidedOnboarding
            onCreate={async () => undefined}
            onCategories={async () => undefined}
            accounts={null}
            readyToAssign={0}
            onComplete={() => undefined}
          />
        }
        onSettled={() => setOver(true)}
      />
      {!over && (
        <div className={styles.mute}>
          <IconButton
            variant="secondary"
            label={soundOn ? "Mute" : "Unmute"}
            pressed={!soundOn}
            onClick={() => chooseSound(!soundOn)}
          >
            {soundOn ? <Volume2 /> : <VolumeOff />}
          </IconButton>
        </div>
      )}
    </>
  );
}
