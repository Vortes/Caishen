"use client";

import { useEffect, useState } from "react";

export function useRowSelection(checked: readonly string[]) {
  const [previous, setPrevious] = useState(checked);
  const [entering, setEntering] = useState<readonly string[]>([]);
  const [keyboard, setKeyboard] = useState(false);
  if (previous !== checked) {
    setPrevious(checked);
    setEntering(checked.filter((id) => !previous.includes(id)));
  }
  useEffect(() => {
    if (!entering.length) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setEntering([]));
    });
    return () => cancelAnimationFrame(frame);
  }, [entering]);
  return {
    listProps: {
      "data-instant": keyboard || undefined,
      onKeyDownCapture: () => setKeyboard(true),
      onPointerDownCapture: () => setKeyboard(false),
    },
    rowProps: (id: string) => ({
      "data-checked": checked.includes(id) || undefined,
      "data-entering":
        (checked.includes(id) && entering.includes(id)) || undefined,
    }),
  };
}
