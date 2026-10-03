// Mercenary - two pills over the picture in a browser (a8.overlay): "?" shows
// the game's keys in a box while the game goes on, and a map pill a map of the
// city in the picture's corner: the 16 x 16 squares (number Y * 16 + X, the
// LOC readout's XX-YY), the roads from the game's own tables, the squares
// with a structure, the destroyed ones, and the player with the heading.
// The city's tables, found by their shape (the C64 version's $2600-$2FFF
// moved up by $4000): $6600/$6700 a square's building model pointer (98
// distinct; the road pieces are the models at $F800 and up), $6B00 its
// status (bit 7 destroyed), $6C00-$6FFF the road ends: for each square the
// squares at the ends of the road along its row (west, east) and along its
// column (north, south), 0 for none.

const mem = a8.mem;
const MODEL_LO = 0x6600, MODEL_HI = 0x6700, STATUS = 0x6B00, ROAD_WEST = 0x6C00, ROAD_EAST = 0x6D00, ROAD_NORTH = 0x6E00, ROAD_SOUTH = 0x6F00;
const ROAD_PIECES = 0xF800;   // models from here up draw a road piece and nothing else
const MAP_SIZE = 176, CELL = MAP_SIZE / 16;

// The keys, as the game reads them (the engine is the C64 version's: its
// analysis at github.com/gamesexplained lists them; T and B are tested at
// $3B7B here). Left: the key; right: what it does
const KEYS = [
	["joystick (arrows)", "steer; on foot turn and walk"],
	["fire (right Ctrl)", "fire the craft's missile"],
	["T", "take, or buy from a seller"],
	["D", "drop, or sell"],
	["B", "board a craft"],
	["L", "leave the craft"],
	["E", "the lift, up or down"],
	["Y", "yes, to a question"],
	["1-9, 0", "throttle: a speed, 0 the top"],
	["Shift + digit", "the same, reversed (right Shift here)"],
	["Space", "stop"],
	["+ and -", "throttle up and down while held"],
	["Ctrl + Return", "pause, until the next key (left Ctrl here)"],
	["Ctrl + S, Ctrl + L", "save, load a game: then a digit and Return"],
	["Ctrl + Q", "quit the situation"],
];

