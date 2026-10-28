// Prototype: cloud lettering faces. Throwaway; deleted once one is picked.
import { Fraunces, Fredoka, Pacifico } from "next/font/google";

const fredoka = Fredoka({ subsets: ["latin"], weight: "700" });
const pacifico = Pacifico({ subsets: ["latin"], weight: "400" });
const fraunces = Fraunces({ subsets: ["latin"], weight: "900" });

// Family null keeps the stage's own face (Geist), as shipped today.
export const variants = [
  { name: "Current", family: null, weight: "900", tracking: 0.16 },
  {
    name: "Bubbly",
    family: fredoka.style.fontFamily,
    weight: "700",
    tracking: 0.1,
  },
  // Joined script: any tracking would break the joins.
  {
    name: "Skywritten",
    family: pacifico.style.fontFamily,
    weight: "400",
    tracking: 0,
  },
  {
    name: "Soft serif",
    family: fraunces.style.fontFamily,
    weight: "900",
    tracking: 0.06,
  },
];
