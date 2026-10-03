// Yoomp!: the tunnel drawn with OpenGL as a cylinder, textured with the game's
// own tile pixels as they are at that moment. From the game's source (v1.1):
//
// The picture is ANTIC mode D, 32 bytes a row, 96 rows from screen line 16, in
// the narrow playfield (128 pixels of 2 x 2 screen pixels from x = 40); the
// tunnel uses the middle 100 columns. A table made by tungen.c maps each
// pixel of the top half to an angle byte A = floor(angle / 5.625 degrees),
// 0 at 3 o'clock going counter-clockwise to 31 at 9 o'clock, and a ring
// d = floor(ir / 4), ir = 5000 / (distance from the centre in pixels) - 104.25,
// 0 at the picture's edge, 63 deep inside; the bottom half mirrors the top.
// The blitter reads texture_data at $8000: page X * 4 (X the texture block
// 0-15) holds the ring of block X in $00-$7F and the ring of block 31 - X,
// shown in the bottom half, in $80-$FF; the pixel's value is in bits 7-6, and
// the ring index is d + pos_y + 1 (pos_y at $91 advances a step a frame,
// the newest row at the far end). An angle byte's block is
// ((A >> 1) & $1C) | fold(A & 7), fold(s) = s < 4 ? s : 7 - s: each 45 degree
// tile shows its four pixel columns and then the same mirrored. The
// textures module writes block X from the map's tile ((X - 8) >> 2) & 7,
// pixel X & 3, one tile row per two rings (16 rings a tile, 4 tiles deep).
// A pixel value is a colour register: 0 COLBK (empty: the ball falls
// through), 1-3 COLPF0-2, set by the vertical blank for the next frame,
// so GTIA holds them as a frame ends.
//
// Geometry: a ring at depth z has the screen radius 5000 / z pixels, so
// ring d spans z = 104.25 + 4 d to + 4: a cylinder of radius 1 seen through
// a frustum of focal length 5000 pixels, 64 rows of 4 units of depth, the
// texture's V linear in z. The circle: 64 columns of 5.625 degrees.
//
// The pixels are taken as the blitter starts (a code injection at
// blitter_code, $0400, with Y = pos_y + 1 for the top half, | $80 for the
// bottom), not at the end of the frame: the game steps pos_y after blitting
// and, once the vertical blank has passed, writes the next frame's far row
// before the frame is over. Read at the end of the frame, the ring showed
// the oldest row, not yet rewritten, as a stray line at the far end, and
// the newest row, meant for the next frame, at the near end.

import { scale2x } from "../common.js";

const mem = a8.mem;
const TEXTURE_DATA = 0x8000, POS_Y = 0x91, DLIST = 0xCA00;
const SCREEN_W = 336, SCREEN_H = 240;
const PICTURE_X0 = 40, PICTURE_W = 256, PICTURE_H = 192;   // the picture's field on the screen; its top from the display list

// The picture's top line: the blank lines the display list starts with (two
// instructions of eight; the earthquake rewrites the first with a random
// count, which shakes the picture up and down)
function pictureTop() {
	let y = 0, p = DLIST;
	while ((mem[p] & 0x0F) === 0 && p < DLIST + 8) { y += ((mem[p] >> 4) & 7) + 1; p++; }
	return y;
}
const HALF_W = 64, HALF_H = 48, FOCAL = 5000;   // the field in the tunnel's pixels, and the projection
const Z_NEAR = 104.25, RING_DEPTH = 4, RINGS = 64, COLUMNS = 64;
const NEAR = 50, FAR = 2000;
const BLITTER_CODE = 0x0400;
// a little fog toward the dark of the far end: none up to FOG_START, FOG_FAR of it at the far end
const FOG_START = Z_NEAR + 60, FOG_FAR = 0.45;

const block = (A) => { const s = A & 7; return ((A >> 1) & 0x1C) | (s < 4 ? s : 7 - s); };
// the texture_data offset of column k (of 64 around) at ring 0
const columnBase = Array.from({ length: COLUMNS }, (_, k) => k < 32 ? block(k) * 0x400 : block(63 - k) * 0x400 + 0x80);

