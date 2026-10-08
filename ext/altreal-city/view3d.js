// Alternate Reality: The City - the streets drawn with OpenGL instead of the
// game's scaled pictures: the buildings as walls on the map's cells with the
// game's own facade pictures (stone, the door with the building's sign, the
// colonnade), the sky in the game's colours line by line, the skyline on the
// horizon, the ground as the game's reflection, with steps and turns
// interpolated between the game's positions. The game's projection is kept
// (altreal-city.md, "The renderer"): a wall a cell away is half the picture
// wide, two cells a quarter, each cell halving, linear in between.
//
// The map is read from a copy taken while the streets are shown: an
// encounter or a building loads its own code and data over $0800-$27FF.

import { scale2x } from "../common.js";

const mem = a8.mem;

const WALLS = 0x0800, KINDS = 0x1800, MAP_SIZE = 64;
const CELL_X = 0x8924, CELL_Y = 0x8925, FACING = 0x892B, POSITION = 0x892A;
const ENCOUNTER = 0x7E;                 // $FF during an encounter
// 1 while it rains ($593F, by the month's odds): the sky and the ground
// take random dark colours line by line each frame ($3452), no skyline is
// copied in ($7131), and players 2-3 and missile 3 fall as the drops, in
// front of the picture ($5692 moves them a line down a frame, $BE8B)
const RAIN = 0x891D;
const DISPLAY_LIST = 0x2CB5;
const WEATHER = 0x7B, WEATHER2 = 0xBF82; // ($7B | $BF82) >= 3: no skyline, the sky alone ($7128)
// The game's pictures, 72 x 36 at 2 bits a pixel, 18 bytes a row
const PIC_W = 72, PIC_H = 36, PIC_STRIDE = 18, PIC_BYTES = PIC_H * PIC_STRIDE;
const PICTURE_COLONNADE = 0xB2D9, PICTURE_WALL = 0xB7E9, PICTURE_DOOR = 0xBA71;
// The horizon's backdrop, one picture a facing (chosen after a turn,
// $66C0-$6780: north $ADC2, east $B04A, south $AB3A, west $B55A), whose
// rows the game copies from bytes 7-24 of each 18-byte row ($7150), so the
// picture starts 7 bytes in (*measured*: the buffer's rows against both
// offsets, tc2.a8s); here the four side by side make a panorama the view
// turns through
const BACKDROP_OFFSET = 7;
const PICTURE_BACKDROPS = [0xADC2, 0xB04A, 0xAB3A, 0xB55A].map((a) => a + BACKDROP_OFFSET);
const SIGNS = 0x9D36, SIGN_SIZE = 35, SIGN_ROWS = 5, SIGN_BYTES = 7, SIGN_ROW = 2, SIGN_COLUMN = 5;   // the sign patched into the door picture ($636D: rows 2-6 from byte 5, $BA9A on)
const KIND_COLONNADE = 0xB3;
const CELL = 36, EYE_HEIGHT = 18, WALL_HEIGHT = 36;
// What lies nearer than this along the view is cut off. The game's law has
// no singularity at the eye (the scale is 2 there), so it can be small: a
// wall the player stands against, half a unit ahead, must still be drawn
const NEAR = 0.25;
const VIEW_RANGE = 8;                   // cells drawn around the player: the game's law leaves a cell at 6 under 2 pixels
const TURN_FRAMES = 12;

// The screen (336 x 240, y down): the picture is 144 x 72 at (96, 72), the
// game's 72 x 72 pixels shown 2:1 (*measured*); the stats and the location
// line in the 72 lines above it, the food and water, the messages and an
// encounter's menu in the rows below (down to line 236)
const SCREEN_W = 336, SCREEN_H = 240;
export const PICTURE = [96, 72, 240, 144];
const TOP_TEXT = [8, 0, 328, 72], TEXT_X0 = 8, TEXT_X1 = 328;
// The wide layout: the view over the full width, still 2:1, in the middle;
// the texts shrunk into the bands above and below, the bottom band growing
// upward over the view when the text in use needs more than its 36 lines
const WIDE_Y0 = (SCREEN_H - SCREEN_W / 2) / 2, WIDE_Y1 = SCREEN_H - WIDE_Y0;   // 36..204
const TEXT_SCALE = WIDE_Y0 / (TOP_TEXT[3] - TOP_TEXT[1]);
export const WIDE_VIEW = [0, WIDE_Y0, SCREEN_W, WIDE_Y1];
const PIC = 72, PIC_CENTRE = 36;
const Z_2D = -2;   // where the emulator draws its own screen
const gx = (px) => px / (SCREEN_W / 2) - 1, gy = (py) => 1 - py / (SCREEN_H / 2);

/* ------------------------------ the map's copy ------------------------------ */

const walls = new Uint8Array(MAP_SIZE * MAP_SIZE), kinds = new Uint8Array(MAP_SIZE * MAP_SIZE);
let mapTaken = false;

// The city's display list goes on, after the text rows, at $2CC6 or $2D5F
// (the two picture buffers' lists); a building's screen keeps the head and
// jumps elsewhere (*measured*: tc6.a8s, the Best Armorers, to $2E16)
const DL_JUMP = 0x2CC4, DL_PICTURES = [0x2CC6, 0x2D5F];
const cityScreen = () => a8.antic.dlist === DISPLAY_LIST && DL_PICTURES.includes(mem[DL_JUMP] | mem[DL_JUMP + 1] << 8);
const raining = () => mem[RAIN] === 1;
export const onStreets = () => cityScreen() && mem[ENCOUNTER] === 0;

function takeMap() {
	walls.set(mem.subarray(WALLS, WALLS + MAP_SIZE * MAP_SIZE));
	kinds.set(mem.subarray(KINDS, KINDS + MAP_SIZE * MAP_SIZE));
	mapTaken = true;
}

// The four sides of a cell, north east south west: 0 open, 1 wall, 3 a door
function cellWalls(x, y) {
	if (x < 0 || x >= MAP_SIZE || y < 0 || y >= MAP_SIZE) return [0, 0, 0, 0];
	const b = walls[y * MAP_SIZE + x];
	return [b & 3, (b >> 2) & 3, (b >> 4) & 3, (b >> 6) & 3];
}
const cellKind = (x, y) => x < 0 || x >= MAP_SIZE || y < 0 || y >= MAP_SIZE ? 0 : kinds[y * MAP_SIZE + x];

// Is the city's screen on (its display list, with the picture's lines)?
export function pictureDisplayed() {
	return cityScreen() && frameBuffer() >= 0;
}

// A building's screen: the display list's head with another continuation,
// and a picture of mode-E lines across the whole width, 320 x 72 at
// (8, 72) (*measured*: tc6.a8s, the Best Armorers)
export const BUILDING_PICTURE = [8, 72, 328, 144];
export function buildingPictureDisplayed() {
	return a8.antic.dlist === DISPLAY_LIST && !cityScreen() && mem[ENCOUNTER] === 0 && frameBuffer() >= 0;
}

