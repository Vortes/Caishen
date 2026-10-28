import { Indie_Flower } from "next/font/google";

// The hand the line is skywritten in: plain, even strokes, the way one
// trail of smoke is laid. Preloaded: the line can't form until it's here,
// and it's the first thing on screen.
const indieFlower = Indie_Flower({ subsets: ["latin"], weight: "400" });

export const SKY_HAND = indieFlower.style.fontFamily;
