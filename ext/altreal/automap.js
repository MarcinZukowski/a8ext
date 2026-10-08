// Alternate Reality: The Dungeon - the automatic map (the shared automap.js
// at the root of the extensions, with this game's addresses). The cells the
// player visits and the ones seen down the corridor ahead are remembered;
// the M key shows the current level's map over the screen, the digit keys
// mark the player's cell, X twice clears the whole map; in a browser the
// menu's "Show map" keeps the map in the page's panel (see altreal.md, "The
// automatic map").
//
// The record is a file per character in this directory's maps/, written
// when it changes: the saved states of this game are 64 KB machines without
// extended memory to keep it in, and a file survives states, restarts and
// the emulator's save and load alike.

import { createAutomap } from "../automap.js";

const MAP = 0xB000, CELL_X = 0x6313, CELL_Y = 0x6314, LEVEL = 0x6315, FACING = 0x6312;
const SCREEN_STATE = 0x7600;               // 0 maze, 1 encounter: the map is kept up in these
const SECRET_DOORS_SHOWN = 0x1957;
const LOCATION_ROW = 0x04A0;               // the text row with "You are in a ..."
const KEY_DISPATCH = 0x30AA;               // the main loop has just fetched a command letter into A
const TEXT_FONT = 0x1400;                  // the game's text font: 128 glyphs of 8 bytes in ASCII order (the OS ROM is off)
const NAME = 0x6321, NAME_LEN = 16;        // the character's name in the stats block

const mem = a8.mem;

function characterName() {
	let t = "";
	for (let i = 0; i < NAME_LEN; i++) {
		const c = mem[NAME + i] & 0x7F;
		if (c < 32 || c > 126) break;
		t += String.fromCharCode(c);
	}
	return t;
}

// The level: 32 x 32 cells of 4 bytes at $B000 + y * 128 + x * 4: wall
// nibbles (north, east; south, west), the type, the flags (bit 7 special)
function cellWalls(x, y) {
	if (x < 0 || x > 31 || y < 0 || y > 31) return [13, 13, 13, 13];
	const a = MAP + y * 128 + x * 4;
	return [mem[a] & 0xF, mem[a] >> 4, mem[a + 1] & 0xF, mem[a + 1] >> 4];   // N, E, S, W
}

// The side of a cell as a strip of the given colour by wall type; null = nothing
function wallColour(n) {
	if (n === 0) return null;
	if (n === 1 || n === 2) return [0.4, 0.8, 1];                       // arch
	if (n === 3 || n === 4) return [1, 0.85, 0.3];                      // door
	if (n >= 8 && n <= 10) return [1, 0.4, 0.4];                        // locked door
	if ((n === 5 || n === 6) && (mem[SECRET_DOORS_SHOWN] & 0x80)) return [1, 0.85, 0.3];   // secret door, revealed
	return [0.9, 0.9, 0.9];                                             // wall
}

function locationLine() {
	let line = "";
	for (let k = 0; k < 40; k++) { const c = mem[LOCATION_ROW + k] & 0x7F; line += c >= 32 && c < 127 ? String.fromCharCode(c) : " "; }
	line = line.trim().replace(/\.$/, "");
	return line.startsWith("You are ") ? line.slice(8) : null;
}

const map = createAutomap({
	tag: "altreal",
	dir: `${a8.extDir}/maps`,
	size: 32, levels: 7, kinds: 64,
	name: characterName,
	level: () => mem[LEVEL],
	cell: () => [mem[CELL_X], mem[CELL_Y]],
	facing: () => mem[FACING] & 3,
	walls: cellWalls,
	wallColour,
	seeThrough: (n) => n === 0 || n === 1 || n === 2,   // open, or an arch
	kind: (x, y) => mem[MAP + y * 128 + x * 4 + 2],
	special: (x, y) => (mem[MAP + y * 128 + x * 4 + 3] & 0x80) !== 0,
	tracking: () => mem[SCREEN_STATE] <= 1,
	locationLine,
	font: TEXT_FONT, glyph: (c) => c,   // the font is in ASCII order
	panelKey: () => mem[SECRET_DOORS_SHOWN] & 0x80,
});

export const automap = {
	get shown() { return map.shown; },
	hooks: [KEY_DISPATCH],

	// The main loop fetched a command letter into A: M toggles the map over
	// the screen, a digit marks the player's cell while a map is shown, and X
	// twice within three seconds, with the map over the screen, clears the
	// whole map; none is a game command (the game's are C D E U P G S Q)
	onCodeInjection(pc, op) {
		if (pc !== KEY_DISPATCH) return op;
		const key = a8.cpu.a;
		if (key === 0x6D) map.onKey("toggle");
		else if (key >= 0x30 && key <= 0x37) map.onKey(key - 0x30);
		else if (key === 0x78) map.onKey("clear");
		return op;
	},

	track: () => map.track(),
	draw: () => map.draw(),
	panel: (on) => map.panel(on),
	clear: () => map.clear(),
};
