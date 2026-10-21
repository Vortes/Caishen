import { render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useUser } from "@clerk/nextjs";
import {
  compressProfileImage,
  profileImageUrl,
} from "~/components/prototype/app-shell/profile-image";
import { UserAvatar } from "~/components/prototype/app-shell/user-avatar";

vi.mock("@clerk/nextjs", () => ({
  useUser: vi.fn(() => ({ isLoaded: true, user: null })),
}));

const drawImage = vi.fn();
const decode = vi.fn<() => Promise<void>>();
const area = { x: 100, y: 200, width: 1200, height: 1200 };
const toBlob = vi.fn<HTMLCanvasElement["toBlob"]>();

beforeEach(() => {
  drawImage.mockReset();
  decode.mockReset().mockResolvedValue(undefined);
  toBlob.mockReset().mockImplementation((callback) => {
    callback(new Blob(["compressed"], { type: "image/webp" }));
  });
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode = decode;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(toBlob);
});

afterEach(() => vi.restoreAllMocks());

test("compresses the selected crop to WebP at no more than 384px", async () => {
  const blob = await compressProfileImage("blob:photo", area);
  expect(blob.type).toBe("image/webp");
  expect(blob.size).toBeLessThanOrEqual(100 * 1024);
  expect(drawImage).toHaveBeenCalledWith(
    expect.anything(),
    100,
    200,
    1200,
    1200,
    0,
    0,
    384,
    384,
  );
  expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.9);
});

test("does not upscale a small crop", async () => {
  await compressProfileImage("blob:photo", { ...area, width: 40, height: 40 });
  expect(drawImage).toHaveBeenCalledWith(
    expect.anything(),
    100,
    200,
    40,
    40,
    0,
    0,
    40,
    40,
  );
});

test("reduces dimensions when encoding exceeds the byte budget, including PNG fallback", async () => {
  toBlob.mockImplementationOnce((callback) => {
    callback(new Blob([new Uint8Array(110 * 1024)], { type: "image/png" }));
  });
  toBlob.mockImplementationOnce((callback) => {
    callback(new Blob(["png fallback"], { type: "image/png" }));
  });
  const blob = await compressProfileImage("blob:photo", area);
  expect(blob.type).toBe("image/png");
  expect(drawImage).toHaveBeenLastCalledWith(
    expect.anything(),
    100,
    200,
    1200,
    1200,
    0,
    0,
    192,
    192,
  );
});

test("stops retrying oversized output at 64px", async () => {
  toBlob.mockImplementation((callback) => {
    callback(new Blob([new Uint8Array(110 * 1024)]));
  });
  await expect(compressProfileImage("blob:photo", area)).rejects.toThrow(
    "too large",
  );
  expect(toBlob).toHaveBeenCalledTimes(4);
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
  ["badge", 20],
  ["large", 48],
] as const)(
  "renders %s avatars with density-aware image sources",
  (size, pixels) => {
    vi.mocked(useUser).mockReturnValueOnce({
      user: { hasImage: true, imageUrl: "https://img.clerk.com/photo" },
    } as ReturnType<typeof useUser>);
    const { container } = render(<UserAvatar fallback="Budget" size={size} />);
    const image = container.querySelector("img")!;
    expect(image.getAttribute("width")).toBe(String(pixels));
    expect(image.getAttribute("height")).toBe(String(pixels));
    expect(image.getAttribute("src")).toBe(
      profileImageUrl("https://img.clerk.com/photo", pixels),
    );
    expect(image.getAttribute("srcset")).toBe(
      [1, 2, 3]
        .map(
          (density) =>
            `${profileImageUrl("https://img.clerk.com/photo", pixels * density)} ${density}x`,
        )
        .join(", "),
    );
  },
);
