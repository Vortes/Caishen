"use client";

import { useUser } from "@clerk/nextjs";
import { profileImageUrl } from "./profile-image";
import styles from "./shell.module.css";

// The signed-in person's photo, or the first letter of their name until they
// add one. Large is the profile settings preview.
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
      {user?.hasImage ? (
        // Clerk's image host isn't configured for next/image.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profileImageUrl(user.imageUrl, pixels)}
          srcSet={[1, 2, 3]
            .map(
              (density) =>
                `${profileImageUrl(user.imageUrl, pixels * density)} ${density}x`,
            )
            .join(", ")}
          width={pixels}
          height={pixels}
          decoding="async"
          alt=""
        />
      ) : (
        initial
      )}
    </span>
  );
}
