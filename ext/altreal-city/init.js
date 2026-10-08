// Alternate Reality: The City - the disk sides served from files (disks.js),
// a sector's handling and the renderer's hot loops run in no time (loader.js;
// the profile-driven accelerator of common.js), smooth walking (walk.js).
// altreal-city.md describes what was found in the game.
import { createAccelerator, codeAt } from "../common.js";
import { disks } from "./disks.js";
import { loader } from "./loader.js";
import { walk, SPEED_FACTORS } from "./walk.js";
import { automap } from "./automap.js";
import { createView3D, pictureDisplayed, buildingPictureDisplayed, PICTURE, BUILDING_PICTURE } from "./view3d.js";
import * as smooth2d from "./smooth2d.js";

// The accelerator skips the renderer's hottest loops: the known ones from
// the start (altreal-city.md, "The renderer"), then what one profile of 60
// frames finds, and no more profiling after that (the hot code does not
// change, and the game is slow while a profile is taken). Never the disk
// code, $7A60-$81FF (the prompt, the stream, the serial transaction), whose reads must reach disks.js's hook
const own = () => [...disks.hooks, ...loader.hooks, ...walk.hooks, ...automap.hooks];
const RENDERER_LOOPS = [[0x7282, 0x73CB], [0x7786, 0x79CF], [0x7128, 0x71BC], [0x7680, 0x7763]];
const view3d = createView3D();
const accel = createAccelerator({ profileFrames: 60, minShare: 0.02, maxRanges: 10, budget: 200000, reprofile: 1e9, also: own, seed: RENDERER_LOOPS, avoid: [[0x7A60, 0x81FF]] });

export default {
	name: "ALT.REAL. CITY JS HACK by Eru",

	// Code of the renderer at $7282 (LDA $02; SEC; SBC $1D; STA $02)
	fingerprint: { address: 0x7282, bytes: [0xA5, 0x02, 0x38, 0xE5, 0x1D, 0x85, 0x02] },

	menu: {
		ACCEL: { label: "Acceleration:", options: ["OFF", "ON"], current: 1 },
		SMOOTH: { label: "Smooth walking:", options: ["OFF", "ON"], current: 1 },
		SPEED: { label: "Walking speed:", options: ["1x", "1.5x", "2x", "3x"], current: 1 },
		VIEW3D: { label: "Street view:", options: ["Atari", "OpenGL"], current: 1 },
		TEXTURES: { label: "Textures:", options: ["Original", "Smooth 4x"], current: 1 },
		// Game: the facades on the upper half of the walls and mirrored below, as the game
		// shows them; Full: the facade over the whole wall
		FACADES: { label: "Facades:", options: ["Game", "Full"], current: 0 },
		// The sky and the ground: the game's colours line by line as bands, blended smooth, or the
		// ground as a cobbled plane in those colours
		GROUND: { label: "Sky and ground:", options: ["Banded", "Smooth", "Textured"], current: 0 },
		// Smooth: sizes halve per cell at one rate; Game: linearly between the cells, as the game
		// draws, which makes a walk feel quick then slow within each cell
		PROJECTION: { label: "Projection:", options: ["Smooth", "Game"], current: 0 },
		// in rain the game gives the sky and the ground random dark colours on every line each frame;
		// Calm keeps the drops but lets the colours settle
		RAIN: { label: "Rain:", options: ["Calm", "Game"], current: 0 },
		// The game's own picture (the Atari view, a building) upscaled the same way (smooth2d.js)
		PICTURES: { label: "Smooth pictures:", options: ["OFF", "ON"], current: 1 },
		// Wide: the view over the whole width, the texts shrunk above and below
		LAYOUT: { label: "Layout:", options: ["Game", "Wide"], current: 1 },
		// Automatic: the four disk sides are read from the .atr files next to
		// this script, and the game never asks for a disk (disks.js)
		DISKS: { label: "Disk swaps:", options: ["Manual", "Automatic"], current: 1 },
		LOADING: { label: "Loading:", options: ["Original", "Instant"], current: 1 },
		// The automatic map (automap.js): in a browser at the bottom of the page's panel,
		// natively over the screen (as the M key shows it)
		MAP: { label: "Show map:", options: ["OFF", "ON"], current: a8.host === "web" ? 1 : 0 },
	},

	codeInjections: own(),
	served: () => disks.served,   // for tests
	disks, loader,

	onActivate() {
		disks.panel();
		accel.apply();
	},

	onFrame() {
		walk.active = this.menu.SMOOTH.current === 1 && this.menu.ACCEL.current === 1 && !a8.accelerationDisabled();
		walk.factor = SPEED_FACTORS[this.menu.SPEED.current];
		walk.onFrame();
		accel.onFrame();
		automap.track();
		automap.panel(this.menu.MAP.current === 1);
	},

	onPostGlFrame() {
		view3d.options.smoothTextures = this.menu.TEXTURES.current === 1;
		view3d.options.mirrored = this.menu.FACADES.current === 0;
		view3d.options.ground = this.menu.GROUND.current;
		view3d.options.gameLaw = this.menu.PROJECTION.current === 1;
		view3d.options.calmRain = this.menu.RAIN.current === 0;
		view3d.options.wide = this.menu.LAYOUT.current === 1;
		let drawn = false;
		if (this.menu.VIEW3D.current === 1)
			drawn = view3d.render(walk.pace());
		else
			view3d.reset();
		// The game's own picture, when it is what shows: read back before
		// anything is drawn over it, then smoothed in place or, in the wide
		// layout, enlarged
		const smooth = !drawn && this.menu.PICTURES.current === 1 && pictureDisplayed() && smooth2d.capture(PICTURE);
		if (view3d.options.wide)
			view3d.drawWideLayout(drawn, smooth ? smooth2d : null);
		else if (smooth)
			smooth2d.draw(PICTURE);
		// a building's picture, across the whole width: smoothed in its place
		if (this.menu.PICTURES.current === 1 && buildingPictureDisplayed() && smooth2d.capture(BUILDING_PICTURE))
			smooth2d.draw(BUILDING_PICTURE);
		if (automap.shown || (this.menu.MAP.current === 1 && !a8.panel))
			automap.draw();
	},

	onCodeInjection(pc, op) {
		if (disks.hooks.includes(pc))
			return this.menu.DISKS.current === 1 ? disks.onCodeInjection(pc, op) : op;
		if (loader.hooks.includes(pc))
			return this.menu.LOADING.current === 1 && !a8.accelerationDisabled() ? loader.onCodeInjection(pc, op) : op;
		if (walk.hooks.includes(pc))
			return walk.onCodeInjection(pc, op);
		if (automap.hooks.includes(pc))
			return automap.onCodeInjection(pc, op);
		return this.menu.ACCEL.current === 1 && !a8.accelerationDisabled() ? accel.onCodeInjection(pc, op) : op;
	},
};
