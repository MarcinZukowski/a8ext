// Alternate Reality: The City - the game's disk sides served from files, so
// that it never asks for a disk to be inserted and a sector takes no time.
//
// The game does its own serial I/O (a state machine driven by the serial
// interrupts, $7C80-$81BE). A read goes through $7C92: the sector number is
// in $0252/$0253, the device in $0250 ($31; it alternates $31 and $32 after
// failures, "into any drive"), the command 'R' in $0251, and the transaction
// at $7F40 sends the command frame, waits for the acknowledgements and takes
// the 128 bytes into $0255-$02D4. From $7F8A the game descrambles them in
// place and checks them: bytes 0-1 seed a running key, bytes 2-3 hold the
// sum of the descrambled bytes 4-127, bytes 4-5 are the sector's own number
// and 6-7 the identity of the disk side, which must be the one wanted in
// $CD/$CE (a wrong side is what the "Insert Disk n Side m" prompt comes
// from); then the 120 payload bytes 8-127 are copied to ($65), unless bit 0
// of $CC says the caller takes them from the buffer itself. See altreal-city.md.
//
// The hook is at $7F40: the sector is found in the side's image, the raw
// bytes are put into the buffer and the PC is sent to $7F8A with the state
// $02D9 at $0D (received), so the game's own descrambling and checks run on
// them as on a drive's. The side is found by its identity: each side's
// sectors carry it, so the right image is the one whose copy of the sector
// decodes with the identity wanted. A sector no image supplies this way (the
// character disk, which the game also writes; side 1, whose sectors are
// not in this format) is left to the drive.
//
// The game also writes: leaving a building saves the character to side 3,
// sectors 707 on ($2C0C to $7C0D: a read of the first sector, then 'P'
// writes of 120 bytes each from ($65), each read back; *measured*,
// tc6.a8s), and it retries a failed write for ever, with no prompt, so with
// the reads served and no disk in the drive the game would never leave the
// store. A write goes through $7CC8 and the sending transaction at $80D3,
// whose first call ($8038) builds the frame in the buffer: the sector as
// the drive stores it, scrambled with two random keys. The hook after that
// call puts the frame into the side's image (found by the identity the frame
// carries), writes the image file back (natively the .atr, in a browser the
// page's copy), and ends the transaction at $812D (state $0D, received).
//
// The buildings' records (side 3, sectors 695-718, three a building, eight
// buildings) begin with the character's id ($8921/$8922) plus the number of
// times the building has been left, which the city counts in RAM, a byte a
// building at $2CA1-$2CA8, zero at boot; a building's program checks the
// record against the id and its count ($098F in the Best Bargain Store's)
// and leaves at once ("Leaving.....") when they disagree, stamping the
// record with the new count when the player leaves ($0A6C). In one session
// the two agree; a saved state brings its own session's counts while the
// images carry the stamps of the latest, and then no visited building lets
// the player in (*measured*: tc10.a8s, after a session that had left the
// store and the armorers). So when a record's first sector is read, the
// count is set from the stamp, which is what a continuous session would have.
import * as std from "std";
import * as os from "os";
import { codeAt } from "../common.js";

const TRANSACTION = 0x7F40, VERIFY = 0x7F8A;
const SEND = 0x80D3, SEND_CODE = [0x20, 0x38, 0x80, 0x20, 0x4F, 0x81, 0x20, 0x40, 0x7D], SEND_HOOK = SEND + 3, SEND_DONE = 0x812D;
const COMMAND = 0x251, SECTOR_LO = 0x252, SECTOR_HI = 0x253, STATE = 0x2D9, BUFFER = 0x255;
const WANTED_ID_LO = 0xCD, WANTED_ID_HI = 0xCE;
const CMD_READ = 0x52, CMD_PUT = 0x50, CMD_WRITE = 0x57, STATE_RECEIVED = 0x0D;
const SECTOR_SIZE = 128, ATR_HEADER = 16, SIDES = 4;
const RECORDS_ID = 0x0122, RECORDS_FIRST = 695, RECORD_SECTORS = 3, RECORDS = 8, VISIT_COUNTS = 0x2CA1, CHARACTER_ID = 0x8921;

const DIR = a8.extDir + "/";
const sideName = (n) => `${DIR}Alternate Reality (v2,s${n}).atr`;
const images = new Map();   // side -> Uint8Array of the sectors, or null when the file is missing
const headers = new Map();  // side -> the file's 16-byte header, kept for writing it back