// The text rows below the picture that are in use: [first line, last line + 1]
// from the display list (mode-2 rows after the picture's lines, up to the
// last one with a character in it), or null
function bottomTextExtent() {
	const heights = [0, 0, 8, 10, 8, 16, 8, 16, 8, 4, 4, 2, 1, 2, 1, 1], widths = [0, 0, 40, 40, 40, 40, 20, 20, 10, 10, 20, 20, 20, 40, 40, 40];
	let a = a8.antic.dlist, lms = 0, line = 0, seenPicture = false, first = null, last = null;
	for (let i = 0; i < 160; i++) {
		const ins = mem[a++], mode = ins & 0x0F;
		if (mode === 1) { if (ins & 0x40) break; a = mem[a] | mem[a + 1] << 8; continue; }
		if (mode === 0) { line += ((ins >> 4) & 7) + 1; continue; }
		if (ins & 0x40) { lms = mem[a] | mem[a + 1] << 8; a += 2; }
		if (mode === 0x0E) seenPicture = true;
		else if (seenPicture && mode === 2) {
			if (first === null) first = line;
			for (let x = 0; x < 40; x++)
				if (mem[lms + x] & 0x7F) { last = line + 8; break; }
		}
		line += heights[mode]; lms += widths[mode];
	}
	return first === null || last === null ? null : [first, last];
}

// Draws a region of the game's screen with its top-left corner at (x, y),
// scaled; all in screen pixels
function drawScreenRegion(region, x, y, scale) {
	const [x0, y0, x1, y1] = region;
	gl.drawScreen(x0, y0, x1, y1, gx(x), gx(x + (x1 - x0) * scale), gy(y), gy(y + (y1 - y0) * scale), Z_2D);
}

/* ------------------------------ colours and textures ------------------------------ */

// The game's picture, read back from the screen each frame (gl.readPixels of
// the picture's rectangle). Its colours are the interrupts' work, line by
// line (*measured*, altreal-city.md): pixel value 3 is the playfield register
// the interrupt loads each line, the sky's blues above the horizon and the
// ground's browns below; value 0, the background, shows the two wide
// players laid over the picture, whose colours change by line too: dark
// reds at the horizon, the skyline's silhouette; values 1 and 2 are the
// stones, blue and grey. So the colour of each value is sampled on each
// line where the bitmap has it; lines without one keep what was seen.
const HORIZON_LINE = 36;                           // the first line of the mirrored half
// The tables the picture's DLI loads the colours from on every line, indexed
// by 71 - line: COLPF2 (value 3, the sky and the ground) and COLPM3 (player
// 3, the bar that value 0 shows), rewritten by the game for the time of day
// ($5ACC-$5BE0). Sampling the screen is what the view relies on; these are
// its fallback for a line the screen cannot answer for, say a wall over the
// whole picture with no sky pixel on it (*measured*: tc12.a8s, black bands)
const COLPF2_TABLE = 0xBDCA, COLPM3_TABLE = 0xBE12;
const tableColour = (table, line, into, at) => { const c = a8.palette[mem[table + PIC - 1 - line]]; into[at] = (c >> 16) / 255; into[at + 1] = ((c >> 8) & 255) / 255; into[at + 2] = (c & 255) / 255; };
const lineColour = new Float32Array(PIC * 3);     // value 3: the sky and the ground, r, g, b per picture line, 0 at the top
const zeroColour = new Float32Array(PIC * 3);     // value 0: the players' colour per line
const facadeColour = [[0.2, 0.05, 0.05], [0.5, 0.5, 0.8], [0.8, 0.8, 0.8]];   // pixel values 0-2 for the wall textures: 0 the mean of value 0's
let screenPixels = null, colourVersion = 0;

// The frame buffer the display list shows: its first LMS
function frameBuffer() {
	let p = a8.antic.dlist, n = 0;
	while (n++ < 64) {
		const b = mem[p];
		if ((b & 0x0F) === 1) { p = mem[p + 1] | mem[p + 2] << 8; if (b & 0x40) return -1; continue; }   // JMP
		if ((b & 0x0F) === 0x0E && (b & 0x40)) return mem[p + 1] | mem[p + 2] << 8;   // the first mode E line with LMS
		p += (b & 0x40) && (b & 0x0F) ? 3 : 1;
	}
	return -1;
}

