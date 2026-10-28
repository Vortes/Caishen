import { useEffect, useState } from "react";

// An element's size, once it has one.
export function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      if (width && height) setSize({ width, height });
    });
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
