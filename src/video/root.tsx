import "~/styles/tokens.css";

import { Composition } from "remotion";
import { OG_VIDEO, OgVideo } from "./og-video";

export function VideoRoot() {
  return (
    <Composition
      id="OgVideo"
      component={OgVideo}
      durationInFrames={OG_VIDEO.frames}
      fps={OG_VIDEO.fps}
      width={OG_VIDEO.width}
      height={OG_VIDEO.height}
    />
  );
}
