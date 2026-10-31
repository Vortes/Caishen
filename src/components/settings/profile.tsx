"use client";

import { useUser } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { TextInput } from "~/components/ui/text-input";
import {
  SettingRow,
  SettingsDivider,
  SettingsPage,
  SettingsSection,
} from "~/components/ui/settings";
import {
  ProfilePreferences,
  type UpdatePreferences,
} from "~/components/entry/profile-preferences";
import { AccountSettings } from "~/components/entry/account-settings";
import { PhotoCropDialog } from "~/components/app-shell/photo-crop-dialog";
import { useShellData } from "~/components/app-shell/shell-data";
import { UserAvatar } from "~/components/app-shell/user-avatar";
import additions from "~/components/entry/settings.module.css";

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
    <SettingsPage>
      <SettingsSection aria-label="Profile">
        <ProfilePicture />
        <SettingsDivider />
        <BudgetName onRename={onRename} />
      </SettingsSection>
      {preferences && onUpdate && (
        <ProfilePreferences value={preferences} onChange={onUpdate} />
      )}
      <AccountSettings />
    </SettingsPage>
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
    <SettingRow
      lead={<UserAvatar fallback={budgetName} size="large" />}
      label="Profile picture"
      description="Shown beside your budget’s name in the sidebar."
      error={error}
    >
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
      <PhotoCropDialog src={picked} onSave={upload} onCancel={closeCrop} />
    </SettingRow>
  );
}

// The longest name the budget keeps.
const MAX_NAME = 120;

// Saves on Enter or when the field loses focus; Escape puts the name back.
function BudgetName({
  onRename,
}: {
  onRename: (name: string) => string | null;
}) {
  const { budgetName } = useShellData();
  // Starts over from the saved name whenever it changes, including after
  // Undo.
  return (
    <BudgetNameField key={budgetName} saved={budgetName} onRename={onRename} />
  );
}

function BudgetNameField({
  saved,
  onRename,
}: {
  saved: string;
  onRename: (name: string) => string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  // Set by Escape, so the blur that follows saves nothing.
  const reverting = useRef(false);

  const commit = () => {
    if (reverting.current) {
      reverting.current = false;
      return;
    }
    const name = draft.trim();
    if (!name || name === saved) {
      setDraft(saved);
      setError(null);
      return;
    }
    // A name the budget refuses stays in the field to fix.
    if (name.length > MAX_NAME) {
      setError(`Use ${MAX_NAME} characters or fewer.`);
      return;
    }
    setError(onRename(name));
  };

  return (
    <SettingRow
      label="Budget name"
      description="Shown at the top of the sidebar. Your partner’s budget keeps its own name."
      fieldError={error}
    >
      <form
        className={additions.rowWell}
        onSubmit={(event) => {
          event.preventDefault();
          input.current?.blur();
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          reverting.current = true;
          setDraft(saved);
          setError(null);
          input.current?.blur();
        }}
      >
        <TextInput inputRef={input} value={draft} onChange={setDraft} />
      </form>
    </SettingRow>
  );
}
