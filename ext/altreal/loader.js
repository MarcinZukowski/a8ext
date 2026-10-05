// Alternate Reality: The Dungeon - loading in no time. An area (the maze
// engine coming back from a shop, a shop's or an encounter's overlay, a
// picture) is read from the disk by the loader at $2799: the header sector
// through $2937, then sector after sector through $2979 (the read with
// retries, which calls the wrapper at $248E), each copied from $0100 to its
// place ($27A9), then the whole area descrambled against the sixteen key
// bytes kept at $0180 ($27DE-$2843) and checksummed ($2845-$2885). With the
// sectors served from files (disks.js) the reads take no time, and the
// copying, descrambling and checksumming are what the "Loading" screen
// waits for: 10-20 frames. Here they run on the fake CPU: a run from the
// loader's entry, and one after each read ($298D), for as long as the code
// stays in the loader. It leaves it at $248E, the wrapper, where the normal
// CPU meets disks.js's hook (hooks are not seen inside a fake run) and
// comes back to $298D. Two more of the sequence's loops run the same way:
// the block copy at $2E0D and the maze screen's set-up loops at $1AD4-$1B18.
// The waits for a frame at $2454 stay: they need the interrupt.
import { codeAt } from "../common.js";

const LOAD_AREA = 0x2799, AFTER_READ = 0x298D;
const LOADER_LO = 0x2799, LOADER_HI = 0x29FF;   // the wrapper at $248E lies outside
const BLOCK_COPY = 0x2E0D, SCREEN_SETUP = 0x1AD4, SCREEN_SETUP_END = 0x1B18;
const BUDGET = 4000000;   // instructions a run may take: an area's descrambling is a few hundred thousand
// The loader's bytes at each hook: resident code, but checked all the same
const BYTES = {
	[LOAD_AREA]: [0x20, 0x37, 0x29],         // JSR $2937
	[AFTER_READ]: [0x10, 0x06, 0xC6, 0x06],  // BPL; DEC $06
	[BLOCK_COPY]: [0x84, 0x0B, 0xA0, 0x00],  // STY $0B; LDY #0
	[SCREEN_SETUP]: [0xA2, 0x09, 0xA0, 0x0A],   // LDX #9; LDY #10
};

export const loader = {
	hooks: [LOAD_AREA, AFTER_READ, BLOCK_COPY, SCREEN_SETUP],
	runs: 0,   // fake runs made, for the log

	onCodeInjection(pc, op) {
		if (!codeAt(pc, BYTES[pc])) return op;
		this.runs++;
		switch (pc) {
		case LOAD_AREA: case AFTER_READ: a8.fakeCpuWhileIn(LOADER_LO, LOADER_HI, BUDGET); break;
		case BLOCK_COPY: return a8.fakeCpuUntilOp(a8.OP_RTS, BUDGET);
		case SCREEN_SETUP: a8.fakeCpuWhileIn(SCREEN_SETUP, SCREEN_SETUP_END, BUDGET); break;
		}
		return a8.OP_NOP;   // the run left the PC at the next instruction to execute
	},
};
