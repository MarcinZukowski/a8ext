// Alternate Reality: The City - the automatic map (the shared automap.js at
// the root of the extensions, with this game's addresses): the cells walked
// and seen down the street ahead, the M key for the map over the screen,
// the digit keys for marks, X twice to clear it; in a browser the menu's
// "Show map" keeps the map in the page's panel. The city is one level of
// 64 x 64 cells, and its map is in memory whole (altreal-city.md, "The map"):
// a byte per cell at $0800 + y * 64 + x with the four sides in two bits
// each (north in bits 0-1, east 2-3, south 4-5, west 6-7: 0 open, 1 wall,
// 3 a door or an event), and the cell's kind at $1800 + the same offset.
// The game keeps no character name in memory, so the record is one file,
// city.map, for every character.

import { createAutomap } from "../automap.js";
import { onStreets } from "./view3d.js";

const WALLS = 0x0800, KINDS = 0x1800;
const CELL_X = 0x8924, CELL_Y = 0x8925, FACING = 0x892B;
const LOCATION_ROW = 0x35D8 + 5 * 40;      // "You are at the Floating Gate"
const TEXT_FONT = 0x2800;                   // the game's text font (CHBASE): internal codes, lower case as ASCII
const KEY_READ = 0x64C9;                    // the main loop has a key's code (KBCODE) in A, while it is held
const KEY_M = 0x25, KEY_X = 0x16, KEY_DIGITS = { 0x32: 0, 0x1F: 1, 0x1E: 2, 0x1A: 3, 0x18: 4, 0x1D: 5, 0x1B: 6, 0x33: 7 };

const mem = a8.mem;

function cellWalls(x, y) {
	if (x < 0 || x > 63 || y < 0 || y > 63) return [1, 1, 1, 1];
	const b = mem[WALLS + y * 64 + x];
	return [b & 3, (b >> 2) & 3, (b >> 4) & 3, (b >> 6) & 3];   // N, E, S, W
}

function wallColour(n) {
	if (n === 0) return null;
	if (n === 3) return [1, 0.85, 0.3];      // a door, or an event on the way through
	if (n === 2) return [0.4, 0.8, 1];       // (not met yet)
	return [0.9, 0.9, 0.9];                  // wall
}

// The game's text: internal codes for capitals, digits and signs ($00-$3F,
// ASCII - $20), ASCII for lower case
const decode = (c) => (c &= 0x7F) < 0x40 ? c + 0x20 : c;
const glyph = (c) => c >= 0x60 ? c : c >= 0x20 && c < 0x60 ? c - 0x20 : -1;

function locationLine() {
	let line = "";
	for (let k = 0; k < 40; k++) { const c = decode(mem[LOCATION_ROW + k]); line += c >= 32 && c < 127 ? String.fromCharCode(c) : " "; }
	line = line.trim().replace(/\.$/, "");
	return line.startsWith("You are ") ? line.slice(8) : null;
}

const map = createAutomap({
	tag: "altreal-city",
	dir: `${a8.extDir}/maps`,
	size: 64, levels: 1, kinds: 256,
	name: () => "city",
	level: () => 1,
	cell: () => [mem[CELL_X], mem[CELL_Y]],
	facing: () => mem[FACING] & 3,
	walls: cellWalls,
	wallColour,
	seeThrough: (n) => n === 0,
	kind: (x, y) => mem[KINDS + y * 64 + x],
	special: (x, y) => { const b = mem[WALLS + y * 64 + x]; return (b & 3) === 3 || ((b >> 2) & 3) === 3 || ((b >> 4) & 3) === 3 || ((b >> 6) & 3) === 3; },
	tracking: onStreets,   // a building's or an encounter's data lies over the map otherwise
	locationLine,
	font: TEXT_FONT, glyph,
});

let heldKey = -1;   // the key seen while it is held, so that it acts once

export const automap = {
	get shown() { return map.shown; },
	hooks: [KEY_READ],

	onCodeInjection(pc, op) {
		if (pc !== KEY_READ) return op;
		const key = a8.cpu.a;
		if (key === heldKey) return op;
		heldKey = key;
		if (key === KEY_M) map.onKey("toggle");
		else if (key === KEY_X) map.onKey("clear");
		else if (key in KEY_DIGITS) map.onKey(KEY_DIGITS[key]);
		return op;
	},

	// Every frame: a key released lets the next press act
	track() {
		if (a8.peek(0xD20F) & 0x04) heldKey = -1;   // SKSTAT bit 2: no key held
		map.track();
	},
	draw: () => map.draw(),
	panel: (on) => map.panel(on),
	clear: () => map.clear(),
};
