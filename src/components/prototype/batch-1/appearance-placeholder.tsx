"use client";

import Link from "next/link";
import { Card } from "~/components/ui/card";
import shell from "~/components/prototype/app-shell/shell.module.css";
import { settingsPages } from "~/components/prototype/app-shell/settings-pages";
import { PrototypeBar, useTheme } from "./prototype";
import { SettingsFrame } from "./settings-frame";
import batch from "./batch.module.css";

// Appearance doesn't change in this batch; it's here so the settings
// sidebar reads as it will.
export function AppearancePlaceholder() {
  const [theme, setTheme] = useTheme();
  return (
    <SettingsFrame
      page="appearance"
      theme={theme}
      controls={
        <PrototypeBar
          title="Settings › Appearance"
          theme={theme}
          onTheme={setTheme}
        />
      }
    >
      <div className={shell.settingsPage}>
        <Card>
          <p className={shell.settingHint}>
            Appearance is unchanged in this batch.{" "}
            <Link className={batch.textLink} href={settingsPages.appearance}>
              See it in the app shell
            </Link>
            .
          </p>
        </Card>
      </div>
    </SettingsFrame>
  );
}
