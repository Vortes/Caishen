import type { Area } from "react-easy-crop";

const MAX_SIZE = 384;
const MIN_SIZE = 64;
const MAX_BYTES = 100 * 1024;
const QUALITY = 0.9;

export async function compressProfileImage(src: string, area: Area) {
  const image = new Image();
  image.src = src;
  await image.decode();

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your photo couldn’t be processed. Try again.");

  let size = Math.max(
    1,
    Math.floor(Math.min(MAX_SIZE, area.width, area.height)),
  );
  for (;;) {
    canvas.width = size;
    canvas.height = size;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
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
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(
                new Error("Your photo couldn’t be compressed. Try again."),
              ),
        "image/webp",
        QUALITY,
      ),
    );
    if (blob.size <= MAX_BYTES) return blob;
    if (size <= MIN_SIZE) {
      throw new Error("Your photo is too large. Choose a different image.");
    }
    size = Math.max(MIN_SIZE, Math.floor(size / 2));
  }
}

export function profileImageUrl(src: string, size: number) {
  const url = new URL(src);
  url.searchParams.set("width", String(size));
  url.searchParams.set("height", String(size));
  url.searchParams.set("fit", "scale-down");
  url.searchParams.set("quality", "90");
  return url.toString();
}
