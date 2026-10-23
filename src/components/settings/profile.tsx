"use client";

import { useUser } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  ProfilePreferences,
  type UpdatePreferences,
} from "~/components/entry/profile-preferences";
import { AccountSettings } from "~/components/entry/account-settings";
import { PhotoCropDialog } from "~/components/app-shell/photo-crop-dialog";
import { useShellData } from "~/components/app-shell/shell-data";
import { UserAvatar } from "~/components/app-shell/user-avatar";
import styles from "~/components/app-shell/shell.module.css";

// Clerk accepts these formats for a profile image.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function errorMessage(error: unknown) {
  if (isClerkAPIResponseError(error)) {
    const [first] = error.errors;
    if (first) return first.longMessage ?? first.message;
  }
  return "Your photo couldn’t be saved. Try again.";
}

// What the profile menu shows: your photo and the budget's name. Both save
// the moment they change, like every other setting.
export function ProfileSettings({
  onRename,
  onUpdate,
}: {
  // Returns why the rename can't run yet, or null once it's sent.
  onRename: (name: string) => string | null;
  onUpdate?: UpdatePreferences;
}) {
  const { preferences } = useShellData();
  return (
    <div className={styles.settingsPage}>
      <section className={styles.settingsSection} aria-label="Profile">
        <Card>
          <ProfilePicture />
          <div className={styles.settingDivider} />
          <BudgetName onRename={onRename} />
        </Card>
      </section>
      {preferences && onUpdate && (
        <ProfilePreferences value={preferences} onChange={onUpdate} />
      )}
      <AccountSettings />
    </div>
  );
}

function ProfilePicture() {
  const { user } = useUser();
  const { budgetName } = useShellData();
  const input = useRef<HTMLInputElement>(null);
  // The picked photo, while it's being cropped.
  const [picked, setPicked] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) {
      setError("Choose a PNG, JPEG, GIF, or WebP image.");
      return;
    }
    setError(null);
    setPicked(URL.createObjectURL(file));
  };

  const closeCrop = () => {
    if (picked) URL.revokeObjectURL(picked);
    setPicked(null);
  };

  // Errors surface in the crop dialog, which stays open to try again.
  const upload = async (photo: Blob) => {
    if (!user) return;
    try {
      await user.setProfileImage({ file: photo });
      await user.reload();
    } catch (caught) {
      throw new Error(errorMessage(caught));
    }
    closeCrop();
  };

  const remove = async () => {
    if (!user) return;
    setError(null);
    setRemoving(true);
    try {
      await user.setProfileImage({ file: null });
      await user.reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className={styles.settingRow}>
      <div className={styles.settingLead}>
        <UserAvatar fallback={budgetName} size="large" />
        <div className={styles.settingText}>
          <span className={styles.settingLabel}>Profile picture</span>
          <span className={styles.settingHint}>
            Shown beside your budget’s name in the sidebar.
          </span>
          {error && (
            <span className={styles.settingError} role="alert">
              {error}
            </span>
          )}
        </div>
      </div>
      <div className={styles.settingActions}>
        {user?.hasImage && (
          <Button
            variant="quiet"
            disabled={removing}
            onClick={() => void remove()}
          >
            {removing ? "Removing…" : "Remove"}
          </Button>
        )}
        <Button
          disabled={!user || removing}
          onClick={() => input.current?.click()}
        >
          {user?.hasImage ? "Change photo" : "Upload photo"}
        </Button>
        <input
          ref={input}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Clears the pick so choosing the same file again still fires.
            event.target.value = "";
            if (file) pick(file);
          }}
        />
      </div>
      <PhotoCropDialog src={picked} onSave={upload} onCancel={closeCrop} />
    </div>
  );
}

// Saves on Enter or when the field loses focus; Escape puts the name back.
function BudgetName({
  onRename,
}: {
  onRename: (name: string) => string | null;
}) {
  const { budgetName } = useShellData();
  const [error, setError] = useState<string | null>(null);

  const commit = (field: HTMLInputElement) => {
    const name = field.value.trim();
    if (!name || name === budgetName) {
      field.value = budgetName;
      return;
    }
    const blocked = onRename(name);
    setError(blocked);
    if (blocked) field.value = budgetName;
  };

  return (
    <div className={styles.settingRow}>
      <div className={styles.settingText}>
        <label className={styles.settingLabel} htmlFor="budget-name">
          Budget name
        </label>
        <span className={styles.settingHint}>
          Shown at the top of the sidebar. Your partner’s budget keeps its own
          name.
        </span>
        {error && (
          <span
            id="budget-name-error"
            className={styles.settingError}
            role="alert"
          >
            {error}
          </span>
        )}
      </div>
      <input
        // Starts over from the saved name whenever it changes, including
        // after Undo.
        key={budgetName}
        id="budget-name"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "budget-name-error" : undefined}
        className={styles.settingInput}
        defaultValue={budgetName}
        maxLength={120}
        autoComplete="off"
        spellCheck={false}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.value = budgetName;
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
