// An automatic map for a maze game: the cells the player visits and the ones
// seen ahead are remembered and shown over the screen (walls, doors, the
// player, cells coloured by their kind and named from the game's own
// location line, marks set with the digit keys) or, in a browser, at the
// bottom of the page's panel. The game is described to it by an adapter (the
// altreal and altreal-city extensions each have one): where the map and the
// player are and what the cells mean.
//
// game = {
//   tag,                       the log prefix
//   dir,                       the directory of the records (a file per character)
//   size, levels, kinds,       cells a side (32, 64), levels (7, 1), distinct kinds (64, 256)
//   name(),                    the character's name
//   level(), cell(), facing(), the level (1-based), [x, y], 0 north (-y) 1 east 2 south 3 west
//   walls(x, y),               [n, e, s, w] codes of the cell's sides
//   wallColour(code),          [r, g, b] for a side, or null for an open one
//   seeThrough(code),          whether a side lets the eye through (the cells ahead are "seen")
//   kind(x, y), special(x, y), the cell's kind (0..kinds-1) and whether it is marked special
//   tracking(),                whether the maze is on the screen (visits are tracked then)
//   locationLine(),            the text that names the current cell's kind ("a corridor"), or null
//   font, glyph(code),         the address of the game's 1 KB text font, and the glyph for a character code
// }
//
// Record layout: 0-5 "ARMAP1"; from 1024, a byte per cell per level
// (bit 7 visited, bit 6 seen, bits 0-2 mark 0-7) at (level - 1) * size *
// size + y * size + x; then the kinds' names, 32 bytes each, zero padded
// (the Dungeon's files from before this module was shared read the same).

import * as std from "std";
import * as os from "os";

const MAGIC = "ARMAP1", CELLS = 1024, NAME_SIZE = 32;
const VISITED = 0x80, SEEN = 0x40, MARK = 0x07;
const SEE_RANGE = 10;                      // cells seen down a corridor
const NAME_DELAY = 12;                     // frames after entering a cell before its line is read
const SAVE_QUIET = 120, SAVE_LATEST = 600; // frames: save after a pause in the changes, or at least this often
const CLEAR_ARMED_FRAMES = 180;            // frames in which a second X clears the map
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];   // by facing