function image(side) {
	if (images.has(side)) return images.get(side);
	const path = sideName(side);
	let data = null;
	const f = std.open(path, "rb");
	if (f !== null) {
		f.seek(0, std.SEEK_END);
		const size = f.tell() - ATR_HEADER;
		if (size > 0) {
			const header = new Uint8Array(ATR_HEADER);
			f.seek(0, std.SEEK_SET);
			f.read(header.buffer, 0, ATR_HEADER);
			headers.set(side, header);
			data = new Uint8Array(size);
			f.read(data.buffer, 0, size);
		}
		f.close();
	}
	console.log(data ? `altreal-city: side ${side} from ${path}` : `altreal-city: no image for side ${side} (${path})`);
	images.set(side, data);
	return data;
}

// The side's image written back to its file, header and all
function saveImage(side) {
	const path = sideName(side), f = std.open(path, "wb");
	if (f === null) { console.log(`altreal-city: cannot write ${path}`); return false; }
	const data = images.get(side), header = headers.get(side);
	f.write(header.buffer, 0, ATR_HEADER);
	f.write(data.buffer, 0, data.length);
	f.close();
	return true;
}

// A raw sector descrambled as the game does it ($80A8), or null when its
// sum or its sector number do not agree: not a sector in this format (side
// 1's are not). Bytes 6-7 are the side's identity, 8-127 the payload
function decoded(raw, sector) {
	let s0 = raw[0], s1 = raw[1], sum = 0;
	const b = new Uint8Array(raw);
	for (let y = 4; y < SECTOR_SIZE; y++) {
		s0 = (s0 + s1) & 0xFF; s1 = s0 ^ s1;
		b[y] ^= s1; sum = (sum + b[y]) & 0xFFFF;
	}
	if (sum !== (b[2] | b[3] << 8) || (b[4] | b[5] << 8) !== sector) return null;
	return b;
}
const identity = (raw, sector) => { const b = decoded(raw, sector); return b === null ? -1 : b[6] | b[7] << 8; };

// A building's record read: its visit count in RAM set to what the record's
// stamp says, so that a saved state's session and the disk agree. Not
// during a save ($7C0D reads the record first, from $7C22, whose return
// address is then on the stack): the count has been raised for the stamp
// about to be written
const SAVE_RETURN = 0x7C24;
function withinSave() {
	const mem = a8.mem;
	for (let i = a8.cpu.s + 1; i < 0xFF; i++) if (mem[0x100 + i] === (SAVE_RETURN & 0xFF) && mem[0x101 + i] === SAVE_RETURN >> 8) return true;
	return false;
}
function syncVisitCount(raw, sector, id) {
	if (id !== RECORDS_ID || sector < RECORDS_FIRST || sector >= RECORDS_FIRST + RECORDS * RECORD_SECTORS || (sector - RECORDS_FIRST) % RECORD_SECTORS !== 0) return;
	if (withinSave()) return;
	const b = decoded(raw, sector);
	if (b === null) return;
	const building = (sector - RECORDS_FIRST) / RECORD_SECTORS, count = (b[8] - a8.mem[CHARACTER_ID]) & 0xFF;
	if (a8.mem[VISIT_COUNTS + building] !== count) {
		console.log(`altreal-city: building ${building}'s record says it was left ${count} times, the game had ${a8.mem[VISIT_COUNTS + building]}: set`);
		a8.mem[VISIT_COUNTS + building] = count;
	}
}

const sideOfId = new Map();   // identity -> side, once seen

// The raw sector from the side with this identity, or null
function findSector(sector, id) {
	if (sector < 1) return null;
	const sides = sideOfId.has(id) ? [sideOfId.get(id)] : [1, 2, 3, 4];
	for (const side of sides) {
		const img = image(side);
		if (img === null || sector * SECTOR_SIZE > img.length) continue;
		const raw = img.subarray((sector - 1) * SECTOR_SIZE, sector * SECTOR_SIZE);
		if (identity(raw, sector) === id) { sideOfId.set(id, side); return raw; }
	}
	return null;
}

// The side whose sectors carry this identity, or 0: what is known from the
// reads so far, else the identity of each image's first decodable sector
function sideOf(id) {
	if (sideOfId.has(id)) return sideOfId.get(id);
	for (let side = 1; side <= SIDES; side++) {
		const img = image(side);
		if (img === null || [...sideOfId.values()].includes(side)) continue;
		for (let sector = 1; sector <= 64 && sector * SECTOR_SIZE <= img.length; sector++) {
			const found = identity(img.subarray((sector - 1) * SECTOR_SIZE, sector * SECTOR_SIZE), sector);
			if (found >= 0) { sideOfId.set(found, side); break; }
		}
	}
	return sideOfId.get(id) || 0;
}

