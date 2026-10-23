import { render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useUser } from "@clerk/nextjs";
import {
  compressProfileImage,
  profileImageUrl,
} from "~/components/app-shell/profile-image";
import { UserAvatar } from "~/components/app-shell/user-avatar";

vi.mock("@clerk/nextjs", () => ({
  useUser: vi.fn(() => ({ isLoaded: true, user: null })),
}));

type EncodedCrop = {
  width: number;
  height: number;
  crop: number[];
  paintedBounds: number[];
};
const crops = new WeakMap<HTMLCanvasElement, number[]>();
function encode(canvas: HTMLCanvasElement, type = "image/webp") {
  return new Blob(
    [
      JSON.stringify({
        width: canvas.width,
        height: canvas.height,
        crop: crops.get(canvas)?.slice(0, 4),
        paintedBounds: crops.get(canvas)?.slice(4, 8),
      }),
    ],
    { type },
  );
}
async function readImage(blob: Blob): Promise<EncodedCrop> {
  const reader = new FileReader();
  const text = await new Promise<string>((resolve, reject) => {
    reader.onload = () => {
      if (typeof reader.result !== "string")
        return reject(new Error("Expected encoded image text"));
      resolve(reader.result);
    };
    reader.onerror = () => reject(reader.error!);
    reader.readAsText(blob);
  });
  return JSON.parse(text) as EncodedCrop;
}
const decode = vi.fn<() => Promise<void>>();
const area = { x: 100, y: 200, width: 1200, height: 1200 };
const toBlob = vi.fn<HTMLCanvasElement["toBlob"]>();

beforeEach(() => {
  decode.mockReset().mockResolvedValue(undefined);
  toBlob.mockReset().mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    type,
  ) {
    callback(encode(this, type));
  });
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode = decode;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return {
        drawImage: (_image: unknown, ...coordinates: number[]) => {
          crops.set(this, coordinates);
        },
      } as unknown as CanvasRenderingContext2D;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(toBlob);
});

afterEach(() => vi.restoreAllMocks());

test("compresses the selected crop to WebP at no more than 384px", async () => {
  const blob = await compressProfileImage("blob:photo", area);
  expect(blob.type).toBe("image/webp");
  expect(blob.size).toBeLessThanOrEqual(100 * 1024);
  const output = await readImage(blob);
  expect(output.crop).toEqual([100, 200, 1200, 1200]);
  expect(output.width).toBeGreaterThan(0);
  expect(output.width).toBeLessThanOrEqual(384);
  expect(output.height).toBe(output.width);
  expect(output.paintedBounds).toEqual([0, 0, output.width, output.height]);
});

test("does not upscale a small crop", async () => {
  const output = await readImage(
    await compressProfileImage("blob:photo", {
      ...area,
      width: 40,
      height: 40,
    }),
  );
  expect(output.crop).toEqual([100, 200, 40, 40]);
  expect(output.width).toBeLessThanOrEqual(40);
  expect(output.height).toBe(output.width);
  expect(output.paintedBounds).toEqual([0, 0, output.width, output.height]);
});

test("reduces dimensions when encoding exceeds the byte budget, including PNG fallback", async () => {
  toBlob.mockImplementation(function (this: HTMLCanvasElement, callback) {
    callback(
      this.width > 240
        ? new Blob([new Uint8Array(110 * 1024)], { type: "image/png" })
        : encode(this, "image/png"),
    );
  });
  const blob = await compressProfileImage("blob:photo", area);
  expect(blob.type).toBe("image/png");
  expect(blob.size).toBeLessThanOrEqual(100 * 1024);
  const output = await readImage(blob);
  expect(output.crop).toEqual([100, 200, 1200, 1200]);
  expect(output.width).toBeGreaterThan(0);
  expect(output.width).toBeLessThanOrEqual(384);
  expect(output.height).toBe(output.width);
  expect(output.paintedBounds).toEqual([0, 0, output.width, output.height]);
});

test("rejects an image that cannot fit within the byte limit", async () => {
  toBlob.mockImplementation((callback) => {
    callback(new Blob([new Uint8Array(110 * 1024)]));
  });
  await expect(compressProfileImage("blob:photo", area)).rejects.toThrow(
    "too large",
  );
});

test("reports decoding and encoding failures without uploading", async () => {
  decode.mockRejectedValueOnce(new Error("Invalid image"));
  await expect(compressProfileImage("blob:photo", area)).rejects.toThrow(
    "Invalid image",
  );
  expect(toBlob).not.toHaveBeenCalled();
  toBlob.mockImplementationOnce((callback) => callback(null));
  await expect(compressProfileImage("blob:photo", area)).rejects.toThrow(
    "compressed",
  );
});

test("reports an unavailable canvas context", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  await expect(compressProfileImage("blob:photo", area)).rejects.toThrow(
    "processed",
  );
});

test("resizes delivery images without recropping the user's selected framing", () => {
  const url = new URL(
    profileImageUrl(
      "https://img.clerk.com/photo?token=abc&width=512&fit=crop",
      60,
    ),
  );
  expect(Object.fromEntries(url.searchParams)).toEqual({
    token: "abc",
    width: "60",
    height: "60",
    fit: "scale-down",
    quality: "90",
  });
});

test.each([
  {
    size: "badge",
    pixels: 20,
    src: "https://img.clerk.com/photo?width=20&height=20&fit=scale-down&quality=90",
    srcset:
      "https://img.clerk.com/photo?width=20&height=20&fit=scale-down&quality=90 1x, https://img.clerk.com/photo?width=40&height=40&fit=scale-down&quality=90 2x, https://img.clerk.com/photo?width=60&height=60&fit=scale-down&quality=90 3x",
  },
  {
    size: "large",
    pixels: 48,
    src: "https://img.clerk.com/photo?width=48&height=48&fit=scale-down&quality=90",
    srcset:
      "https://img.clerk.com/photo?width=48&height=48&fit=scale-down&quality=90 1x, https://img.clerk.com/photo?width=96&height=96&fit=scale-down&quality=90 2x, https://img.clerk.com/photo?width=144&height=144&fit=scale-down&quality=90 3x",
  },
] as const)(
  "renders $size avatars with density-aware image sources",
  ({ size, pixels, src, srcset }) => {
    vi.mocked(useUser).mockReturnValueOnce({
      user: { hasImage: true, imageUrl: "https://img.clerk.com/photo" },
    } as ReturnType<typeof useUser>);
    const { container } = render(<UserAvatar fallback="Budget" size={size} />);
    const image = container.querySelector("img")!;
    expect(image.getAttribute("width")).toBe(String(pixels));
    expect(image.getAttribute("height")).toBe(String(pixels));
    expect(image.getAttribute("src")).toBe(src);
    expect(image.getAttribute("srcset")).toBe(srcset);
  },
);
