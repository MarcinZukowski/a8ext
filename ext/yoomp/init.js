// Yoomp!: the tunnel drawn with OpenGL from the game's own tiles (tunnel.js),
// 3D balls and a high-resolution tunnel background.
import { drawQuad, rgb } from "../common.js";
import { loadObj } from "./obj.js";
import { createTunnel } from "./tunnel.js";

const DIR = a8.extDir;   // this extension's directory, for its files

const BALL_FILES = [
	null,   // 0 = the original Atari ball
	`${DIR}/ball-yoomp-bw.obj`,
	`${DIR}/ball-yoomp.obj`,
	`${DIR}/ball-amiga.obj`,
	`${DIR}/ball-amiga-2.obj`,
	`${DIR}/beach-ball.obj`,
];

// Zero page locations used by the game: the ball's angle round the tunnel, its
// screen position, and its jump cycle's frame (0-31, stepped only while the
// ball moves: not while paused, dead or waiting at a level's start)
const EQU_BALL_X = 0x0030, EQU_BALL_VX = 0x0031, EQU_BALL_VY = 0x0032, EQU_BALL_FRAME = 0x003D, BALL_CYCLE = 32;

const tunnel = createTunnel();

export default {
	name: "Yoomp! JS HACK by Eru",

	fingerprint: { address: 0x3600, bytes: [0x20, 0x00, 0xB0, 0x20, 0xBC, 0x3D] },

	menu: {
		// The tunnel as a cylinder textured with the game's tiles (tunnel.js). It covers
		// the game's own ball, so the original ball is drawn as the first 3D one then
		TUNNEL: { label: "OpenGL tunnel:", options: ["OFF", "ON"], current: 1 },
		SMOOTH: { label: "Smooth tiles:", options: ["OFF", "ON"], current: 0 },
		FOG: { label: "Fog:", options: ["OFF", "ON"], current: 1 },
		BKG: { label: "Nicer background:", options: ["OFF", "ON"], current: 1 },
		BALL: {
			label: "Ball type:",
			options: ["ORIGINAL", "Yoomp-like-colorized", "Yoomp-like-green", "Amiga V1", "Amiga V2", "Beach Ball"],
			current: 1,
		},
	},

	initialized: false,
	balls: [],          // indexed like BALL_FILES
	background: null,

	init() {
		if (this.initialized)
			return;
		console.log("Loading Yoomp! resources");

		for (let i = 1; i < BALL_FILES.length; i++)
			this.balls[i] = loadObj(BALL_FILES[i]);

		this.background = gl.loadTextureRGBA(`${DIR}/rof-gray.rgba`, 476, 476);

		// Make the centre of the background semi-transparent
		const { width, height, pixels } = this.background;
		const xc = width / 2 + 7, yc = height / 2;
		const rad = 120, dark = 0.8 * rad;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const r = Math.hypot(x - xc, y - yc);
				let alpha;
				if (r <= dark)
					alpha = 255 - 255 * r / dark;
				else if (r <= rad)
					alpha = 0;
				else
					alpha = 255;
				pixels[4 * (y * width + x) + 3] = alpha;   // stores truncate to a byte
			}
		}
		this.background.finalize();

		console.log("Yoomp! JS script initialized");
		this.initialized = true;
	},

	drawBackground() {
		if (this.menu.BKG.current === 0)
			return;

		// Screen and texture coordinates
		const L = -0.77, R = 0.77, T = 0.9, B = -0.75;
		const TL = 0.18, TR = 0.84, TT = 0.76, TB = 0.25;

		gl.BindTexture(gl.TEXTURE_2D, this.background.id);
		gl.Disable(gl.DEPTH_TEST);
		gl.Enable(gl.BLEND);
		gl.BlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

		// Colourize the texture to match the current tunnel: $4F60 holds the
		// background colour, use its brightest shade
		const [cr, cg, cb] = rgb(a8.mem[0x4F60] | 0x0F);
		gl.Color4f(cr, cg, cb, 1);
		drawQuad(TL, TR, TT, TB, L, R, T, B, -2.0);

		gl.Color4f(1, 1, 1, 1);
		gl.Disable(gl.BLEND);
	},

	drawBall() {
		let ballNr = this.menu.BALL.current;
		if (ballNr === 0 && this.menu.TUNNEL.current === 1)
			ballNr = 1;   // the OpenGL tunnel covers the game's ball: a 3D one stands in
		if (ballNr === 0)
			return;   // original Atari ball, draw nothing

		// Our balls have no textures
		gl.Disable(gl.TEXTURE_2D);
		gl.MatrixMode(gl.MODELVIEW);
		gl.PushMatrix();
		gl.LoadIdentity();

		const ballAngle = a8.mem[EQU_BALL_X];
		const ballVx = a8.mem[EQU_BALL_VX];
		const ballVy = a8.mem[EQU_BALL_VY];

		gl.Translatef((ballVx - 128 + 4) / 84, -(ballVy - 112 - 8) / 120, 0);
		gl.Scalef(0.05, 0.07, 0.07);
		gl.Rotatef(ballAngle / 256 * 360, 0, 0, 1);
		gl.Rotatef(a8.mem[EQU_BALL_FRAME] / BALL_CYCLE * 360, 1, 0, 0);   // one turn a jump cycle, still when the game is

		let cr = 1, cg = 1, cb = 1;
		if (ballNr === 1) {
			// Match the colour of the ball: $4F5C holds it
			[cr, cg, cb] = rgb(a8.mem[0x4F5C] | 0x0C);
		}
		this.balls[ballNr].render(cr, cg, cb);

		gl.PopMatrix();
		gl.Enable(gl.TEXTURE_2D);
		gl.Color4f(1, 1, 1, 1);
	},

	codeInjections: tunnel.hooks,
	onCodeInjection(pc, op) { return tunnel.onCodeInjection(pc, op); },

	onPostGlFrame() {
		this.init();
		// Only during the game
		if (a8.antic.dlist !== 0xCA00)
			return;
		this.drawBackground();
		if (this.menu.TUNNEL.current === 1)
			tunnel.render({ smooth: this.menu.SMOOTH.current === 1, fog: this.menu.FOG.current === 1 });
		this.drawBall();
	},
};