// Which of the game's two buffers the screen shows at the moment the frame
// is read back is uncertain by a frame around a switch (the game switches
// its display list in the vertical blank, while walking on every frame).
// Reading the bitmap through the wrong one put stones where the screen had
// sky and gave a frame of wrong colours: a flash at every step. So a pixel
// is trusted only where both buffers agree on its value, and the stones'
// colours are the most frequent of several samples.
let otherBuffer = -1, currentBuffer = -1;
// The value (0-3) of the picture's pixel at column x, line 0-71 (the lower
// half mirrors the upper), trusted only where both buffers agree (the game
// switches them in the vertical blank: which one the screen shows at the
// read is uncertain by a frame), else -1
function pixelValue(x, line) {
	if (currentBuffer < 0) return -1;
	const row = line < PIC_H ? line : PIC - 1 - line;
	const v = (mem[currentBuffer + row * 32 + 7 + (x >> 2)] >> (6 - 2 * (x & 3))) & 3;
	return otherBuffer === currentBuffer || ((mem[otherBuffer + row * 32 + 7 + (x >> 2)] >> (6 - 2 * (x & 3))) & 3) === v ? v : -1;
}
function sampleColours() {
	const buf = frameBuffer();
	if (buf < 0) return;
	if (otherBuffer < 0 || otherBuffer === buf) otherBuffer = buf === 0xA000 ? 0xA6A1 : 0xA000;
	else if (buf !== 0xA000 && buf !== 0xA6A1) otherBuffer = buf;
	currentBuffer = buf;
	const [vx, vy, vw, vh] = gl.GetIntegerv(gl.VIEWPORT);
	const px0 = Math.floor(vx + (gx(PICTURE[0]) + 1) / 2 * vw), px1 = Math.ceil(vx + (gx(PICTURE[2]) + 1) / 2 * vw);
	const py0 = Math.floor(vy + (gy(PICTURE[3]) + 1) / 2 * vh), py1 = Math.ceil(vy + (gy(PICTURE[1]) + 1) / 2 * vh);
	const w = px1 - px0, h = py1 - py0;
	if (w <= 0 || h <= 0) return;
	screenPixels = gl.readPixels(px0, py0, w, h);
	// the rendered colour of picture pixel (x, line), y down
	const at = (x, line) => {
		const sx = Math.floor((x + 0.5) / PIC * w), sy = Math.floor((PIC - line - 0.5) / PIC * h);
		const o = 4 * (sy * w + sx);
		return [screenPixels[o] / 255, screenPixels[o + 1] / 255, screenPixels[o + 2] / 255];
	};
	// the bitmap: the upper 36 lines are at buf, 32 bytes a line (the interrupt
	// narrows the playfield for them), the picture in bytes 7-24
	const valueIn = (b, x, row) => (mem[b + row * 32 + 7 + (x >> 2)] >> (6 - 2 * (x & 3))) & 3;
	const value = (x, row) => { const v = valueIn(buf, x, row); return otherBuffer === buf || valueIn(otherBuffer, x, row) === v ? v : -1; };
	// The player's bar covers one half of the picture's width on each line
	// (it moves between two positions line by line), so a value-0 pixel shows
	// the bar's colour there and black elsewhere: the first non-black one on
	// the line is the bar's colour, and a line with none keeps what it had
	// In rain the players are the drops, in front of everything: a value-0
	// pixel shows black, and a value-3 pixel may show a drop, so a line's
	// colour is the one most of its first value-3 pixels show
	const rain = raining(), samples3 = rain ? 5 : 1, calm = rain && view.options.calmRain;
	if (rain) zeroColour.fill(0);
	// player 2 lies over value-0 pixels: not a sample of the players' bar
	const star = playerTwo();
	const underStar = (x, line) => { if (star === null) return false; const c = spriteCover(star, line); return c !== null && x >= c[0] && x < c[1]; };
	// a calm rain: the random colours settle to their mean over a few frames
	const settle = (line, c) => { for (let i = 0; i < 3; i++) lineColour[3 * line + i] = calm ? lineColour[3 * line + i] * 0.85 + c[i] * 0.15 : c[i]; };
	const stoneSamples = [[], [], []], sampled0 = new Uint8Array(PIC), sampled3 = new Uint8Array(PIC);
	for (let line = 0; line < PIC; line++) {
		const row = line < PIC_H ? line : PIC - 1 - line;   // the lower half mirrors the upper
		let got0 = rain, got3 = false, seen3 = [];
		for (let x = 0; x < PIC_W && !(got0 && got3); x++) {
			const v = value(x, row);
			if (v === 3 && !got3) {
				const c = at(x, line);
				seen3.push(c);
				if (seen3.length < samples3) continue;
				got3 = true;
				if (seen3.length > 1) {
					const key = (c) => c.map((k) => Math.round(k * 255)).join(",");
					const counts = new Map(); let best = seen3[0];
					for (const s of seen3) { const k = key(s); counts.set(k, (counts.get(k) || 0) + 1); if (counts.get(k) > (counts.get(key(best)) || 0)) best = s; }
					seen3 = [best];
				}
				settle(line, seen3[0]); sampled3[line] = 1;
			}
			else if (v === 0 && !got0 && !underStar(x, line)) {
				const c = at(x, line);
				if (c[0] + c[1] + c[2] > 0.05) { got0 = true; sampled0[line] = 1; zeroColour[3 * line] = c[0]; zeroColour[3 * line + 1] = c[1]; zeroColour[3 * line + 2] = c[2]; }
			}
			else if ((v === 1 || v === 2) && stoneSamples[v].length < 9 && (line & 3) === 1) stoneSamples[v].push(at(x, line).map((c) => Math.round(c * 255)).join(","));
		}
		if (!got3 && seen3.length) { settle(line, seen3[0]); sampled3[line] = 1; }
	}
	// a line with no value-3 pixel to sample takes the register's table (not in rain, where the DLI draws random colours instead)
	if (!rain) for (let line = 0; line < PIC; line++) if (!sampled3[line]) tableColour(COLPF2_TABLE, line, lineColour, 3 * line);
	// A line with no value-0 pixel to sample: below the horizon the players'
	// colour is the line's own (the game's two colour tables, $BDCA for the
	// playfield and $BE12 for player 3, are equal for lines 37-71 in every
	// state seen, which is why a sign's letters vanish in the mirrored half:
	// tc3.a8s), above it the nearest sampled line's
	if (!rain)
		for (let line = 0; line < PIC; line++) {
			if (sampled0[line]) continue;
			if (line >= HORIZON_LINE + 1) for (let i = 0; i < 3; i++) zeroColour[3 * line + i] = lineColour[3 * line + i];
			else tableColour(COLPM3_TABLE, line, zeroColour, 3 * line);
		}
	for (const v of [1, 2]) {
		if (!stoneSamples[v].length) continue;
		const counts = new Map(); let best = null;
		for (const k of stoneSamples[v]) { counts.set(k, (counts.get(k) || 0) + 1); if (best === null || counts.get(k) > counts.get(best)) best = k; }
		if (counts.get(best) >= 2 || stoneSamples[v].length === 1) facadeColour[v] = best.split(",").map((c) => c / 255);
	}
	// the game dithers its gradients, one hue a line: a line's colour is the mean of its pair
	for (const arr of [lineColour, zeroColour])
		for (let line = 0; line < PIC; line += 2)
			for (let i = 0; i < 3; i++) {
				const m = (arr[3 * line + i] + arr[3 * (line + 1) + i]) / 2;
				arr[3 * line + i] = arr[3 * (line + 1) + i] = m;
			}
	colourVersion++;
	stats.colours = { line: lineColour, zero: zeroColour };
	stats.buf = buf; let sum = 0; for (let i = 0; i < lineColour.length; i++) sum += lineColour[i]; stats.lineSum = Math.round(sum * 10);
	stats.stones = `${facadeColour[1].map((c) => Math.round(c * 255))}/${facadeColour[2].map((c) => Math.round(c * 255))}`;
}

// A 72 x 36 picture's pixel values, one byte each
function picturePixels(src) {
	const out = new Uint8Array(PIC_W * PIC_H);
	for (let row = 0, o = 0; row < PIC_H; row++)
		for (let b = 0; b < PIC_STRIDE; b++) {
			const v = src[row * PIC_STRIDE + b];
			out[o++] = v >> 6; out[o++] = (v >> 4) & 3; out[o++] = (v >> 2) & 3; out[o++] = v & 3;
		}
	return out;
}

// A texture from a picture: values 1 and 2 in the facade colours. Values 0
// and 3 take the colour of the line they are shown on (the players' and the
// playfield register's, zeroColour and lineColour): on the skyline, whose
// rows lie on the picture's lines 0-35, value 0 is baked in and 3 left
// transparent (the bands behind have it); on a wall both are transparent in
// the picture and painted by two more passes over the same quad, through
// "masks" white where the value is 0 or 3 and transparent elsewhere, with
// the colours at the vertices (the sign's band, the door's lines, as the
// game shows them)
function finish(t, smooth) {
	t.finalize();
	gl.TexParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.TexParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.TexParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, smooth ? gl.LINEAR : gl.NEAREST);
	gl.TexParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, smooth ? gl.LINEAR : gl.NEAREST);
	return t;
}
function pictureTexture(values, w, h, smooth, colours, skyline) {
	const rows = h;
	if (smooth) { values = scale2x(values, w, h); w *= 2; h *= 2; values = scale2x(values, w, h); w *= 2; h *= 2; }
	const t = gl.createTexture(w, h), px = t.pixels;
	const m0 = skyline ? null : gl.createTexture(w, h), m3 = skyline ? null : gl.createTexture(w, h);
	for (let i = 0, o = 0; i < values.length; i++, o += 4) {
		const v = values[i];
		let c = colours[v], a = 255;
		if (v === 3) { c = [0, 0, 0]; a = 0; }
		else if (v === 0) {
			if (skyline) { const line = Math.floor(Math.floor(i / w) * rows / h); c = [zeroColour[3 * line], zeroColour[3 * line + 1], zeroColour[3 * line + 2]]; }
			else a = 0;
		}
		px[o] = c[0] * 255; px[o + 1] = c[1] * 255; px[o + 2] = c[2] * 255; px[o + 3] = a;
		if (m0) {
			m0.pixels[o] = m0.pixels[o + 1] = m0.pixels[o + 2] = 255; m0.pixels[o + 3] = v === 0 ? 255 : 0;
			m3.pixels[o] = m3.pixels[o + 1] = m3.pixels[o + 2] = 255; m3.pixels[o + 3] = v === 3 ? 255 : 0;
		}
	}
	finish(t, smooth);
	if (m0) { finish(m0, smooth); finish(m3, smooth); }
	return { picture: t, mask0: m0, mask3: m3 };
}

// The door picture with sign n (0-7) patched in, as the game does ($636D)
function doorWithSign(n) {
	const bytes = mem.slice(PICTURE_DOOR, PICTURE_DOOR + PIC_BYTES);
	for (let r = 0; r < SIGN_ROWS; r++)
		for (let b = 0; b < SIGN_BYTES; b++)
			bytes[(SIGN_ROW + r) * PIC_STRIDE + SIGN_COLUMN + b] = mem[SIGNS + n * SIGN_SIZE + r * SIGN_BYTES + b];
	return bytes;
}

