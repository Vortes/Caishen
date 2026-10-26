"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type InputMethod = "keyboard" | "pointer";
const InputMethodContext = createContext<{ current: InputMethod } | null>(null);

export function PopoverMotionProvider({ children }: { children: ReactNode }) {
  const input = useRef<InputMethod>("keyboard");
  useEffect(() => {
    const pointer = () => {
      input.current = "pointer";
    };
    const keyboard = () => {
      input.current = "keyboard";
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("pointermove", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("pointermove", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
    };
  }, []);
  return (
    <InputMethodContext.Provider value={input}>
      {children}
    </InputMethodContext.Provider>
  );
}

export function usePopoverMotion(
  open: boolean,
  frequency: "frequent" | "occasional" = "frequent",
) {
  const input = useContext(InputMethodContext);
  if (!input)
    throw new Error("usePopoverMotion needs a PopoverMotionProvider.");
  const [opening, setOpening] = useState(() => ({
    open,
    instant: input.current === "keyboard",
  }));
  // Capture the opening input, so typing inside a form does not cancel its
  // entrance or change its exit. A reopening during exit captures it again.
  if (opening.open !== open) {
    setOpening({
      open,
      instant: open ? input.current === "keyboard" : opening.instant,
    });
  }
  return {
    "data-motion": frequency,
    "data-instant": frequency === "frequent" || opening.instant || undefined,
  };
}
