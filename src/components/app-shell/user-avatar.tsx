"use client";

import { useUser } from "@clerk/nextjs";
import { profileImageUrl } from "./profile-image";
import styles from "./shell.module.css";

// The signed-in person's photo, or the first letter of their name until they
// add one. Large is the profile settings preview.
function Photo({ src, pixels }: { src: string; pixels: number }) {
  return (
    // Clerk's image host isn't configured for next/image.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={profileImageUrl(src, pixels)}
      srcSet={[1, 2, 3]
        .map(
          (density) => `${profileImageUrl(src, pixels * density)} ${density}x`,
        )
        .join(", ")}
      width={pixels}
      height={pixels}
      decoding="async"
      alt=""
    />
  );
}

export function UserAvatar({
  fallback,
  size = "badge",
}: {
  // Used while the account loads, and when it has no name.
  fallback: string;
  size?: "badge" | "large";
}) {
  const { user } = useUser();
  const name = user?.fullName ?? user?.primaryEmailAddress?.emailAddress;
  const initial = (name ?? fallback).trim().charAt(0).toUpperCase() || "C";
  const pixels = size === "large" ? 48 : 20;
  return (
    <span className={styles.avatar} data-size={size} aria-hidden>
      {user?.hasImage ? <Photo src={user.imageUrl} pixels={pixels} /> : initial}
    </span>
  );
}

// Someone else in the budget, like the partner: their photo, or their
// initial in a color that tells them apart from yours.
export function PersonAvatar({
  name,
  imageUrl,
}: {
  name: string;
  imageUrl?: string | null;
}) {
  return (
    <span className={styles.avatar} data-person="other" aria-hidden>
      {imageUrl ? (
        <Photo src={imageUrl} pixels={20} />
      ) : (
        name.trim().charAt(0).toUpperCase() || "?"
      )}
    </span>
  );
}
