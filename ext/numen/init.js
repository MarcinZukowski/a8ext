// Numen (Taquart, 2003) - the demo's 3D scenes run faster (the hottest code,
// found with the emulator's profile, runs in no emulated time: see
// createAccelerator in common.js), and they are drawn again with OpenGL from
// the demo's own level data and camera (world3d.js). With that off, the
// demo's picture is smoothed with Scale2x over its own pixel grid
// (../smooth2d.js). See numen.md.

import { createAccelerator } from "../common.js";
import { createSmoother } from "../smooth2d.js";
import { createWorld3D, engineMapped } from "./world3d.js";

const mem = a8.mem;
// GTIA's registers as the scene is drawn, taken at the demo's display list
// interrupts (the end part's text rows below the scene set their own after
// it). The NMI handler (the fingerprint) jumps to the DLI handler of the
// moment: the end part switches between one for the text and one for the
// scene within a frame, so every handler seen lately gets the injection
let dlis = [], sceneGtia = null;
const GTIA_REGISTERS = ["prior", "colpm0", "colpm1", "colpm2", "colpm3", "colpf0", "colpf1", "colpf2", "colpf3", "colbk"];
const accel = createAccelerator({ minShare: 0.001, maxRanges: 48, also: () => dlis });   // the hottest code down to 0.1% of the cycles
// The 3D scenes are GTIA mode 10 (PRIOR $81) in mode-F rows stretched to four
// lines by the VSCROL trick: pixels four hi-res pixels wide and four lines
// tall, 80 x 48 of them, from screen line 24 (display list $1F80, buffers at
// $1000 and $1800)
const smoother = createSmoother(4, 4);
const world = createWorld3D();
const SCENE_BUFFERS = [0x1000, 0x1800];
const MODE_LINES = [0, 0, 8, 10, 8, 16, 8, 16, 8, 4, 4, 2, 1, 2, 1, 1];   // scan lines of an ANTIC mode
// The scene's place on the screen, [x0, y0, x1, y1], from the display list:
// the mode-F rows from the LMS to one of the scene's buffers, each four lines
// by the VSCROL trick. Usually the list at $1F80, the scene from line 24; the
// end part lists text rows above and below it. Null when the scene is not shown
function findScene() {
	let p = a8.antic.dlist, y = 0;
	for (let i = 0; i < 256 && y <= 240; i++) {
		const b = mem[p], mode = b & 15;
		if (mode === 1) { if (b & 0x40) return null; p = mem[p + 1] | mem[p + 2] << 8; continue; }
		if (mode === 0) { y += ((b >> 4) & 7) + 1; p++; continue; }
		if (mode === 15 && (b & 0x40) && SCENE_BUFFERS.includes(mem[p + 1] | mem[p + 2] << 8)) {
			let rows = 1;
			for (p += 3; (mem[p] & 0x4f) === 0x0f; p++) rows++;   // mode F rows without an LMS of their own
			return [8, y, 328, y + 4 * rows];
		}
		y += MODE_LINES[mode]; p += (b & 0x40) ? 3 : 1;
	}
	return null;
}
let frame = 0, flips = 0, lastLms = -1, unmapped = 0;

export default {
	name: "NUMEN JS HACK by Eru",

	// The NMI handler, in the RAM under the OS: PHA, BIT NMIST, BPL, JMP (the JMP's operand is
	// left out: the end part repoints it between its two DLI handlers within a frame)
	fingerprint: { address: 0xFF83, bytes: [0x48, 0x2c, 0x0f, 0xd4, 0x10, 0x03, 0x4c] },

	menu: {
		ACCEL: { label: "Acceleration:", options: ["OFF", "ON"], current: 1 },
		SMOOTH: { label: "Smooth objects:", options: ["OFF", "Scale2x 4x"], current: 1 },
		WORLD: { label: "3D scene:", options: ["Atari", "OpenGL"], current: 1 },
		SHADE: { label: "Shading and fog:", options: ["OFF", "ON"], current: 1 },
		FULL: { label: "Full screen:", options: ["OFF", "ON"], current: 1 },
		GROUND: { label: "Ground texture:", options: ["OFF", "ON"], current: 1 },
		ANTIALIAS: { label: "Smooth edges:", options: ["OFF", "ON"], current: 1 },
		RATE: { label: "Log frame rate:", options: ["OFF", "ON"], current: 0 },
	},

	onPostGlFrame() {
		const scene = findScene();
		if (scene === null) return;
		const smooth = this.menu.SMOOTH.current === 1;
		const on = (name) => this.menu[name].current === 1;
		// with text above or below the scene, the whole picture is not the scene's to take
		const full = on("FULL") && scene[1] === 24 && scene[3] === 216 && a8.antic.dlist === 0x1F80;
		if (on("WORLD") && world.render({ smooth, shade: on("SHADE"), full, ground: on("GROUND"), antialias: on("ANTIALIAS"), scene, gtia: sceneGtia })) return;
		if (smooth && smoother.capture(scene)) smoother.draw(scene);
	},

	codeInjections: [0xD000],   // replaced at run time by the accelerator

	onCodeInjection(pc, op) {
		if (dlis.includes(pc)) {   // a display list interrupt: in a GTIA mode, the scene's rows are being drawn
			const g = a8.gtia;
			if (g.prior & 0xC0) { sceneGtia = {}; for (const r of GTIA_REGISTERS) sceneGtia[r] = g[r]; }
			return op;
		}
		return this.menu.ACCEL.current === 1 && !a8.accelerationDisabled() ? accel.onCodeInjection(pc, op) : op;
	},

	onFrame() {
		const handler = mem[0xFF8A] | mem[0xFF8B] << 8;   // where the NMI handler jumps for a DLI right now
		if (!dlis.includes(handler)) { dlis = [handler, ...dlis].slice(0, 4); accel.apply(); }
		// Only the 3D engine is accelerated: it moves by the time that passed. The demo's
		// other parts pace themselves by how long their work takes, and would run wild
		if (engineMapped()) { unmapped = 0; if (this.menu.ACCEL.current === 1) accel.onFrame(); }
		else if (++unmapped === 25) accel.reset("the 3D engine is gone");
		// the rendered frames: the display list's first LMS flips between the two buffers
		frame++;
		const lms = mem[0x1F84] | mem[0x1F85] << 8;
		if (lms !== lastLms) { flips++; lastLms = lms; }
		if (this.menu.RATE.current === 1 && frame % 250 === 0) { console.log(`numen: ${(flips / 5).toFixed(1)} frames a second`); flips = 0; }
	},
};