// The wall textures depend on the stones' two colours (registers: they
// change with the time of day), the skyline's on the players' colours down
// its lines; each set is rebuilt only when its key has held for a few frames
// (a monster over the sampled pixels, a redraw caught half way)
let textures = { walls: null, skyline: null }, keys = { walls: "", skyline: "" }, pending = { walls: ["", 0], skyline: ["", 0] };
export const stats = { rebuilds: 0, drawn: 0, skipped: 0, colours: null };

function settled(which, key) {
	if (textures[which] !== null && key === keys[which]) { pending[which] = ["", 0]; return false; }
	if (textures[which] !== null) {
		if (key !== pending[which][0]) { pending[which] = [key, 0]; return false; }
		if (++pending[which][1] < 6) return false;
	}
	keys[which] = key; pending[which] = ["", 0];
	stats.rebuilds++;
	return true;
}

function buildTextures(smooth) {
	const make = (bytes, skyline = false) => pictureTexture(picturePixels(bytes), PIC_W, PIC_H, smooth, facadeColour, skyline);
	if (settled("walls", `${smooth}|${[1, 2].map((v) => facadeColour[v].map((c) => Math.round(c * 255)).join(",")).join("/")}`))
		textures.walls = {
			wall: make(mem.subarray(PICTURE_WALL, PICTURE_WALL + PIC_BYTES)),
			colonnade: make(mem.subarray(PICTURE_COLONNADE, PICTURE_COLONNADE + PIC_BYTES)),
			doors: Array.from({ length: 8 }, (_, n) => make(doorWithSign(n))),
		};
	const band = []; for (let line = 0; line < PIC_H; line += 3) band.push(Math.round(zeroColour[3 * line] * 16), Math.round(zeroColour[3 * line + 2] * 16));
	if (settled("skyline", `${smooth}|${band.join(",")}`))
		textures.skyline = PICTURE_BACKDROPS.map((a) => make(mem.subarray(a, a + PIC_BYTES), true).picture);
}

/* ------------------------------ projection ------------------------------ */

// Pixels per unit at distance d along the view: 2 at the eye, 1 a cell away,
// 1/2 at two cells, halving each cell. The game goes linearly between those
// (its widths are the position byte for the cell's own far side, then
// halved a row), which makes a wall ahead grow fast on entering a cell and
// slower toward its end, then fast again past the boundary: a step feels
// quick, then slow, then quick. The exponential through the same points,
// 2^(1 - d / 36), grows at one rate, and is what the view uses unless the
// game's own law is asked for ("Projection: Game"); the two differ by 6 %
// at most, in the middle of a cell.
let gameLaw = false;
function scaleAt(d) {
	if (d <= 0) return 2;
	if (!gameLaw) return Math.pow(2, 1 - d / CELL);
	const k = Math.floor(d / CELL), r = d - k * CELL;
	return (2 - r / CELL) / (1 << k);
}

// The eye: position and the sines of its yaw, set once per frame
const eye = { x: 0, z: 0, sin: 0, cos: 1 };

// A world point (x east, y up, z south) to picture coordinates, y down, and
// its distance along the view
function project(wx, wy, wz) {
	const dx = wx - eye.x, dz = wz - eye.z;
	const l = dx * eye.cos + dz * eye.sin;       // to the right
	const d = dx * eye.sin - dz * eye.cos;       // ahead
	const s = scaleAt(d);
	return [PIC_CENTRE + l * s, PIC_CENTRE - (wy - EYE_HEIGHT) * s, d, s];
}

// A textured vertex at a projected point. The point is given homogeneous,
// with w the inverse of its scale: the picture's x and y are l / w and
// h / w, a perspective projection of a world whose depth is w, so GL
// interpolates the texture in perspective across the quad. Plain screen
// points would have it interpolated linearly per triangle, which kinks a
// wall's picture along the quad's diagonal (one half looks frontal, the
// other at an angle) and warps the ground's cobbles into zigzags
// (*measured*: tc8.a8s, a step forward, the wall on the right)
function vertex(u, v, wx, wy, wz) {
	const [x, y, d, s] = project(wx, wy, wz), w = 1 / s;
	gl.TexCoord2f(u, v);
	gl.Vertex4f(x * w, y * w, -d * w, w);
}

/* ------------------------------ drawing ------------------------------ */

// The sky and the ground, behind everything, in the lines' sampled colours
// (the game's ground is the sky's reflection, in its own colours below the
// horizon): a band per picture line as the game has it, or the same colours
// blended into a smooth gradient (from the middle of each line to the next)
function drawBands(smooth, from = 0, to = PIC) {
	gl.Disable(gl.TEXTURE_2D); gl.Disable(gl.DEPTH_TEST);
	const z = -CELL * (VIEW_RANGE + 2), colour = (line) => gl.Color4f(lineColour[3 * line], lineColour[3 * line + 1], lineColour[3 * line + 2], 1);
	gl.Begin(gl.QUADS);
	if (!smooth)
		for (let line = from; line < to; line++) {
			colour(line);
			gl.Vertex3f(0, line, z); gl.Vertex3f(PIC, line, z); gl.Vertex3f(PIC, line + 1, z); gl.Vertex3f(0, line + 1, z);
		}
	else {
		// one gradient: the colours at the lines' centres, blended between; the
		// game's dithering being a pair of lines, the pairs' means are the stops
		const stop = (line) => Math.min(to - 2, Math.max(from, line & ~1));   // the pair the line is in
		for (let line = from; line < to - 1; line += 2) {
			const y0 = line === from ? from : line + 1, y1 = line + 2 >= to - 1 ? to : line + 3;
			colour(stop(line)); gl.Vertex3f(0, y0, z); gl.Vertex3f(PIC, y0, z);
			colour(stop(line + 2)); gl.Vertex3f(PIC, y1, z); gl.Vertex3f(0, y1, z);
		}
	}
	gl.End();
	gl.Enable(gl.DEPTH_TEST);
}

// The ground as a textured plane (the "Textured" choice): one quad a cell
// around the player, a grey grain over it and each vertex in the ground's
// colour of the line it falls on, so the game's gradient tints the grain
function noise(x, y, seed) {
	let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
	h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
	return ((h ^ (h >>> 16)) & 0xffff) / 0xffff;
}
let groundTexture = null;
function groundPlane() {
	if (groundTexture === null) {
		const size = 64, t = gl.createTexture(size, size), px = t.pixels;
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				// cobbles: a coarse grid of stones with darker joins, a little grain
				const sx = x % 16, sy = y % 16, edge = sx === 0 || sy === 0 || sx === 15 || sy === 15;
				const v = (edge ? 0.6 : 0.85 + 0.15 * noise(x, y, 7)) * 255, o = 4 * (y * size + x);
				px[o] = v; px[o + 1] = v; px[o + 2] = v; px[o + 3] = 255;
			}
		t.finalize();
		gl.TexParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
		gl.TexParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
		gl.TexParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.TexParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		groundTexture = t;
	}
	return groundTexture;
}
// A cell's quad cut at the near plane (Sutherland-Hodgman against the
// distance along the view), the texture coordinates interpolated: the cell
// the player stands in shows the part of its texture that is ahead
function clipNear(poly, near) {
	const out = [], d = (p) => (p[2] - eye.x) * eye.sin - (p[3] - eye.z) * eye.cos;
	for (let i = 0; i < poly.length; i++) {
		const a = poly[i], b = poly[(i + 1) % poly.length], da = d(a), db = d(b);
		if (da >= near) out.push(a);
		if ((da >= near) !== (db >= near)) {
			const t = (near - da) / (db - da);
			out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]);
		}
	}
	return out;
}
function drawGround(cx, cy) {
	gl.Enable(gl.TEXTURE_2D); gl.Disable(gl.BLEND); gl.Enable(gl.DEPTH_TEST);
	gl.BindTexture(gl.TEXTURE_2D, groundPlane().id);
	for (let y = cy - VIEW_RANGE; y <= cy + VIEW_RANGE; y++)
		for (let x = cx - VIEW_RANGE; x <= cx + VIEW_RANGE; x++) {
			const X0 = x * CELL, X1 = X0 + CELL, Z0 = y * CELL, Z1 = Z0 + CELL;
			const dc = (X0 + CELL / 2 - eye.x) * eye.sin - (Z0 + CELL / 2 - eye.z) * eye.cos;
			if (dc < -CELL) continue;
			const poly = clipNear([[x, y, X0, Z0], [x + 1, y, X1, Z0], [x + 1, y + 1, X1, Z1], [x, y + 1, X0, Z1]], NEAR);
			if (poly.length < 3) continue;
			gl.Begin(gl.POLYGON);
			for (const [u, v, wx, wz] of poly) {
				const [, py] = project(wx, 0, wz), line = Math.max(PIC_CENTRE, Math.min(PIC - 1, Math.round(py)));
				gl.Color4f(lineColour[3 * line] * 1.2, lineColour[3 * line + 1] * 1.2, lineColour[3 * line + 2] * 1.2, 1);
				vertex(u, v, wx, 0, wz);
			}
			gl.End();
		}
}

