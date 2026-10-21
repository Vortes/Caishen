"use client";

import { ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Button } from "~/components/ui/button";
import { usePortalContainer } from "~/components/ui/tooltip";
import styles from "./photo-crop.module.css";

// Large enough to stay sharp on a high-density screen at any size the app
// shows an avatar; small enough to upload quickly.
const OUTPUT_SIZE = 512;
const MAX_ZOOM = 4;

async function crop(src: string, area: Area) {
  const image = new Image();
  image.src = src;
  await image.decode();
  const size = Math.min(OUTPUT_SIZE, area.width);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas
    .getContext("2d")!
    .drawImage(
      image,
      area.x,
      area.y,
      area.width,
      area.height,
      0,
      0,
      size,
      size,
    );
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("The crop couldn’t be made.")),
      "image/png",
    ),
  );
}

// Frames a newly picked photo before it uploads. Nothing is saved until
// Save; Cancel, Escape, or clicking outside drops the photo.
export function PhotoCropDialog({
  src,
  onSave,
  onCancel,
}: {
  // An object URL for the picked file; the dialog is open while it's set.
  src: string | null;
  // Uploads the crop. Rejects with a message to show in the dialog.
  onSave: (photo: Blob) => Promise<void>;
  onCancel: () => void;
}) {
  const container = usePortalContainer();
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPosition({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
    setError(null);
  };

  const save = async () => {
    if (!src || !area) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(await crop(src, area));
      reset();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your photo couldn’t be saved. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root
      open={src !== null}
      onOpenChange={(open) => {
        if (open || saving) return;
        reset();
        onCancel();
      }}
    >
      <Dialog.Portal container={container}>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.dialog}
          // Focus starts on the dialog itself, so no control opens wearing a
          // focus ring; Tab moves to the photo, then the slider.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
        >
          <div className={styles.header}>
            <Dialog.Title className={styles.title}>
              Crop your photo
            </Dialog.Title>
            <Dialog.Description className={styles.description}>
              Drag to reposition. Scroll, pinch, or use the slider to zoom.
            </Dialog.Description>
          </div>
          <div className={styles.stage}>
            {src && (
              <Cropper
                image={src}
                crop={position}
                zoom={zoom}
                maxZoom={MAX_ZOOM}
                aspect={1}
                cropShape="round"
                showGrid={false}
                objectFit="cover"
                onCropChange={setPosition}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setArea(pixels)}
                classes={{ cropAreaClassName: styles.cropArea }}
                cropperProps={{ "aria-label": "Photo crop area" }}
              />
            )}
          </div>
          <label className={styles.zoom}>
            <ZoomOutIcon size={14} aria-hidden />
            <input
              type="range"
              aria-label="Zoom"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <ZoomInIcon size={14} aria-hidden />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.footer}>
            <Dialog.Close asChild>
              <Button disabled={saving}>Cancel</Button>
            </Dialog.Close>
            <Button
              variant="primary"
              disabled={!area || saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
