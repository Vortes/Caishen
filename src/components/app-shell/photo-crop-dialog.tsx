"use client";

import { ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Button } from "~/components/ui/button";
import { Dialog } from "~/components/ui/dialog";
import { compressProfileImage } from "./profile-image";
import styles from "./photo-crop.module.css";

const MAX_ZOOM = 4;

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

  const cancel = () => {
    reset();
    onCancel();
  };

  const save = async () => {
    if (!src || !area) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(await compressProfileImage(src, area));
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
    <Dialog
      label="Crop your photo"
      open={src !== null}
      onOpenChange={(open) => {
        if (!open && !saving) cancel();
      }}
      // Focus starts on the dialog itself, so no control opens wearing a
      // focus ring; Tab moves to the photo, then the slider.
      autoFocus={false}
    >
      <div className={styles.header}>
        <h2 className={styles.title}>Crop your photo</h2>
        <p className={styles.description}>
          Drag to reposition. Scroll, pinch, or use the slider to zoom.
        </p>
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
        <Button disabled={saving} onClick={cancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!area || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Dialog>
  );
}