// The backdrop on the horizon: the game shows one picture a facing, its
// bottom at the horizon, 36 lines tall; here the four lie side by side, a
// quarter turn each, and the view's 72 columns are a window into them at
// the eye's yaw, so that a turn slides the horizon round. Far behind the
// buildings. The game mirrors it below like everything else, but there its
// silhouette's colour (the players') and the ground's (the register's) are
// one and the same, so nothing of it shows: none is drawn here either
function drawSkyline(pictures, yawDeg) {
	gl.Enable(gl.TEXTURE_2D); gl.Enable(gl.BLEND);
	gl.Color4f(1, 1, 1, 1);
	const z = -CELL * (VIEW_RANGE + 1), total = 4 * PIC;
	let offset = ((yawDeg / 90) * PIC) % total;   // the panorama column at the view's left edge
	if (offset < 0) offset += total;
	for (let x = 0; x < PIC;) {
		const col = (offset + x) % total, i = Math.floor(col / PIC), inPicture = col - i * PIC;
		const width = Math.min(PIC - x, PIC - inPicture), u0 = inPicture / PIC, u1 = (inPicture + width) / PIC;
		gl.BindTexture(gl.TEXTURE_2D, pictures[i].id);
		gl.Begin(gl.QUADS);
		gl.TexCoord2f(u0, 0); gl.Vertex3f(x, 0, z);
		gl.TexCoord2f(u1, 0); gl.Vertex3f(x + width, 0, z);
		gl.TexCoord2f(u1, 1); gl.Vertex3f(x + width, PIC_CENTRE, z);
		gl.TexCoord2f(u0, 1); gl.Vertex3f(x, PIC_CENTRE, z);
		gl.End();
		x += width;
	}
	gl.Disable(gl.BLEND);
}

// A wall from (x0, z0) to (x1, z1), left to right as seen, the picture on
// its upper half and, when mirrored, the picture upside down on the lower
// half as the game shows it; otherwise the picture over the whole wall.
// tint: null, or the per-line colours (lineColour, zeroColour) each vertex
// takes for its picture line, for the passes painting the see-through pixels
function wallQuad(x0, z0, x1, z1, mirrored, tint) {
	// The part behind the eye is cut off at the near plane, the picture's
	// columns with it: a wall the player stands beside shows the part of the
	// picture that is ahead, as the game draws it, not the whole picture
	// squeezed into what is left (*measured*: tc5.a8s)
	let d0 = (x0 - eye.x) * eye.sin - (z0 - eye.z) * eye.cos, d1 = (x1 - eye.x) * eye.sin - (z1 - eye.z) * eye.cos;
	let u0 = 0, u1 = 1;
	if (d0 < NEAR && d1 < NEAR) return;
	if (d0 < NEAR) { const t = (NEAR - d0) / (d1 - d0); x0 += (x1 - x0) * t; z0 += (z1 - z0) * t; u0 = t; }
	else if (d1 < NEAR) { const t = (NEAR - d1) / (d0 - d1); x1 += (x0 - x1) * t; z1 += (z0 - z1) * t; u1 = 1 - t; }
	const put = (u, v, wx, wy, wz) => {
		u = u0 + (u1 - u0) * u;
		if (tint) {
			const [, y] = project(wx, wy, wz), line = Math.max(0, Math.min(PIC - 1, Math.round(y)));
			gl.Color4f(tint[3 * line], tint[3 * line + 1], tint[3 * line + 2], 1);
		}
		vertex(u, v, wx, wy, wz);
	};
	// The wall between the heights yA and yB, with the picture's rows vA at yA
	// and vB at yB. A tinted pass goes in slices about a picture line tall,
	// since a vertex's colour is interpolated across what it spans: one quad
	// would smear the horizon's colour down to the ground's (*measured*:
	// tc3.a8s, the sign's letters came out black in the mirrored half, where
	// the game shows them in the line's own colour)
	const strip = (yA, vA, yB, vB) => {
		let n = 1;
		if (tint) {
			const h = Math.max(Math.abs(project(x0, yA, z0)[1] - project(x0, yB, z0)[1]), Math.abs(project(x1, yA, z1)[1] - project(x1, yB, z1)[1]));
			n = Math.min(PIC_H, Math.max(1, Math.ceil(h)));
		}
		for (let i = 0; i < n; i++) {
			const ta = i / n, tb = (i + 1) / n;
			const ya = yA + (yB - yA) * ta, yb = yA + (yB - yA) * tb, va = vA + (vB - vA) * ta, vb = vA + (vB - vA) * tb;
			put(0, va, x0, ya, z0); put(1, va, x1, ya, z1); put(1, vb, x1, yb, z1); put(0, vb, x0, yb, z0);
		}
	};
	gl.Begin(gl.QUADS);
	if (mirrored) {
		// the lower half upside down: the picture's bottom row at the horizon on both halves
		strip(0, 0, EYE_HEIGHT, 1);
		strip(EYE_HEIGHT, 1, WALL_HEIGHT, 0);
	}
	else strip(0, 1, WALL_HEIGHT, 0);
	gl.End();
}

