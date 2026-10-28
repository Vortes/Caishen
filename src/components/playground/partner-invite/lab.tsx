"use client";

import { Volume2, VolumeOff } from "lucide-react";
import { useState } from "react";
import { useMediaQuery } from "~/components/shared/use-media-query";
import { IconButton } from "~/components/ui/icon-button";
import { Scene } from "./scene";
import type { SkyTime } from "./sky";
import { useSound } from "./use-sound";
import styles from "./lab.module.css";

export function PartnerInviteLab({ sky }: { sky: SkyTime }) {
  // On the onboarding, the invite and its sound are over.
  const [over, setOver] = useState(false);
  const { sound, soundOn, chooseSound } = useSound(!over);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  return (
    <>
      <Scene
        sky={sky}
        reducedMotion={reducedMotion}
        sound={sound}
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