export function createHud() {
	let pills = null, keysBox = null, mapCanvas = null, mapKey = "";

	function pill(text, title, onToggle) {
		const b = document.createElement("button");
		b.className = "pill"; b.textContent = text; b.title = title;
		b.addEventListener("click", () => { b.classList.toggle("on"); onToggle(b.classList.contains("on")); b.blur(); });
		return b;
	}

	function showKeys(on) {
		if (!on) { if (keysBox) keysBox.remove(); keysBox = null; return; }
		keysBox = document.createElement("div");
		keysBox.className = "box"; keysBox.style.cssText = "left: 12px; top: 48px; max-width: min(440px, calc(100% - 24px)); max-height: calc(100% - 60px); overflow: auto;";
		const dl = document.createElement("dl");
		for (const [key, what] of KEYS) { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = key; dd.textContent = what; dl.append(dt, dd); }
		keysBox.append(dl);
		a8.overlay.append(keysBox);
	}

	function showMap(on) {
		if (!on) { if (mapCanvas) mapCanvas.remove(); mapCanvas = null; mapKey = ""; return; }
		mapCanvas = document.createElement("canvas");
		mapCanvas.style.cssText = `right: 12px; bottom: 12px; width: ${MAP_SIZE}px; height: ${MAP_SIZE + 18}px; border: 1px solid var(--edge); background: rgba(21, 21, 19, 0.88);`;
		mapCanvas.title = "The city: roads, structures (destroyed ones dark), and where you are";
		a8.overlay.append(mapCanvas);
		drawMap();
	}

	// The player's square and position in it from the 24-bit eye position: the
	// high byte is the square (the LOC readout), the rest where in it
	function drawMap() {
		const x = (mem[0x72] + mem[0x71] / 256) / 1, y = (mem[0x78] + mem[0x77] / 256) / 1;
		const heading = mem[0x2A] | ((mem[0x2B] & 3) << 8), destroyed = [];
		for (let i = 0; i < 256; i++) if (mem[STATUS + i] & 0x80) destroyed.push(i);
		const key = `${x.toFixed(3)}:${y.toFixed(3)}:${heading}:${destroyed.join()}:${mem[0xA6]}`;
		if (key === mapKey) return;
		mapKey = key;
		const dpr = Math.min(2, window.devicePixelRatio || 1), W = MAP_SIZE, H = MAP_SIZE + 18;
		if (mapCanvas.width !== Math.round(W * dpr)) { mapCanvas.width = Math.round(W * dpr); mapCanvas.height = Math.round(H * dpr); }
		const ctx = mapCanvas.getContext("2d");
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, W, H);
		// the squares with a structure, and the destroyed ones
		for (let i = 0; i < 256; i++) {
			const model = mem[MODEL_LO + i] | (mem[MODEL_HI + i] << 8), cx = (i & 15) * CELL, cy = (i >> 4) * CELL;
			if (model === 0 || model >= ROAD_PIECES || i === 0) continue;
			ctx.fillStyle = (mem[STATUS + i] & 0x80) ? "#3a2a22" : "#4a4a44";
			ctx.fillRect(cx + 2, cy + 2, CELL - 4, CELL - 4);
		}
		// the roads: each square on one has the road's ends in its tables
		ctx.strokeStyle = "#8a8a80"; ctx.lineWidth = 1;
		ctx.beginPath();
		for (let i = 0; i < 256; i++) {
			const cx = (i & 15) * CELL + CELL / 2, cy = (i >> 4) * CELL + CELL / 2;
			if (mem[ROAD_WEST + i] || mem[ROAD_EAST + i]) { ctx.moveTo(cx - CELL / 2, cy); ctx.lineTo(cx + CELL / 2, cy); }
			if (mem[ROAD_NORTH + i] || mem[ROAD_SOUTH + i]) { ctx.moveTo(cx, cy - CELL / 2); ctx.lineTo(cx, cy + CELL / 2); }
		}
		ctx.stroke();
		// the player: an arrow the way it faces. Heading 0 is north, toward falling Y
		// (up here), and the heading grows counter-clockwise: at 256 the view's depth
		// is -X (the view transform in init.js), west, so the angle is taken the other way
		const px = x * CELL, py = y * CELL, a = -heading / 1024 * 2 * Math.PI, r = 5;
		ctx.fillStyle = "#e8b84a"; ctx.beginPath();
		ctx.moveTo(px + Math.sin(a) * r, py - Math.cos(a) * r);
		ctx.lineTo(px + Math.sin(a + 2.5) * r, py - Math.cos(a + 2.5) * r);
		ctx.lineTo(px + Math.sin(a - 2.5) * r, py - Math.cos(a - 2.5) * r);
		ctx.closePath(); ctx.fill();
		ctx.fillStyle = "#d8d8d0"; ctx.font = "11px ui-monospace, Menlo, Consolas, monospace"; ctx.textBaseline = "middle";
		const hex = (v) => v.toString(16).toUpperCase().padStart(2, "0");
		ctx.fillText(`${hex(mem[0x72])}-${hex(mem[0x78])}` + (mem[0xA6] !== 0 ? "  inside" : ""), 4, MAP_SIZE + 9);
		ctx.textAlign = "right"; ctx.fillStyle = "#8a8a80"; ctx.fillText("N up", W - 4, MAP_SIZE + 9); ctx.textAlign = "left";
	}

	return {
		// In a browser: the pills over the picture (call at activation)
		install() {
			if (!a8.overlay) return;
			pills = document.createElement("div");
			pills.style.cssText = "position: absolute; left: 12px; top: 12px; display: flex; gap: 6px;";
			const help = pill("?", "The game's keys", showKeys), map = pill("\u{1F5FA}", "A map of the city", showMap);
			help.style.position = map.style.position = "static";
			pills.append(help, map);
			a8.overlay.append(pills);
		},
		// Every frame: the map follows the player
		update() {
			if (mapCanvas !== null) drawMap();
		},
	};
}