function drawWalls(cx, cy, facing, mirrored) {
	// Every side of every cell in range is a wall segment on that cell's
	// edge. The game draws, for each cell of its window, the cell's far side
	// and its outer side (the side away from the player's column): the edges
	// on the far side of the cell, seen from the player's side. So a segment
	// shows when the cell on the player's side of it carries it, and not
	// when only the cell beyond does (*measured*: at the City Square facing
	// east, the gate's north side, carried by the gate's cell beyond the
	// edge, is not in the picture; in tc4.a8s facing west, a side carried by
	// the street cell this side of it is, as a wall at an angle on the
	// right). Its sign is the kind of the cell beyond, the building's
	// (*measured*: tc3.a8s, the game's draw list holds the kind of the cell
	// ahead for the face in front of the player, and the sign reads SHOP).
	// Far to near.
	const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
	const edges = new Map();   // "h:x:y" (the north edge of (x, y)), "v:x:y" (the west edge) -> { type, kindNear, kindFar, x0, z0, x1, z1, nearer }
	const take = (key, type, kind, x0, z0, x1, z1, nearer) => {
		let e = edges.get(key);
		if (e === undefined) { e = { type: nearer ? type : 0, kindNear: -1, kindFar: -1, x0, z0, x1, z1, nearer }; edges.set(key, e); }
		else if (nearer && !e.nearer) { e.type = type; e.nearer = true; }
		if (nearer) e.kindNear = kind; else e.kindFar = kind;
	};
	for (let y = cy - VIEW_RANGE; y <= cy + VIEW_RANGE; y++)
		for (let x = cx - VIEW_RANGE; x <= cx + VIEW_RANGE; x++) {
			const w = cellWalls(x, y);
			if (!(w[0] | w[1] | w[2] | w[3])) continue;
			const ahead = (x - cx) * DX[facing] + (y - cy) * DY[facing];
			if (ahead < -1) continue;
			const kind = cellKind(x, y);
			const X0 = x * CELL, X1 = X0 + CELL, Z0 = y * CELL, Z1 = Z0 + CELL;
			// each edge from west to east or north to south; "nearer": the eye is on this cell's side of it
			if (w[0]) take(`h:${x}:${y}`, w[0], kind, X0, Z0, X1, Z0, eye.z >= Z0);
			if (w[2]) take(`h:${x}:${y + 1}`, w[2], kind, X0, Z1, X1, Z1, eye.z < Z1);
			if (w[3]) take(`v:${x}:${y}`, w[3], kind, X0, Z0, X0, Z1, eye.x >= X0);
			if (w[1]) take(`v:${x + 1}:${y}`, w[1], kind, X1, Z0, X1, Z1, eye.x < X1);
		}
	const items = [];
	for (const e of edges.values()) {
		if (!e.type) continue;   // carried only by the cell beyond
		const d0 = (e.x0 - eye.x) * eye.sin - (e.z0 - eye.z) * eye.cos;
		const d1 = (e.x1 - eye.x) * eye.sin - (e.z1 - eye.z) * eye.cos;
		if (d0 < 0.5 && d1 < 0.5) continue;
		// left to right as seen: the eye's side of the segment decides the order
		const horizontal = e.z0 === e.z1, eyeBefore = horizontal ? eye.z < e.z0 : eye.x < e.x0;
		const [ax, az, bx, bz] = (horizontal ? eyeBefore : !eyeBefore) ? [e.x1, e.z1, e.x0, e.z0] : [e.x0, e.z0, e.x1, e.z1];
		items.push({ e, ax, az, bx, bz, d: (d0 + d1) / 2 });
	}
	items.sort((p, q) => q.d - p.d);
	gl.Enable(gl.TEXTURE_2D); gl.Enable(gl.BLEND);
	for (const it of items) {
		const { type } = it.e, kind = it.e.kindFar >= 0 ? it.e.kindFar : it.e.kindNear;
		// a door keeps its door and sign at an angle too (*measured*: tc4.a8s,
		// the game's wall on the right carries the sign)
		const tex = kind === KIND_COLONNADE ? textures.walls.colonnade : type === 3 ? textures.walls.doors[kind >> 5] : textures.walls.wall;
		gl.Enable(gl.DEPTH_TEST);
		gl.BindTexture(gl.TEXTURE_2D, tex.picture.id);
		gl.Color4f(1, 1, 1, 1);
		wallQuad(it.ax, it.az, it.bx, it.bz, mirrored, null);
		// the see-through pixels in their lines' colours, over the same quad (far to near, so what is nearer covers them later)
		gl.Disable(gl.DEPTH_TEST);
		gl.BindTexture(gl.TEXTURE_2D, tex.mask3.id);
		wallQuad(it.ax, it.az, it.bx, it.bz, mirrored, lineColour);
		gl.BindTexture(gl.TEXTURE_2D, tex.mask0.id);
		wallQuad(it.ax, it.az, it.bx, it.bz, mirrored, zeroColour);
	}
	gl.Enable(gl.DEPTH_TEST);
}

/* ------------------------------ sprites ------------------------------ */

// An encounter's monster is drawn with players 0 and 1 (the game's two wide
// bars over the picture are player 3), their shapes in the P/M area at
// PMBASE (0: $0400 and $0500 in single-line resolution, a byte a scanline),
// their positions, sizes and colours left in the registers (*measured*: no
// interrupt changes them). The picture's first scanline is 80 and its left
// edge is colour clock 92. The overlay is rebuilt only when something of
// this changes.
const PICTURE_FIRST_SCANLINE = 80, PICTURE_FIRST_CLOCK = 92;

// In rain, players 2 and 3 and missile 3 are the falling drops (the
// interrupt gives them their place and width for the picture's lines:
// $BE8B, player 2 doubled at $7C, player 3 quadrupled at $5E or $7F by the
// frame, missile 3 quadrupled at $9C, and their colour a dark blue)
const RAIN_SPRITES = { hposp2: 0x7C, sizep2: 1, hposp3: [0x5E, 0x7F], sizep3: 3, hposm3: 0x9C, sizem3: 3, colour: 0x82 };
// In fair weather player 2 is a picture of the game's behind the playfield
// (priority 2), 8 pixels wide at a place by the facing ($D002: $7C, $7C,
// $00 and $8C, the last off the picture), coloured a line at a time by the
// interrupt from the table at ($0C) xor $06, and it shows wherever the
// picture has value 0 over it: the sun or star, a shape the game alternates
// every frame ($5A2C, by the frame's parity), through a hole it punches into
// the sky for it (*measured*: tc9.a8s, with a disc below the horizon as its
// reflection, in exactly the ground's colours, so unseen); or a zigzag down
// all 36 lines that shows through the skyline's silhouette as a waterfall
// between two peaks (tc11.a8s, facing south, $38/$1C a line at $8C)
const P2_COLOURS = 0x0C, P2_COLOURS_XOR = 0x06;
const playerTwoColour = (line) => mem[(mem[P2_COLOURS] | mem[P2_COLOURS + 1] << 8) + PIC - 1 - line] ^ mem[P2_COLOURS_XOR];

// The sprites' sources: a player's or a missile's bitmap, place, width, colour
function playerShape(p, y) {
	const an = a8.antic, single = (an.dmactl & 0x10) !== 0, base = an.pmbase << 8, line = PICTURE_FIRST_SCANLINE + y;
	return p < 4 ? (single ? mem[base + 0x400 + p * 0x100 + line] : mem[base + 0x200 + p * 0x80 + (line >> 1)])
		: (single ? mem[base + 0x300 + line] : mem[base + 0x180 + (line >> 1)]);
}
const WIDTHS = [1, 2, 1, 4];
// The picture columns a sprite covers on a line, [x0, x1), or null
function spriteCover(sp, y) {
	const bitsOn = (playerShape(sp.player, y) >> sp.shift) & ((1 << sp.bits) - 1);
	if (!bitsOn) return null;
	const w = WIDTHS[sp.size & 3], x0 = sp.hpos - PICTURE_FIRST_CLOCK;
	return [x0, x0 + sp.bits * w];
}
// Player 2 in fair weather, shown where the picture has value 0, above the
// horizon only (its reflection below has exactly the ground's line colours)
function playerTwo() {
	const g = a8.gtia;
	if (raining() || !(g.gractl & 2) || !(a8.antic.dmactl & 8)) return null;
	return { player: 2, hpos: g.hposp2, size: g.sizep2, shift: 0, bits: 8, colour: playerTwoColour, lines: PIC_H, mask: (x, y) => pixelValue(x, y) === 0 };
}