export function createTunnel() {
	const values = new Uint8Array(COLUMNS * RINGS);   // [ring][column], pixel values 0-3, as blitted
	let colours = [0, 0, 0, 0], read = false, texture = null, textureSmooth = null;

	// The pixel values and colours the blitter is about to draw with, from the game's ring buffer
	function snapshot(shift) {
		for (let d = 0; d < RINGS; d++) {
			const ring = (d + shift) & 0x7F, row = d * COLUMNS;
			for (let k = 0; k < COLUMNS; k++) values[row + k] = mem[TEXTURE_DATA + columnBase[k] + ring] >> 6;
		}
		const g = a8.gtia;
		colours = [g.colbk, g.colpf0, g.colpf1, g.colpf2].map((c) => a8.palette[c]);
		read = true;
	}

	// The texture: the values as colours; smooth: Scale2x twice and linear filtering
	function upload(smooth) {
		let w = COLUMNS, h = RINGS, picture = values;
		if (smooth) { picture = scale2x(picture, w, h); w *= 2; h *= 2; picture = scale2x(picture, w, h); w *= 2; h *= 2; }
		if (texture === null || textureSmooth !== smooth) { texture = gl.createTexture(w, h); textureSmooth = smooth; }
		const px = texture.pixels;
		for (let i = 0, o = 0; i < picture.length; i++, o += 4) {
			const c = colours[picture[i]];
			px[o] = c >> 16; px[o + 1] = (c >> 8) & 255; px[o + 2] = c & 255; px[o + 3] = 255;
		}
		texture.finalize();
		gl.TexParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
		gl.TexParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.TexParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, smooth ? gl.LINEAR : gl.NEAREST);
		gl.TexParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, smooth ? gl.LINEAR : gl.NEAREST);
	}

	return {
		hooks: [BLITTER_CODE],
		onCodeInjection(pc, op) {
			if (pc === BLITTER_CODE && !(a8.cpu.y & 0x80)) snapshot(a8.cpu.y);   // the top half's call, first of the two
			return op;
		},

		// Draws the tunnel over the game's: call from onPostGlFrame during the game.
		// fog: a little fog toward the dark at the far end
		render({ smooth, fog }) {
			if (!read) snapshot(mem[POS_Y] + 1);   // before the blitter was seen (a state just loaded)
			upload(smooth);
			const [vx, vy, vw, vh] = gl.GetIntegerv(gl.VIEWPORT), top = pictureTop();
			const px0 = Math.round(vx + PICTURE_X0 / SCREEN_W * vw), px1 = Math.round(vx + (PICTURE_X0 + PICTURE_W) / SCREEN_W * vw);
			const py0 = Math.round(vy + (1 - (top + PICTURE_H) / SCREEN_H) * vh), py1 = Math.round(vy + (1 - top / SCREEN_H) * vh);
			gl.PushAttrib(gl.ALL_ATTRIB_BITS);
			gl.Viewport(px0, py0, px1 - px0, py1 - py0);
			gl.Scissor(px0, py0, px1 - px0, py1 - py0); gl.Enable(gl.SCISSOR_TEST);
			gl.Disable(gl.DEPTH_TEST); gl.Disable(gl.BLEND); gl.Disable(gl.LIGHTING); gl.Disable(gl.CULL_FACE);
			const zEnd = Z_NEAR + RING_DEPTH * RINGS;
			if (fog) { gl.Enable(gl.FOG); gl.Fogf(gl.FOG_MODE, gl.LINEAR); gl.Fogf(gl.FOG_START, FOG_START); gl.Fogf(gl.FOG_END, FOG_START + (zEnd - FOG_START) / FOG_FAR); gl.Fogfv(gl.FOG_COLOR, [0, 0, 0, 1]); }
			else gl.Disable(gl.FOG);
			gl.Enable(gl.TEXTURE_2D); gl.BindTexture(gl.TEXTURE_2D, texture.id);
			gl.MatrixMode(gl.PROJECTION); gl.PushMatrix(); gl.LoadIdentity();
			gl.Frustum(-HALF_W / FOCAL * NEAR, HALF_W / FOCAL * NEAR, -HALF_H / FOCAL * NEAR, HALF_H / FOCAL * NEAR, NEAR, FAR);
			gl.MatrixMode(gl.MODELVIEW); gl.PushMatrix(); gl.LoadIdentity();
			gl.Color4f(1, 1, 1, 1);
			// the cylinder: a quad a column, from the nearest ring to beyond the farthest
			const zNear = -Z_NEAR, zFar = -(Z_NEAR + RING_DEPTH * RINGS);
			gl.Begin(gl.QUADS);
			for (let k = 0; k < COLUMNS; k++) {
				const a0 = k / COLUMNS * 2 * Math.PI, a1 = (k + 1) / COLUMNS * 2 * Math.PI;
				const x0 = Math.cos(a0), y0 = Math.sin(a0), x1 = Math.cos(a1), y1 = Math.sin(a1), u0 = k / COLUMNS, u1 = (k + 1) / COLUMNS;
				gl.TexCoord2f(u0, 0); gl.Vertex3f(x0, y0, zNear);
				gl.TexCoord2f(u1, 0); gl.Vertex3f(x1, y1, zNear);
				gl.TexCoord2f(u1, 1); gl.Vertex3f(x1, y1, zFar);
				gl.TexCoord2f(u0, 1); gl.Vertex3f(x0, y0, zFar);
			}
			gl.End();
			gl.MatrixMode(gl.PROJECTION); gl.PopMatrix();
			gl.MatrixMode(gl.MODELVIEW); gl.PopMatrix();
			gl.PopAttrib();
			gl.Color4f(1, 1, 1, 1);
		},
	};
}
