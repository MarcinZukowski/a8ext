// Alternate Reality: The City - a sector's work in no time. Once the sectors
// come from files (disks.js), what a load still costs is the game's own
// handling of each: the descrambling of the 124 bytes with the running key
// ($80A8-$80D2, some 60 cycles a byte), the checks and the copy of the 120
// payload bytes to their place ($7F8A-$7FFF): about 10,000 cycles, three
// sectors a frame. A building's program comes in some 180 sectors (the
// Best Bargain Store: side 4 sectors 48-76 to $A000-$AB40 and $0300, then
// 490 onwards to the map at $0800), 60 frames of "Entering...." for the
// player; a step's own reads a few sectors. Here that code runs on the fake
// CPU from $7F8A to its RTS: pure computation, no waits. The fake CPU does
// not see hooks, but none lies in that stretch.
import { codeAt } from "../common.js";

const VERIFY = 0x7F8A, VERIFY_BYTES = [0xA9, 0x00, 0x8D, 0xDC, 0x02];   // LDA #0; STA $02DC
const AFTER_TRANSACTION = 0x7CC7;   // where $7C92's JSR $7F40 returns: the end of the verifying, whichever way it ended
const BUDGET = 100000;

export const loader = {
	hooks: [VERIFY],
	runs: 0,
	onCodeInjection(pc, op) {
		if (pc !== VERIFY || !codeAt(pc, VERIFY_BYTES)) return op;
		this.runs++;
		return a8.fakeCpuUntilPc(AFTER_TRANSACTION, BUDGET);
	},
};