// A texture of sprites over the picture, 72 x 72, the first in front;
// each: { player (0-3, 4 the missiles), hpos, size, shift, bits, colour (a
// value or a function of the line), lines (how many from the top, all by
// default), mask (a function of column and line: where the sprite shows,
// everywhere by default) }. Rebuilt only when something changes
function buildSpriteTexture(slot, sprites, smooth) {
	const count = sprites.length, shapes = new Uint8Array(count * PIC);
	let sum = 0;
	for (let y = 0; y < PIC; y++)
		for (let p = 0; p < count; p++) {
			const sp = sprites[p];
			shapes[p * PIC + y] = sp.lines !== undefined && y >= sp.lines ? 0 : (playerShape(sp.player, y) >> sp.shift) & ((1 << sp.bits) - 1);
			sum = (sum * 31 + shapes[p * PIC + y]) | 0;
		}
	const colourAt = (sp, y) => typeof sp.colour === "function" ? sp.colour(y) : sp.colour;
	let colourSum = 0;
	for (const sp of sprites) if (typeof sp.colour === "function") for (let y = 0; y < PIC; y++) colourSum = (colourSum * 31 + sp.colour(y)) | 0;
	// a masked sprite: the mask over its own columns is part of the key
	for (let p = 0; p < count; p++) {
		const sp = sprites[p];
		if (!sp.mask) continue;
		const w = WIDTHS[sp.size & 3], x0 = Math.max(0, sp.hpos - PICTURE_FIRST_CLOCK), x1 = Math.min(PIC, sp.hpos - PICTURE_FIRST_CLOCK + sp.bits * w);
		for (let y = 0; y < PIC; y++) { if (!shapes[p * PIC + y]) continue; for (let x = x0; x < x1; x++) colourSum = (colourSum * 31 + (sp.mask(x, y) ? 1 : 0)) | 0; }
	}
	const key = `${smooth ? "s" : "o"}|${sprites.map((sp) => `${sp.player}:${sp.hpos}:${sp.size}:${typeof sp.colour === "function" ? "f" : sp.colour}`)}|${sum}|${colourSum}`;
	if (key === slot.key) return slot.texture;
	slot.key = key;
	const palette = [];
	let idx = new Uint8Array(PIC * PIC), any = false;
	for (let y = 0; y < PIC; y++)
		for (let x = 0; x < PIC; x++) {
			const clock = PICTURE_FIRST_CLOCK + x;
			let colour = -1;
			for (let p = 0; p < count && colour < 0; p++) {
				const sp = sprites[p], w = WIDTHS[sp.size & 3], k = clock - sp.hpos;
				if (k >= 0 && k < sp.bits * w && (shapes[p * PIC + y] >> (sp.bits - 1 - (k / w | 0))) & 1 && (!sp.mask || sp.mask(x, y))) colour = colourAt(sp, y);
			}
			if (colour < 0) continue;
			let i = palette.indexOf(colour);
			if (i < 0) { i = palette.length; palette.push(colour); }
			idx[y * PIC + x] = i + 1;
			any = true;
		}
	if (!any) { slot.texture = null; return null; }
	let n = PIC;
	if (smooth) { idx = scale2x(idx, n, n); n *= 2; idx = scale2x(idx, n, n); n *= 2; }
	if (slot.texture === null || slot.texture.width !== n) slot.texture = gl.createTexture(n, n);
	const px = slot.texture.pixels;
	px.fill(0);
	for (let i = 0, o = 0; i < idx.length; i++, o += 4) {
		if (!idx[i]) continue;
		const c = a8.palette[palette[idx[i] - 1]];
		px[o] = c >> 16; px[o + 1] = (c >> 8) & 255; px[o + 2] = c & 255; px[o + 3] = 255;
	}
	slot.texture.finalize();
	gl.TexParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.TexParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	return slot.texture;
}
const frontSprites = { key: "", texture: null }, backSprites = { key: "", texture: null };

// In front of everything: players 0 and 1 (the monster), and in rain the drops
function buildFrontSprites(smooth) {
	const g = a8.gtia;
	if (!(g.gractl & 2) || !(a8.antic.dmactl & 8)) return null;
	const sprites = [{ player: 0, hpos: g.hposp0, size: g.sizep0, shift: 0, bits: 8, colour: g.colpm0 }, { player: 1, hpos: g.hposp1, size: g.sizep1, shift: 0, bits: 8, colour: g.colpm1 }];
	if (raining()) sprites.push(   // the registers are cleared after the picture: the drops' colour is given
		{ player: 2, hpos: RAIN_SPRITES.hposp2, size: RAIN_SPRITES.sizep2, shift: 0, bits: 8, colour: RAIN_SPRITES.colour },
		{ player: 3, hpos: RAIN_SPRITES.hposp3[g.hposp3 === RAIN_SPRITES.hposp3[1] ? 1 : 0], size: RAIN_SPRITES.sizep3, shift: 0, bits: 8, colour: RAIN_SPRITES.colour },
		{ player: 4, hpos: RAIN_SPRITES.hposm3, size: RAIN_SPRITES.sizem3, shift: 6, bits: 2, colour: RAIN_SPRITES.colour });
	return buildSpriteTexture(frontSprites, sprites, smooth);
}
// Behind the walls, over the sky and the skyline: player 2 where the picture lets it show
function buildBackSprites(smooth) {
	const p2 = playerTwo();
	return p2 === null ? null : buildSpriteTexture(backSprites, [p2], smooth);
}

// A sprite texture over the whole picture
function drawSprites(texture) {
	gl.Disable(gl.DEPTH_TEST); gl.Enable(gl.BLEND); gl.Enable(gl.TEXTURE_2D);
	gl.BindTexture(gl.TEXTURE_2D, texture.id);
	gl.Color4f(1, 1, 1, 1);
	gl.Begin(gl.QUADS);
	gl.TexCoord2f(0, 0); gl.Vertex3f(0, 0, -1);
	gl.TexCoord2f(1, 0); gl.Vertex3f(PIC, 0, -1);
	gl.TexCoord2f(1, 1); gl.Vertex3f(PIC, PIC, -1);
	gl.TexCoord2f(0, 1); gl.Vertex3f(0, PIC, -1);
	gl.End();
}

/* ------------------------------ the view ------------------------------ */

