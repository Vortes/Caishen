import {
  Architects_Daughter,
  Caveat,
  Coming_Soon,
  Gloria_Hallelujah,
  Gochi_Hand,
  Indie_Flower,
  Kalam,
  Patrick_Hand,
  Schoolbell,
  Shadows_Into_Light,
  Short_Stack,
  Sue_Ellen_Francisco,
} from "next/font/google";

// Hands the line can be skywritten in: plain, even strokes, the way one
// trail of smoke is laid. Each loads only once it's picked. (The font
// loader only takes literal options, each call in its own const.)

const gloria = Gloria_Hallelujah({
  subsets: ["latin"],
  weight: "400",
  preload: false,
});
const comingSoon = Coming_Soon({
  subsets: ["latin"],
  weight: "400",
  preload: false,
});
const indieFlower = Indie_Flower({
  subsets: ["latin"],
  weight: "400",
  preload: false,
});
const architects = Architects_Daughter({
  subsets: ["latin"],
  weight: "400",
  preload: false,
});
const schoolbell = Schoolbell({
  subsets: ["latin"],
  weight: "400",
  preload: false,
});
const shortStack = Short_Stack({
  subsets: ["latin"],
  weight: "400",
  preload: false,
});
const gochi = Gochi_Hand({ subsets: ["latin"], weight: "400", preload: false });
const patrick = Patrick_Hand({
  subsets: ["latin"],
  weight: "400",
  preload: false,
});
const caveat = Caveat({ subsets: ["latin"], weight: "500", preload: false });
const kalam = Kalam({ subsets: ["latin"], weight: "400", preload: false });
const sueEllen = Sue_Ellen_Francisco({
  subsets: ["latin"],
  weight: "400",
  preload: false,
});
const shadows = Shadows_Into_Light({
  subsets: ["latin"],
  weight: "400",
  preload: false,
});

// Each face's CSS family, by the name the dials show.
export const FACES = {
  "Gloria Hallelujah": gloria.style.fontFamily,
  "Coming Soon": comingSoon.style.fontFamily,
  "Indie Flower": indieFlower.style.fontFamily,
  "Architects Daughter": architects.style.fontFamily,
  Schoolbell: schoolbell.style.fontFamily,
  "Short Stack": shortStack.style.fontFamily,
  "Gochi Hand": gochi.style.fontFamily,
  "Patrick Hand": patrick.style.fontFamily,
  Caveat: caveat.style.fontFamily,
  Kalam: kalam.style.fontFamily,
  "Sue Ellen Francisco": sueEllen.style.fontFamily,
  "Shadows Into Light": shadows.style.fontFamily,
};

export type Face = keyof typeof FACES;