export function createAutomap(game) {
	const mem = a8.mem, N = game.size, LEVEL_SIZE = N * N;
	const NAMES = CELLS + game.levels * LEVEL_SIZE;
	const RECORD_SIZE = NAMES + game.kinds * NAME_SIZE;

	/* ------------------------------ the record ------------------------------ */

	let store = null, storeName = null, dirty = false, quiet = 0, dirtyFor = 0, version = 0;   // version: counts the changes, for the panel

	const safeName = () => (game.name() || "").trim().replace(/[^A-Za-z0-9_-]/g, "_") || "unnamed";

	// The current character's record, loaded from its file on first use and
	// whenever the character changes (another state loaded)
	function record() {
		const name = safeName();
		if (store !== null && name === storeName) return store;
		if (store !== null && dirty) save();
		storeName = name; store = new Uint8Array(RECORD_SIZE); dirty = false; version++;
		const f = std.open(`${game.dir}/${name}.map`, "rb");
		if (f !== null) { f.read(store.buffer, 0, RECORD_SIZE); f.close(); }
		if (String.fromCharCode(...store.subarray(0, MAGIC.length)) !== MAGIC) {
			store.fill(0);
			for (let i = 0; i < MAGIC.length; i++) store[i] = MAGIC.charCodeAt(i);
		}
		let known = 0;
		for (let i = CELLS; i < NAMES; i++) if (store[i] & (VISITED | SEEN)) known++;
		console.log(`${game.tag}: map of ${name}: ${f !== null ? known + " cells known" : "new"} (${game.dir}/${name}.map)`);
		return store;
	}

	function save() {
		os.mkdir(game.dir);   // no harm when it exists
		const f = std.open(`${game.dir}/${storeName}.map`, "wb");
		if (f === null) console.log(`${game.tag}: cannot write ${game.dir}/${storeName}.map`);
		else { f.write(store.buffer, 0, RECORD_SIZE); f.close(); }
		dirty = false; quiet = 0; dirtyFor = 0;
	}

	// Forgets the whole map of the character: every level, the marks and the
	// kinds' names (the file is written at once)
	function clear() {
		const s = record();
		s.fill(0);
		for (let i = 0; i < MAGIC.length; i++) s[i] = MAGIC.charCodeAt(i);
		dirty = true; version++;
		save();
		lastCell = -1;   // the current cell is visited again on the next frame
		console.log(`${game.tag}: map of ${storeName} cleared`);
	}

	// Writes a byte of the record, noting the change
	function put(i, v) {
		const s = record();
		if (s[i] === v) return;
		s[i] = v; dirty = true; quiet = 0; version++;
	}

	const cellIndex = (level, x, y) => level >= 1 && level <= game.levels && x >= 0 && x < N && y >= 0 && y < N ? CELLS + (level - 1) * LEVEL_SIZE + y * N + x : -1;

	function kindName(kind) {
		const s = record(), o = NAMES + kind * NAME_SIZE;
		let t = "";
		for (let i = 0; i < NAME_SIZE && s[o + i]; i++) t += String.fromCharCode(s[o + i]);
		return t;
	}

	function setKindName(kind, name) {
		const o = NAMES + kind * NAME_SIZE;
		for (let i = 0; i < NAME_SIZE; i++) put(o + i, i < name.length ? name.charCodeAt(i) & 0x7F : 0);
	}

	const kindOf = (x, y) => game.kind(x, y) % game.kinds;

	/* ------------------------------ tracking ------------------------------ */

	let lastCell = -1, nameCountdown = 0, nameKind = -1;
	let clearArmed = 0;   // frames left in which a second X clears the map (the overlay says so)

	// Call every frame: marks the player's cell visited, the corridor ahead
	// seen, and reads the location line for a kind not yet named
	function track() {
		if (clearArmed > 0) clearArmed--;
		if (!game.tracking()) return;
		const s = record(), level = game.level(), [x, y] = game.cell(), f = game.facing() & 3;
		const i = cellIndex(level, x, y);
		if (i < 0) return;
		put(i, s[i] | VISITED);
		let cx = x, cy = y;
		for (let n = 0; n < SEE_RANGE; n++) {
			if (!game.seeThrough(game.walls(cx, cy)[f])) break;
			cx += DX[f]; cy += DY[f];
			const j = cellIndex(level, cx, cy);
			if (j < 0) break;
			put(j, s[j] | SEEN);
		}
		if (dirty && (++quiet >= SAVE_QUIET || ++dirtyFor >= SAVE_LATEST)) save();
		if (i !== lastCell) {
			lastCell = i;
			nameKind = kindOf(x, y);
			nameCountdown = kindName(nameKind) ? 0 : NAME_DELAY;
		}
		if (nameCountdown > 0 && --nameCountdown === 0) {
			const line = game.locationLine();
			if (line) setKindName(nameKind, line);
		}
	}

	/* ------------------------------ drawing ------------------------------ */

	let fontTexture = null;

	// The game's text font as a 128 x 64 texture, 16 glyphs a row (indexed by
	// the character code, through game.glyph); white on transparent
	function font() {
		if (fontTexture !== null) return fontTexture;
		const t = gl.createTexture(128, 64), px = t.pixels;
		for (let c = 0; c < 128; c++) {
			const g = game.glyph(c);
			for (let row = 0; row < 8; row++) {
				const b = g < 0 ? 0 : mem[game.font + g * 8 + row];
				for (let bit = 0; bit < 8; bit++) {
					const o = 4 * (((c >> 4) * 8 + row) * 128 + (c & 15) * 8 + bit), on = (b >> (7 - bit)) & 1;
					px[o] = px[o + 1] = px[o + 2] = 255; px[o + 3] = on ? 255 : 0;
				}
			}
		}
		t.finalize();
		gl.TexParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.TexParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		fontTexture = t;
		return t;
	}

	function rect(x0, y0, x1, y1) {
		gl.Vertex3f(x0, y0, 0); gl.Vertex3f(x1, y0, 0); gl.Vertex3f(x1, y1, 0); gl.Vertex3f(x0, y1, 0);
	}

	// Text in pixels, glyphs of 8 * scale, in the game's font
	function text(str, x, y, scale, r, g, b) {
		gl.Enable(gl.TEXTURE_2D); gl.Enable(gl.BLEND);
		gl.BindTexture(gl.TEXTURE_2D, font().id);
		gl.Color4f(r, g, b, 1);
		gl.Begin(gl.QUADS);
		for (let i = 0; i < str.length; i++) {
			const c = str.charCodeAt(i) & 0x7F;
			const u0 = (c & 15) / 16, v0 = (c >> 4) / 8, u1 = u0 + 1 / 16, v1 = v0 + 1 / 8;
			const px = x + i * 8 * scale;
			gl.TexCoord2f(u0, v0); gl.Vertex3f(px, y, 0);
			gl.TexCoord2f(u1, v0); gl.Vertex3f(px + 8 * scale, y, 0);
			gl.TexCoord2f(u1, v1); gl.Vertex3f(px + 8 * scale, y + 8 * scale, 0);
			gl.TexCoord2f(u0, v1); gl.Vertex3f(px, y + 8 * scale, 0);
		}
		gl.End();
		gl.Disable(gl.TEXTURE_2D);
	}

	// A colour per kind: hues spread around the wheel
	function kindColour(kind, v) {
		const h = ((kind * 47) % 360) / 60, sat = 0.55, c = v * sat, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c;
		const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h) % 6];
		return [r + m, g + m, b + m];
	}
	const MARK_COLOURS = [null, [1, 0.3, 0.3], [1, 0.6, 0.2], [1, 1, 0.3], [0.4, 1, 0.4], [0.3, 1, 1], [0.5, 0.6, 1], [1, 0.5, 1]];

	// Draws the map of the current level over the whole window. The map lies
	// over the picture as it is: nothing is shaded. Only the known cells are
	// drawn, and each line of text gets a dark strip behind it
	function draw() {
		const s = record(), level = game.level(), [cx, cy] = game.cell(), facing = game.facing() & 3;
		const [vx, vy, vw, vh] = gl.GetIntegerv(gl.VIEWPORT);
		gl.PushAttrib(gl.ENABLE_BIT); gl.PushAttrib(gl.CURRENT_BIT);
		gl.MatrixMode(gl.PROJECTION); gl.PushMatrix(); gl.LoadIdentity();
		gl.Translatef(-1, 1, 0); gl.Scalef(2 / vw, -2 / vh, 1);           // pixels, y down
		gl.MatrixMode(gl.MODELVIEW); gl.PushMatrix(); gl.LoadIdentity();
		gl.Disable(gl.DEPTH_TEST); gl.Disable(gl.FOG); gl.Disable(gl.TEXTURE_2D);
		gl.Enable(gl.BLEND); gl.BlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

		// the grid: square cells, the map at the left, text to its right
		const ts = Math.max(1, Math.floor(vh / 240)), margin = 8 * ts;
		const cs = Math.max(1, Math.floor(Math.min(vh - 2 * margin, vw * 0.62) / N));
		const mx = margin, my = Math.floor((vh - N * cs) / 2), w = Math.max(1, Math.floor(cs / 6));
		const lx = mx + N * cs + 2 * margin;
		const label = (str, x, y, scale, r, g, b) => {
			gl.Disable(gl.TEXTURE_2D); gl.Enable(gl.BLEND);
			gl.Color4f(0, 0, 0, 0.7);
			gl.Begin(gl.QUADS); rect(x - 2 * scale, y - scale, x + 8 * scale * str.length + 2 * scale, y + 9 * scale); gl.End();
			text(str, x, y, scale, r, g, b);
		};
		const known = [];
		for (let y = 0; y < N; y++)
			for (let x = 0; x < N; x++) {
				const i = cellIndex(level, x, y), b = i < 0 ? 0 : s[i];
				if (!(b & (VISITED | SEEN))) continue;
				const kind = kindOf(x, y);
				if (!known.includes(kind)) known.push(kind);
				const [r, g, bl] = kindColour(kind, b & VISITED ? 0.75 : 0.35);
				const x0 = mx + x * cs, y0 = my + y * cs;
				gl.Color4f(r, g, bl, 1);
				gl.Begin(gl.QUADS); rect(x0, y0, x0 + cs, y0 + cs); gl.End();
				if (game.special(x, y)) {
					gl.Color4f(1, 1, 1, 1);
					gl.Begin(gl.QUADS); rect(x0 + cs * 0.4, y0 + cs * 0.4, x0 + cs * 0.6, y0 + cs * 0.6); gl.End();
				}
				const walls = game.walls(x, y), x1 = x0 + cs, y1 = y0 + cs;
				const sides = [[x0, y0, x1, y0 + w], [x1 - w, y0, x1, y1], [x0, y1 - w, x1, y1], [x0, y0, x0 + w, y1]];
				for (let k = 0; k < 4; k++) {
					const c = game.wallColour(walls[k]);
					if (c === null) continue;
					gl.Color4f(c[0], c[1], c[2], 1);
					gl.Begin(gl.QUADS); rect(...sides[k]); gl.End();
				}
				const mark = b & MARK;
				if (mark) {
					const c = MARK_COLOURS[mark];
					gl.Color4f(c[0], c[1], c[2], 1);
					gl.Begin(gl.QUADS); rect(x0 + w, y0 + w, x1 - w, y1 - w); gl.End();
					const fs = Math.max(1, Math.floor(cs / 10));
					if (cs >= 8) text(String(mark), x0 + (cs - 8 * fs) / 2, y0 + (cs - 8 * fs) / 2, fs, 0, 0, 0);
					gl.Disable(gl.TEXTURE_2D);
				}
			}
		// the player: a triangle pointing the way it faces
		{
			const px = mx + cx * cs + cs / 2, py = my + cy * cs + cs / 2, f = facing, r = Math.max(2, cs * 0.38);
			const tip = [px + DX[f] * r, py + DY[f] * r], base = [px - DX[f] * r * 0.6, py - DY[f] * r * 0.6];
			const side = [DY[f] * r * 0.6, -DX[f] * r * 0.6];
			gl.Color4f(1, 1, 1, 1);
			gl.Begin(gl.TRIANGLES);
			gl.Vertex3f(tip[0], tip[1], 0); gl.Vertex3f(base[0] + side[0], base[1] + side[1], 0); gl.Vertex3f(base[0] - side[0], base[1] - side[1], 0);
			gl.End();
		}
		// the legend, in the room right of the map: a text size that fits 26 characters
		const lw = vw - lx - margin;
		const ls = Math.max(1, Math.floor(lw / (8 * 26))), lh = 10 * ls;
		const fit = (str, x) => str.slice(0, Math.max(0, Math.floor((vw - margin - x) / (8 * ls))));   // what fits before the right margin
		let ly = my;
		if (game.levels > 1) { label(`Level ${level}`, lx, ly, ls, 1, 1, 1); ly += lh * 1.5; }
		known.sort((a, b) => a - b);
		for (const kind of known.slice(0, Math.max(0, Math.floor((vh - my - ly - 4 * lh) / lh)))) {
			const [r, g, b] = kindColour(kind, 0.75);
			label(fit(kindName(kind) || `kind ${kind}`, lx + 12 * ls), lx + 12 * ls, ly, ls, 0.9, 0.9, 0.9);
			gl.Disable(gl.TEXTURE_2D);
			gl.Color4f(r, g, b, 1);
			gl.Begin(gl.QUADS); rect(lx, ly, lx + 8 * ls, ly + 8 * ls); gl.End();
			ly += lh;
		}
		ly = vh - my - 3 * lh;
		label(fit("Marks: 1-7 set, 0 clear", lx), lx, ly, ls, 0.7, 0.7, 0.7);
		if (clearArmed > 0) label(fit("X again: clear whole map", lx), lx, ly + lh, ls, 1, 0.5, 0.4);
		else label(fit("X clears the whole map", lx), lx, ly + lh, ls, 0.7, 0.7, 0.7);
		label(fit("M closes the map", lx), lx, ly + 2 * lh, ls, 0.7, 0.7, 0.7);

		gl.MatrixMode(gl.PROJECTION); gl.PopMatrix();
		gl.MatrixMode(gl.MODELVIEW); gl.PopMatrix();
		gl.PopAttrib(); gl.PopAttrib();
		gl.Color4f(1, 1, 1, 1);
	}

	/* ------------------------------ the map in the page's panel ------------------------------ */

	let panelCanvas = null, panelButton = null, panelKey = "";
	const PANEL_FONT = "11px ui-monospace, Menlo, Consolas, monospace", LINE = 15;

	// In a browser: the current level's map at the bottom of the page's panel
	// for the extension (a8.panel), while on; drawn again when the record, the
	// level, the player or the panel's width change. The same map as draw()'s,
	// with the page's text, and a button that clears the map
	function panel(on) {
		if (!a8.panel) return;
		if (!on) {
			if (panelCanvas !== null) { panelCanvas.remove(); panelButton.remove(); panelCanvas = panelButton = null; panelKey = ""; }
			return;
		}
		if (panelCanvas === null) {
			panelCanvas = document.createElement("canvas");
			panelCanvas.style.cssText = "display: block; width: 100%; margin-top: 10px; image-rendering: pixelated;";
			a8.panel.append(panelCanvas);
			panelButton = document.createElement("button");
			panelButton.textContent = "Clear the whole map";
			panelButton.addEventListener("click", () => {
				if (confirm(`Forget the whole map of ${safeName()}: ${game.levels > 1 ? "every level, " : ""}the marks and the names?`)) clear();
				panelButton.blur();
			});
			a8.panel.append(panelButton);
		}
		const s = record(), level = game.level(), [cx, cy] = game.cell(), facing = game.facing() & 3, width = panelCanvas.clientWidth || 256;
		const key = `${level}:${cx}:${cy}:${facing}:${version}:${width}:${game.panelKey ? game.panelKey() : ""}`;
		if (key === panelKey) return;
		panelKey = key;

		const known = [];
		for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
			const i = cellIndex(level, x, y);
			if (i >= 0 && (s[i] & (VISITED | SEEN))) { const kind = kindOf(x, y); if (!known.includes(kind)) known.push(kind); }
		}
		known.sort((a, b) => a - b);
		const cs = Math.max(2, Math.floor(width / N)), mapSize = N * cs, mx = Math.floor((width - mapSize) / 2);
		const height = mapSize + 6 + LINE * (3 + known.length) + 4;
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		panelCanvas.width = Math.round(width * dpr); panelCanvas.height = Math.round(height * dpr); panelCanvas.style.height = height + "px";
		const ctx = panelCanvas.getContext("2d");
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = "#000"; ctx.fillRect(mx, 0, mapSize, mapSize);
		const colour = ([r, g, b]) => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
		const w = Math.max(1, Math.floor(cs / 6));
		ctx.font = PANEL_FONT; ctx.textBaseline = "middle";
		for (let y = 0; y < N; y++)
			for (let x = 0; x < N; x++) {
				const i = cellIndex(level, x, y), b = i < 0 ? 0 : s[i];
				if (!(b & (VISITED | SEEN))) continue;
				const x0 = mx + x * cs, y0 = y * cs;
				ctx.fillStyle = colour(kindColour(kindOf(x, y), b & VISITED ? 0.75 : 0.35));
				ctx.fillRect(x0, y0, cs, cs);
				if (game.special(x, y)) { ctx.fillStyle = "#fff"; ctx.fillRect(x0 + cs * 0.4, y0 + cs * 0.4, cs * 0.2, cs * 0.2); }
				const walls = game.walls(x, y);
				const sides = [[x0, y0, cs, w], [x0 + cs - w, y0, w, cs], [x0, y0 + cs - w, cs, w], [x0, y0, w, cs]];
				for (let k = 0; k < 4; k++) {
					const c = game.wallColour(walls[k]);
					if (c !== null) { ctx.fillStyle = colour(c); ctx.fillRect(...sides[k]); }
				}
				const mark = b & MARK;
				if (mark) {
					ctx.fillStyle = colour(MARK_COLOURS[mark]); ctx.fillRect(x0 + w, y0 + w, cs - 2 * w, cs - 2 * w);
					if (cs >= 7) { ctx.fillStyle = "#000"; ctx.font = `${cs - 2}px ui-monospace, Menlo, Consolas, monospace`; ctx.textAlign = "center"; ctx.fillText(String(mark), x0 + cs / 2, y0 + cs / 2 + 1); ctx.font = PANEL_FONT; ctx.textAlign = "left"; }
				}
			}
		// the player: a triangle pointing the way it faces
		{
			const px = mx + cx * cs + cs / 2, py = cy * cs + cs / 2, f = facing, r = Math.max(2, cs * 0.45);
			ctx.fillStyle = "#fff"; ctx.beginPath();
			ctx.moveTo(px + DX[f] * r, py + DY[f] * r);
			ctx.lineTo(px - DX[f] * r * 0.6 + DY[f] * r * 0.6, py - DY[f] * r * 0.6 - DX[f] * r * 0.6);
			ctx.lineTo(px - DX[f] * r * 0.6 - DY[f] * r * 0.6, py - DY[f] * r * 0.6 + DX[f] * r * 0.6);
			ctx.closePath(); ctx.fill();
		}
		// the legend below
		let ly = mapSize + 6 + LINE / 2;
		ctx.fillStyle = "#d8d8d0";
		if (game.levels > 1) { ctx.fillText(`Level ${level}`, 0, ly); ly += LINE; }
		for (const kind of known) {
			ctx.fillStyle = colour(kindColour(kind, 0.75)); ctx.fillRect(0, ly - 5, 10, 10);
			ctx.fillStyle = "#d8d8d0"; ctx.fillText(kindName(kind) || `kind ${kind}`, 16, ly);
			ly += LINE;
		}
		ctx.fillStyle = "#8a8a80"; ctx.fillText("Marks: 1-7 set, 0 clear", 0, ly); ly += LINE;
		ctx.fillText("M: the map over the screen", 0, ly);
	}

	return {
		shown: false,
		// A key the adapter recognised: "toggle" (M), "clear" (X), or a mark 0-7
		onKey(key) {
			if (key === "toggle") this.shown = !this.shown;
			else if (key === "clear") {
				if (!this.shown) return;
				if (clearArmed > 0) { clear(); clearArmed = 0; }
				else clearArmed = CLEAR_ARMED_FRAMES;
			}
			else if (typeof key === "number" && (this.shown || panelCanvas !== null)) {
				const [x, y] = game.cell(), i = cellIndex(game.level(), x, y);
				if (i >= 0) put(i, (record()[i] & ~MARK) | key);
			}
		},
		track, draw, panel, clear,
	};
}