let view = null;   // the one view, for its options
export function createView3D() {
	let tracking = false;
	let prevYaw = 0, curX = 0, curZ = 0, curYaw = 0;
	let turnFrames = 0;

	return view = {
		options: { smoothTextures: true, mirrored: true, skyline: true, wide: false, ground: 0, gameLaw: false, calmRain: true },   // ground: 0 banded, 1 smooth, 2 textured
		onStreets,

		reset() { tracking = false; },

		// The wide layout, after render(): black bands, the game's texts shrunk
		// into them, and, when the view was not drawn (the Atari view chosen, or
		// a building), the game's own picture enlarged into the view's place.
		// Nothing when the game shows another screen.
		drawWideLayout(viewDrawn, smooth = null) {
			if (!pictureDisplayed())
				return;
			const bottom = bottomTextExtent();
			const bottomHeight = bottom ? (bottom[1] - bottom[0]) * TEXT_SCALE : 0;
			const bandTop = Math.min(WIDE_Y1, SCREEN_H - bottomHeight);
			gl.PushAttrib(gl.ENABLE_BIT); gl.PushAttrib(gl.CURRENT_BIT);
			gl.Disable(gl.DEPTH_TEST); gl.Disable(gl.BLEND); gl.Disable(gl.TEXTURE_2D);
			gl.Color4f(0, 0, 0, 1);
			for (const [y0, y1] of [[0, WIDE_Y0], [bandTop, SCREEN_H]]) {
				gl.Begin(gl.QUADS);
				gl.Vertex3f(-1, gy(y0), Z_2D); gl.Vertex3f(1, gy(y0), Z_2D);
				gl.Vertex3f(1, gy(y1), Z_2D); gl.Vertex3f(-1, gy(y1), Z_2D);
				gl.End();
			}
			gl.Enable(gl.TEXTURE_2D);
			gl.Color4f(1, 1, 1, 1);
			if (!viewDrawn) {
				if (smooth) smooth.draw(WIDE_VIEW, PICTURE);
				else drawScreenRegion(PICTURE, WIDE_VIEW[0], WIDE_VIEW[1], (WIDE_Y1 - WIDE_Y0) / (PICTURE[3] - PICTURE[1]));
			}
			drawScreenRegion(TOP_TEXT, (SCREEN_W - (TOP_TEXT[2] - TOP_TEXT[0]) * TEXT_SCALE) / 2, 0, TEXT_SCALE);
			if (bottom)
				drawScreenRegion([TEXT_X0, bottom[0], TEXT_X1, bottom[1]], (SCREEN_W - (TEXT_X1 - TEXT_X0) * TEXT_SCALE) / 2, SCREEN_H - bottomHeight, TEXT_SCALE);
			gl.PopAttrib(); gl.PopAttrib();
		},

		// Draws the view over the game's picture. Returns whether it did.
		// pace: { unitsPerSecond, step }, how the game is being walked
		render(pace) {
			// The map is copied while the streets are shown; in an encounter the
			// copy serves (the encounter's code lies over the map), and the
			// monster is drawn over the view; in a building or on another
			// screen the game's picture is left alone
			if (onStreets()) takeMap();
			else if (!cityScreen() || !mapTaken) { tracking = false; stats.skipped++; return false; }
			stats.drawn++;
			gameLaw = this.options.gameLaw;
			sampleColours();
			buildTextures(this.options.smoothTextures);

			const cx = mem[CELL_X], cy = mem[CELL_Y], facing = mem[FACING] & 3;
			// The eye: along the facing, the position byte less 36 from the
			// cell's entered edge; across, the middle of the cell, as the
			// game's own renderer has it
			// half a unit into the cell at its entered edge, and half a unit short
			// of its far edge at position 72, where the game stands against a
			// wall and draws it over the whole picture (*measured*: tc12.a8s): an
			// eye on the wall's plane would look through it into the next cell
			const along = Math.min(CELL - 0.5, Math.max(0, mem[POSITION] - 36) + 0.5);
			const x = cx * CELL + (facing === 1 ? along : facing === 3 ? CELL - along : CELL / 2);
			const z = cy * CELL + (facing === 2 ? along : facing === 0 ? CELL - along : CELL / 2);
			const yaw = facing * 90;

			if (!tracking || Math.abs(x - curX) > CELL || Math.abs(z - curZ) > CELL) {
				curX = eye.x = x; curZ = eye.z = z; prevYaw = curYaw = yaw;
				turnFrames = 1000;
				tracking = true;
			}
			const turned = yaw !== curYaw;
			if (turned) { prevYaw = curYaw; curYaw = yaw; turnFrames = 0; }
			curX = x; curZ = z;
			// The eye walks toward the game's position at the walking speed, a
			// little behind it: the game's steps land on irregular frames (its
			// loop, the disk), the eye's motion is even. It keeps about a step
			// behind, a little faster when further behind and slower when
			// nearer, so that it neither stalls nor jumps, and catches up over a
			// few frames when left far behind; after a teleport (above) or at a
			// stop it is where the game is
			const dx = curX - eye.x, dz = curZ - eye.z, dist = Math.hypot(dx, dz);
			if (dist > 0) {
				let v = pace.unitsPerSecond / 60 * Math.min(1.4, Math.max(0.7, 1 + 0.2 * (dist - pace.step) / pace.step));
				if (dist > 3 * pace.step) v = Math.max(v, dist / 3);
				const m = Math.min(1, v / dist);
				eye.x += dx * m; eye.z += dz * m;
			}
			stats.eye = `${eye.x.toFixed(2)},${eye.z.toFixed(2)}`;
			const turnT = Math.min(1, ++turnFrames / TURN_FRAMES);
			const ease = (t) => t * t * (3 - 2 * t);
			let dyaw = curYaw - prevYaw;
			if (dyaw > 180) dyaw -= 360; else if (dyaw < -180) dyaw += 360;
			const eyeYawDeg = prevYaw + dyaw * ease(turnT), eyeYaw = eyeYawDeg * Math.PI / 180;
			eye.sin = Math.sin(eyeYaw); eye.cos = Math.cos(eyeYaw);

			// Viewport: the picture's rectangle, or the wide one; the 72 x 72 pixels fill it
			const rect = this.options.wide ? WIDE_VIEW : PICTURE;
			const [vx, vy, vw, vh] = gl.GetIntegerv(gl.VIEWPORT);
			const px0 = Math.round(vx + (gx(rect[0]) + 1) / 2 * vw), px1 = Math.round(vx + (gx(rect[2]) + 1) / 2 * vw);
			const py0 = Math.round(vy + (gy(rect[3]) + 1) / 2 * vh), py1 = Math.round(vy + (gy(rect[1]) + 1) / 2 * vh);
			gl.PushAttrib(gl.ENABLE_BIT); gl.PushAttrib(gl.SCISSOR_BIT); gl.PushAttrib(gl.CURRENT_BIT);
			gl.Viewport(px0, py0, px1 - px0, py1 - py0);
			gl.Scissor(px0, py0, px1 - px0, py1 - py0);
			gl.Enable(gl.SCISSOR_TEST);
			gl.ClearColor(0, 0, 0, 1);
			gl.Clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

			const zNear = -2 * CELL, zFar = CELL * (VIEW_RANGE + 3);
			gl.MatrixMode(gl.PROJECTION); gl.PushMatrix(); gl.LoadIdentity();
			gl.Translatef(-1, 1, -(zFar + zNear) / (zFar - zNear));
			gl.Scalef(2 / PIC, -2 / PIC, -2 / (zFar - zNear));
			gl.MatrixMode(gl.MODELVIEW); gl.PushMatrix(); gl.LoadIdentity();

			gl.Disable(gl.FOG); gl.Disable(gl.CULL_FACE);
			gl.BlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			const ground = this.options.ground;
			drawBands(ground !== 0, 0, ground === 2 ? PIC_CENTRE : PIC);   // the sky, and the ground unless it is a plane
			if (this.options.skyline && (mem[WEATHER] | mem[WEATHER2]) < 3 && !raining())
				drawSkyline(textures.skyline, eyeYawDeg);
			const star = buildBackSprites(this.options.smoothTextures);
			if (star !== null) drawSprites(star);
			gl.Enable(gl.DEPTH_TEST);
			if (ground === 2) drawGround(cx, cy);
			drawWalls(cx, cy, facing, this.options.mirrored);
			const front = buildFrontSprites(this.options.smoothTextures);
			if (front !== null) drawSprites(front);

			gl.Disable(gl.DEPTH_TEST);
			gl.MatrixMode(gl.PROJECTION); gl.PopMatrix();
			gl.MatrixMode(gl.MODELVIEW); gl.PopMatrix();
			gl.Viewport(vx, vy, vw, vh);
			gl.PopAttrib(); gl.PopAttrib(); gl.PopAttrib();
			gl.Color4f(1, 1, 1, 1);
			return true;
		},
	};
}
