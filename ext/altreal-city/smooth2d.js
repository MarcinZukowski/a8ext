// Alternate Reality: The City - the game's own picture smoothed (the Atari
// view, the monsters in it) with the shared smoother over the picture's
// mode-E pixels, two hi-res pixels wide and one line tall. See ../smooth2d.js.

import { createSmoother } from "../smooth2d.js";

const smoother = createSmoother(2, 1);
export const capture = (region) => smoother.capture(region);
export const draw = (dst, src) => smoother.draw(dst, src);