// In a browser the images cannot come with the site: a file picker in the
// extension's panel takes the four .atr files, written under the names above
// (the page keeps them); which side a file is goes by the "sN" in its name,
// else the last digit 1-4 in it, else the first side still missing
const present = (n) => { const f = std.open(sideName(n), "rb"); if (f === null) return false; f.close(); return true; };
function sideOfFile(name) {
	const base = name.replace(/\.atr$/i, ""), tagged = /s([1-4])\)?$/i.exec(base), digits = base.match(/[1-4]/g);
	if (tagged) return +tagged[1];
	if (digits) return +digits[digits.length - 1];
	for (let n = 1; n <= SIDES; n++) if (!present(n)) return n;
	return 1;
}
function diskPanel() {
	if (a8.host !== "web" || a8.panel === null) return;
	const status = document.createElement("div"), input = document.createElement("input"), forget = document.createElement("button");
	const refresh = () => {
		const have = [];
		for (let n = 1; n <= SIDES; n++) if (present(n)) have.push(n);
		status.textContent = have.length === SIDES ? "Disk images: all four sides, no swapping."
			: `Disk images: ${have.length ? "sides " + have.join(", ") : "none"}. Choose the game's four .atr files to play without swapping; they stay in this browser.`;
		forget.hidden = have.length === 0;
	};
	input.type = "file"; input.multiple = true; input.accept = ".atr";
	input.addEventListener("change", async () => {
		for (const file of input.files) {
			const bytes = new Uint8Array(await file.arrayBuffer()), n = sideOfFile(file.name);
			const f = std.open(sideName(n), "wb");
			f.write(bytes.buffer, 0, bytes.length); f.close();
			console.log(`altreal-city: ${file.name} is side ${n}`);
		}
		images.clear(); sideOfId.clear();
		input.value = ""; input.blur();
		refresh();
	});
	forget.textContent = "Forget the disk images";
	forget.addEventListener("click", () => {
		for (let n = 1; n <= SIDES; n++) os.remove(sideName(n));
		images.clear(); sideOfId.clear(); forget.blur();
		refresh();
	});
	a8.panel.append(status, input, forget);
	refresh();
}

export const disks = {
	served: 0,          // sectors served so far
	written: 0,         // sectors written into the images so far
	log: false,         // print every read and write
	last: "",           // "side s sector n"
	panel: diskPanel,   // call on activation
	hooks: [TRANSACTION, SEND_HOOK],

	// Called for the transaction's first instruction: a read whose sector a
	// side's image supplies goes into the buffer, and the game carries on
	// at its checks as if the drive had answered; anything else runs as it is.
	// And in the sending transaction, once the frame is built: a write of a
	// sector of a side among the images goes into that image and its file
	onCodeInjection(pc, op) {
		if (pc === SEND_HOOK) return this.write(op);
		if (pc !== TRANSACTION || a8.mem[COMMAND] !== CMD_READ) return op;
		const mem = a8.mem, sector = mem[SECTOR_LO] | mem[SECTOR_HI] << 8, id = mem[WANTED_ID_LO] | mem[WANTED_ID_HI] << 8;
		const raw = findSector(sector, id);
		if (raw === null) { if (this.log) console.log(`altreal-city: sector ${sector} with identity $${id.toString(16)} is in no image: left to the drive`); return op; }
		mem.set(raw, BUFFER);
		mem[STATE] = STATE_RECEIVED;
		syncVisitCount(raw, sector, id);
		this.served++;
		this.last = `side ${sideOfId.get(id)} sector ${sector} to $${(mem[0x65] | mem[0x66] << 8).toString(16)} (${mem[0x24C] | mem[0x24D] << 8} bytes)`;
		if (this.log) console.log("altreal-city: read " + this.last);
		a8.cpu.pc = VERIFY;
		return a8.OP_NOP;
	},

	write(op) {
		const mem = a8.mem, cmd = mem[COMMAND];
		if ((cmd !== CMD_PUT && cmd !== CMD_WRITE) || !codeAt(SEND, SEND_CODE)) return op;
		const sector = mem[SECTOR_LO] | mem[SECTOR_HI] << 8, raw = mem.subarray(BUFFER, BUFFER + SECTOR_SIZE);
		const id = identity(raw, sector), side = id >= 0 ? sideOf(id) : 0, img = side ? image(side) : null;
		if (img === null || sector < 1 || sector * SECTOR_SIZE > img.length) {
			if (this.log) console.log(`altreal-city: write of sector ${sector} with identity $${id.toString(16)} is for no image: left to the drive`);
			return op;
		}
		img.set(raw, (sector - 1) * SECTOR_SIZE);
		saveImage(side);
		this.written++;
		this.last = `side ${side} sector ${sector} from $${(mem[0x65] | mem[0x66] << 8).toString(16)}`;
		if (this.log) console.log("altreal-city: wrote " + this.last);
		mem[STATE] = STATE_RECEIVED;
		a8.cpu.pc = SEND_DONE;
		return a8.OP_NOP;
	},
};
