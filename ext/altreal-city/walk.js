// Alternate Reality: The City - smooth walking. The player walks the 36
// units of a cell in steps of $892C = 6, one redraw each, and the redraw
// is what paces the game: with the drawing and the disk made quick, six
// big steps a second would rush by. As in the Dungeon's extension, the step
// becomes one unit (two or three when the loop cannot redraw often enough)
// and the stick is let through only as often as keeps the speed the game
// had, times the chosen factor: many small steps instead of six big ones.
//
// The main loop reads the stick at $64E1 (LDA $C6: the VBI's copy of PORTA,
// bits 0-3 up, down, left, right, active low). A move not yet due has its
// bits 0-1 released there; a turn (bits 2-3) goes through once per push, and
// again at the game's own rate once the stick has been held a while, since
// the quick loop would otherwise turn several quarters a push. Each cell is
// 36 units: $892A runs from 36 (entered) to 72 (leaving) along the facing
// (altreal-city.md, "Movement").
const STICK_READ = 0x64E1, STICK_READ_BYTES = [0xA5, 0xC6, 0x29, 0x0F];
const STICK = 0xC6, STEP = 0x892C;
const MASK_MOVE = 0x03, MASK_TURN = 0x0C;   // bits of $C6 (0 when pressed)
const GAME_STEP = 6;                        // the game's own step ($892C; nothing in the code changes it)
const GAME_STEPS_PER_SECOND = 3.75;         // measured: a redraw per 16 frames with the disk served
const TURNS_PER_SECOND = 3, TURN_REPEAT_DELAY = 0.4;   // seconds the stick is held before turns repeat
const MAX_MOVES_PER_SECOND = 30;            // what the quickened loop redraws
export const SPEED_FACTORS = [1, 1.5, 2, 3];

let moveBudget = 0, turnBudget = 0, turning = false, turnHeld = 0;
let movesPerSecond = GAME_STEPS_PER_SECOND;
const pace = { unitsPerSecond: GAME_STEP * GAME_STEPS_PER_SECOND, step: GAME_STEP };

export const walk = {
	hooks: [STICK_READ],
	active: false,       // set each frame by init.js: smooth walking on
	factor: 1,           // the speed factor
	movesPerSecond: () => movesPerSecond,
	pace: () => pace,    // { unitsPerSecond, step }: how the game is walked at the moment

	// Every frame: the budgets grow, the step is set
	onFrame() {
		const mem = a8.mem;
		if (this.active) {
			const unitsPerSecond = GAME_STEP * GAME_STEPS_PER_SECOND * this.factor;
			const step = Math.max(1, Math.ceil(unitsPerSecond / MAX_MOVES_PER_SECOND));
			mem[STEP] = step;
			movesPerSecond = unitsPerSecond / step;
			pace.unitsPerSecond = unitsPerSecond; pace.step = step;
			moveBudget = Math.min(moveBudget + movesPerSecond / 60, 2);
		}
		else if (mem[STEP] !== GAME_STEP) {
			mem[STEP] = GAME_STEP;   // smooth walking was switched off: the game's step back
			movesPerSecond = GAME_STEPS_PER_SECOND;
			pace.unitsPerSecond = GAME_STEP * GAME_STEPS_PER_SECOND; pace.step = GAME_STEP;
		}
		if (turning) { turnHeld++; turnBudget = Math.min(turnBudget + TURNS_PER_SECOND / 60, 1); }
	},

	onCodeInjection(pc, op) {
		if (pc !== STICK_READ || !this.active) return op;
		const mem = a8.mem, pressed = ~mem[STICK] & 0x0F;
		let allow = true;
		if (pressed & MASK_MOVE) {
			turning = false;
			if (moveBudget >= 1) moveBudget -= 1; else allow = false;
		}
		else if (pressed & MASK_TURN) {
			if (!turning) { turning = true; turnHeld = 0; turnBudget = 0; }
			else if (turnHeld >= TURN_REPEAT_DELAY * 60 && turnBudget >= 1) turnBudget -= 1;
			else allow = false;
		}
		else turning = false;
		if (!allow) mem[STICK] |= 0x0F;   // directions released
		return op;
	},
};
