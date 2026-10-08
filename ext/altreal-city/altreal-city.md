# Alternate Reality: The City (Atari 8-bit) - notes

What the extension in this directory relies on, found in the game's memory
and code. *Measured* marks what was seen in the emulator (the saved state
tc.a8s, at the Floating Gate, and walks from it); the rest is read from the
code. Addresses are hexadecimal. The game is the 1985 original by Philip
Price (Datasoft/Paradise Programming), v2 disks: side 1 the boot and
character disk, sides 2-4 the city (the "(v2,s1)" to "(v2,s4)" images), and
a character disk the game writes.

The Dungeon (1987) is a different program: none of its code, tables or
addresses appear here (its depth tables, column filler, picture-into-fonts
routine, frame wait, light test, loader and disk wrapper were all searched
for). The two share only the shape of their movement model.

## The screen

* Display list at `$2CB5` (ANTIC `DLIST`): text rows in mode 2 (LMS
  `$35D8`, 40 bytes a row, a DLI on each: the stats, experience, level and
  hit points, and row 5, `$36A0`, the location line "You are at the
  Floating Gate"), then the picture: 36 lines of mode E (160 pixels, 4
  colours) from `$A000` in 32-byte steps, then 29 lines whose LMS point back
  up the same lines, `$A460`, `$A440` ... `$A100`: the lower half of the
  picture is the upper half mirrored, which is how the ground reflects the
  sky and the buildings. The text rows below (the food and water, the city's
  name) follow.
* The picture is 72 pixels wide (bytes 7-24 of each 32-byte line, `$7110`:
  the rest black), so 72 x 72 lines shown 2:1, like the Dungeon's. Two
  buffers, `$A000`-`$A47F` and `$A6A1` on, and two display lists for them:
  the VBI copies `$C9`/`$CA` into the JMP at `$2CC3`/`$2CC4` (`$56F6`) and
  the renderer waits for the copy at `$70CF`.
* Text: internal character codes for capitals, digits and signs (ASCII -
  `$20`), ASCII for lower case (*measured* against the location line);
  CHBASE `$28`: the font is at `$2800`.
* The DLIs change COLBK per line down the picture (`$BD32`-`$BE70`, WSYNC
  and COLBK stores): the sky's gradient.
* Colour registers at the end of a frame (*measured*): COLPF0 `$7A`, COLPF1
  `$0E`, COLPF2 `$00`, COLPF3 `$30`; `$5D27` sets COLPF0/1 to `$7A`/`$3A` or
  `$06`/`$00` by `$892D` (5-18 means one, else the other) and `$BF82`.

## Movement

* `$8924`/`$8925`: the cell, x east and y south, 0-63 (`CMP #$3F` at the
  map's edge sends the player to `$6571`: the id `$A170` and `$6827`, leaving
  the city). `$892B`: the facing, 0 north (y - 1), 1 east, 2 south, 3 west
  (the crossings at `$65D9`-`$6636`).
* `$892A`: the position along the facing inside the cell, 36 (`$24`) at
  the edge entered to 72 (`$48`) at the edge left: a step forward adds the
  step `$892C` (`$65B8`), at 72 or more the next cell is entered and the
  position becomes 36; a step back subtracts (`$64F6`), and below 36 the
  cell behind is entered at 72. `$8928`/`$8929`: the position across, set
  at a turn from `$892A` (`$665C`-`$6694`: pos - 36 or 72 - pos by the
  facing). *Measured*: tc.a8s has (35, 36), facing 0, `$892A` = 54, so the
  Floating Gate is at (35, 36) and the City Square north of it.
* `$892C`: the step, 6; nothing in the code writes it. *Measured*: six
  steps a cell.
* A turn is a quarter at once (`$6694`: facing - 1 for left, `$66A5`: + 1
  for right), followed by a redraw (`$66B0`: `JSR $5E78`).
* Input: the VBI (`$56E6` on) copies PORTA to `$C6` and counts frames in
  `$C7` (the disk code's timeouts) and `$B1` (`$BFA7` the seconds). The
  main loop reads the stick at `$64E1`: `LDA $C6; AND #$0F; EOR #$0F; STA
  $32`: bits 0-3 up (forward), down (back), left, right. `$64C9` has a
  key's code in A (KBCODE from `$646D`, or a pending command from `$AC`):
  `$0D`, `$01`, `$00` and `$05` are the game's own there; M (`$25`) and X
  (`$16`) fall through. It is reached on every pass while the key is held
  (SKSTAT bit 2 says whether one is).
* The cell's data is what stops the player: before a crossing, `$65CB`
  tests bits 0-1 of `$67BB`, the current cell's byte as copied for the
  renderer (rotated so that the side ahead is bits 0-1; below): 0 passes, 1
  bumps (`$65A2`, a click on CONSOL), 2-3 run the event at `$6546` (`$891C`
  = (value - 2) * 2 + 6, `$BFA0`, `$8773`: entering a building, the gate).

## The map

* The whole city is in memory: `$0800` + y * 64 + x, a byte per cell with
  the four sides in two bits each, north in bits 0-1, east 2-3, south 4-5,
  west 6-7 (*measured* on the 3 x 3 building at (28-30, 34-36): its corners
  carry exactly the two outward sides, `$41` north and west, `$05` north
  and east, `$50` south and west, `$14` south and east; its interior is 0,
  unreachable): 0 open, 1 wall, 3 a door or an event (the gate's north side
  is 3, the building's entrances are). And a second byte per cell at `$1800`
  + the same offset, the cell's kind: `$03` and `$05` on the streets and the
  City Square, the buildings' values (`$D0`, `$8E`, `$CE` ...) choosing their
  look and what they are. Both come from the disk in one read of 8 KB
  (sectors 393-461 of side 3 to `$0800`-`$27FF`, 69 sectors; a building's
  interior loads its own 8 KB over them and the city's come back on the way
  out).
* The redraw (`$5E78`) copies the 11 x 5 cells in front of the player
  (`$5EEA`: five rows of eleven, the player at column 5 of row 0) from both
  planes to `$67B6`-`$67EC` and `$67ED`-`$6823`, rows beyond the map as 0,
  and rotates the side bits by the facing (`$5FAC`-`$60AA`, ROR/ROL on
  `$67B6,X`). `$67BB` is the player's cell.

## The disk

The game does its own serial I/O, a state machine driven by the serial
interrupts (`$7C80`-`$81BE`; `$02D9` the state: 1 started, 9-10 the command
acknowledged, 11-12 complete, 13 (`$0D`) the data received, `$F4`-`$F8`
errors; `$8137` the timeout against `$C7`). No OS call anywhere.

* A read: `$7C92` takes the sector from `$0252`/`$0253`, the device from
  `$0250` (`$7AE6`, `$31`; after four failures `$7B8F` flips it with `$7AE7`
  to `$32` and back: into any drive), 'R' into `$0251`, and runs the
  transaction `$7F40`: the command frame (`$7CF4`: PBCTL `$3C`, the four
  bytes `$0250`-`$0253` and the checksum), the acknowledgements, 128 bytes
  into `$0255`-`$02D4`. A write, 'P', is `$7CC8`/`$80D3`: `$8038` builds the
  frame in the buffer (two random keys, two zero bytes, the sector number,
  the identity `$CD`/`$CE`, 120 bytes from `($65)`, scrambled the same way
  as a read is descrambled), `$814F` sends the command, `$7CF4` the data,
  and `$812D` ends it with state `$0D`. The caller `$7C2A` retries a write
  until it succeeds, with no prompt.
* From `$7F8A` the game descrambles the received bytes in place and checks
  them: `$80A8`-`$80D2`, for bytes 4-127, k0 = k0 + k1, k1 = k0 xor k1, byte
  xor= k1, the sum of the results in `$02DC`/`$02DD`, the keys starting as
  bytes 0 and 1. Then bytes 2-3 must be that sum (`$7F97`), bytes 4-5 the
  sector's own number (`$7FA7`) and bytes 6-7 the identity wanted in
  `$CD`/`$CE` (`$7FB7`; a near miss, the nibbles crossed, gives `$F4`/`$F5`:
  `$8006`-`$8037`), else `$F6`. Finally 120 payload bytes 8-127 are copied
  to `($65),Y` (`$7FF2`-`$7FFF`), unless bit 0 of `$CC` says the caller takes
  them from the buffer itself (`$7FEB`).
* *Measured* on the images: sides 2, 3 and 4 decode this way in 702 of 720
  sectors each, with the identities `$0250`, `$0122` and `$02E2` (the
  "Insert Disk 2 Side 2" prompt, `$7A60`, asked for side 4 at the Best
  Bargain Store); side 1 decodes in none (another format); the character
  disk in 4 (id `$C140`). The buffer in memory held sector 292 of side 3,
  decoded, matching the image byte for byte.
* The buildings' records: side 3, sectors 695-718, three a building for
  eight buildings, each 256 bytes at `$2700`-`$27FF` while the building's
  program runs (the Best Bargain Store's is 704-706, the Best Armorers'
  707-709). Entering a building loads its program (side 4: for the Best
  Bargain Store sectors 48-72 to `$A000`, 73-76 to `$0300`, 490-556 to
  `$0800`) and its record, by the table `$440E` walks for `$4523` (entries
  of identity, sector, destination and end, `$FFFF` ending it), then calls
  `$0800` (`$4571`); when that returns, "Leaving....." and the city's map
  comes back (`$45A6`, the table at `$46AB`). Leaving saves the record
  (`$2C0C` to `$7C0D`): a read of its first sector (which is where an
  "Insert Disk" prompt would come from), then for each 120 bytes from
  `($65)` a write and a read back (*measured*, tc6.a8s: 707-709 from
  `$2700`). So the game changes its own disk, and the character lives on
  side 3 ("Disk 2 Side 1").
* The record's first two bytes are a stamp: the character's id in
  `$8921`/`$8922` plus, in the first byte, the number of times the building
  has been left, which the city counts in RAM at `$2CA1`-`$2CA8` (a byte a
  building, zero at boot; `$2C00`-`$2CB4` is the jump table and variables
  the buildings' programs use). The program checks it on entry (`$098F`:
  `$2700` less the count must be `$8921`, `$2701` must be `$8922`, else it
  returns at once: "Leaving.....", and the player is outside again) and
  stamps it on leaving (`$0A6C`: the count up by one, added in). Loading
  the character into the city stamps all eight records with the id and no
  visits (*measured*: the image after a session, 695-718 all `54 00`, the
  two buildings visited `55 00`). In one session RAM and disk agree; a
  saved state brings its own session's counts, and then no building visited
  since lets the player in (tc10.a8s). disks.js sets the count from the
  stamp when a record's first sector is read (not during the save's own
  read of it, told by `$7C24` on the stack), which is what a continuous
  session would have had.
* A stream: `$7BB6` (and `$7C0D`, which writes first) reads sector after
  sector from `$0252` to `($65)`, 120 bytes a sector, until `$65`/`$66`
  reaches the end address in `$024C`/`$024D`: the callers set those up
  (`$32E2`, `$3405`, `$4410`, `$47A2`, `$4AA9`, `$6827`, `$6E3C`-`$6EAD`).
  *Measured*: the Best Bargain Store loads side 4 sectors 48-72 to
  `$A000`-`$AB40` (its program, over the picture buffers), 73-76 to
  `$0300`-`$0468` (the names of the special places: Thieves Guild, Blue
  Wizards Guild, Floating Gate, Arena, Palace, Dungeon Entrance ...), and
  490-556 to `$0800`-`$27FF` (its 8 KB of map); the city's map comes back
  from side 3 sectors 393-461. `$6827`, at the map's edge, reads sector 720
  (a 3-byte check, `$57`) and then sectors 18 on into `$0800`-`$17FF` and
  runs `$0800`: leaving the city.
* With a drive the read of a sector takes about four frames: a step read a
  few sectors and took 34 frames (*measured*, the emulator's drive); a
  building's 180 sectors are the "Entering...." screen.

disks.js (this directory) hooks `$7F40`: for 'R' it finds the sector in the
side whose copy decodes with the identity in `$CD`/`$CE`, puts the raw
bytes into `$0255`, sets `$02D9` to `$0D` and sends the PC to `$7F8A`: the
game's own descrambling and checks run on them. A sector no image gives
that way (the character disk, side 1) is left to the drive. It also hooks
`$80D6`, after the write's frame is built: a 'P' or 'W' whose frame carries
the identity of a side among the images goes into that image (the frame is
the sector as a drive would store it) and the image is written back to its
file, natively the .atr itself, in a browser the page's copy, and the
transaction ends at `$812D`; without this, with the reads served and no
disk in the drive, leaving a store retried the save for ever (tc6.a8s).
loader.js runs `$7F8A` to its RTS on the fake CPU: *measured*, ten
sectors a frame instead of three, the game's time per sector being the
descrambling. With both, a step's reads cost nothing and a building's 180
sectors take about 17 frames (the stream's own loop, which stops at the
hook each sector).

## The renderer

Not a wall-grid renderer like the Dungeon's: the buildings are pictures
scaled by distance into the 72 x 36 upper half of the picture, and the
lower half mirrors it.

* The pictures, 72 x 36 pixels at 2 bits each, 18 bytes a row, 648 bytes:
  the skyline at `$B04A`, the colonnade at `$B2D9`, mountains at `$B561`,
  the plain stone wall at `$B7E9`, the wall with a door at `$BA71`. A
  building's sign is patched into the door picture before it is drawn
  (`$636D`): 5 rows of 7 bytes at `$9D36` + 35 * n, n from bits 5-7 of the
  cell's kind byte, into rows 2-6 at byte 5 (`$BA9A` on; the `$BAF4` in the
  copy's operand is the last row's, the instruction being self-modified;
  *measured*: tc3.a8s, the game's picture had sign 3's rows at rows 2-6 and
  a copy at 7-11 read "SHOP INN"). The picture to
  draw is chosen per side at `$63E7`-`$6434`: a side of 3 takes the door
  with its sign (`$7764`), else the wall (`$776F`), or the colonnade when
  the cell's kind is `$B3` (`$7777`, the building along row 3 of the map).
* The widths (`$1B`): the far side of the player's own cell is as many
  pixels wide as the position byte `$892A`, 36 to 72, and each row farther
  halves it (`$61A1`, `LSR $1B`; `$63D5`-`$63DF`); the heights follow. A
  column k cells to the side sits at 36 - w / 2 + k * w (`$6341`). So a
  wall at distance d along the view, d = 36 k + r, is (72 - r) / 2^k pixels
  wide: linear within a cell, halving at each cell (*measured*: `$1B` 54,
  60, 66 as the player stepped toward the gate at 18, 12 and 6 units).
* The picture: 36 rows of 32 bytes, bytes 7-24 (`$70EE`, `$710A`); the
  interrupt narrows the playfield for its lines (`$BD7A`: DMACTL `$3D`),
  so the 32 bytes span 128 colour clocks from clock 64 and the picture's 72
  pixels screen x 96-239 (*measured*). Buffers at `$A000` and `$A6A1`; the
  skyline is copied in first (`$7128`: `$B04A` into bytes 7-24 of 36 rows)
  unless `$7B` | `$BF82` is 3 or more (fog, night: `$710A` fills the rows
  with `$FF`) or `$891D` is 1 (rain, below). The backdrop is one of four
  pictures by the facing, set after a turn (`$66C0`-`$6780`: north `$ADC2`,
  east `$B04A`, south `$AB3A`, west `$B55A`), which also places the second
  player's bar (`$D002`: `$7C`, `$7C`, `$00`, `$8C`). The copy takes bytes
  7-24 of each 18-byte source row (`$7150`, Y from `$18` down to 7), so a
  backdrop's picture begins 7 bytes after its address (*measured*: the
  buffer's rows equal the source at +7, not at +0, tc2.a8s facing east).
* The colours (*measured* on the screen against the bitmap): value 1 is
  COLPF0 (`$7A`, blue), 2 COLPF1 (`$06`, grey): the stones. Value 3 is
  COLPF2, which the picture's DLI (`$BD75`-`$BDC9`) loads on every line from
  the table at `$BDCA`: the sky above the horizon, the ground's browns
  below. Value 0 is the background, black, but over the picture lie two
  wide players (player 3 at `$5C` and `$7C` on alternate lines, quadruple
  width, its data `$FF`; priority 2 puts the playfields over players 2-3),
  whose colour the DLI also loads each line (`($0C),Y` xor `$06`, and
  `$BE12,Y`): dark reds about the horizon. So the skyline's silhouette
  (value 0) is red, the sky through a facade's sign (value 3) light, and
  nothing of this is in the bitmap.
* Weather. `$891B` counts down (`$58DC`); when it runs out the month
  `$8918` (0-11; `$8916` minutes, `$8917` hours of 27, `$892D` the hour of
  24 used for the colours) picks the odds from the tables at `$3738`,
  `$3744`, `$3750`, `$375C` against the random register, and the result is
  `$891E` (1 or `$FF`) and `$891D` (1: rain, `$593F`; it is 0 for fair
  weather, and never set while `$4670` is 1, an encounter begun in fog or
  night, `$4663`). In rain the renderer leaves the skyline out (`$7131`),
  priority goes to `$14`, and the picture's DLI takes another path
  (`$BD95` to `$BE8B`, `$3452`): on every line it sets COLPF2 to a random
  pick, the sky lines (the first 21) black or dark grey (`$00`/`$02`), a
  black band below, the ground lines (the last 36) a dark cyan of random
  brightness (`$90`-`$96`), and COLPM2/3 a dark blue (`$82` & random);
  with `$2CAF` set (`$348E`) the sky goes blue-grey and the ground white
  (lightning). So the picture flickers on every line each frame: not a
  bug, the rain (tc7.a8s, a night of rain at the City Square). The drops
  are players 2 and 3 and missile 3 (`$0600`, `$0700` and `$0300` bits
  7-6): the VBI moves their lines 80-150 down one line a frame and puts
  random bits (three randoms anded, so sparse) in at the top (`$5692`),
  the DLI places them for the picture (player 2 doubled at `$7C`, player 3
  quadrupled at `$5E` or `$7F` by the frame's parity, missile 3 quadrupled
  at `$9C`; priority 1, in front of the playfield). When it stops
  (`$59ED`) player 3 and the missiles go back to being the bar (`$FF`
  and `$F0` in lines 80-150) with priority 2.
* Player 2 in fair weather (`$0600`, single-line, 8 pixels at `$D002` by
  the facing: `$7C`, `$7C`, `$00`, `$8C`, the `$00` off the picture) is a
  picture of the game's behind the playfield: priority 2 puts it under all
  four playfield colours, so it shows only where the picture has value 0
  over it, coloured a line at a time by the DLI from the table at `($0C)`
  xor `$06` (`$3F`/`$2F` above the horizon in tc9.a8s; below the horizon
  exactly the ground's line colours). The sun or star: a shape the game
  alternates every frame (`$5A2C`, by bit 0 of `$14`, two tables from
  `$5A84`) at a height from `$0B`, with a disc below the horizon as its
  reflection (unseen, the colours being the ground's), shown through a hole
  of value 0 the game punches into the sky for it (*measured*: tc9.a8s,
  rows 5-11 of the buffer differ from the backdrop). Or a zigzag down all
  36 lines (`$38`/`$1C` a line, tc11.a8s facing south, at `$8C`), which
  shows through the skyline's silhouette as a waterfall between two peaks.
* What is drawn: the window's cells row by row, each cell's far side (the
  side ahead, bits 0-1 after the rotation) as a frontal picture at the
  row's width, with the sign of the cell beyond (the draw list at `$6265`
  holds that cell's kind: *measured*, tc3.a8s, SHOP for the building ahead,
  kind `$77`), and each cell's outer side (away from the player's column:
  `$60E2`, bits 6-7, through `$6286`, which spans the row's width and twice
  it, a trapezoid), a door with its sign when the side is a 3. So an edge shows when the
  cell on the player's side of it carries it, and not when only the cell
  beyond does: *measured*, at (34, 35) facing east the gate's north side,
  carried by the gate's cell beyond the edge, is not in the picture; in
  tc4.a8s, facing west at (35, 34), the north side of the street cell
  (34, 33), carried by that cell, is, as a door wall at an angle on the
  right with its sign; at (34, 34) facing north the door
  two columns right and a row ahead, (36, 33), is at the right edge, where
  only its far side's row and width put it. The nearer face covers the
  farther through a column buffer at `$61BD` (72 entries).
* The hottest loops while walking (*measured*): `$7282`-`$73CB` (27-40 %
  of the cycles), `$7786`-`$79CF`, `$7128`-`$71BC`, `$7680`-`$7763`, the
  DLI `$BD9F`-`$BDC9`; `$7184` is the scaler (`$22` = 72 over the width).
  The profile-driven accelerator of common.js skips them, seeded with these
  four and profiling once more for 60 frames, then never again: while a
  profile is taken the game walks at its own slow pace, which made the
  walking jerky every 1500 frames. The disk code `$7A60`-`$81FF` (the prompt, the stream, the transaction) is never
  accelerated: a fake run through `$7C92` would call the transaction with
  the hook unseen, the serial wait would run out its budget and the game
  see a timeout, and after four the "Insert Disk" prompt (*live*, tc1.a8s,
  in an encounter: the request was side 3 sector 345, which the image has).
* Encounters: `$7E` is `$FF` while one is on (`$5769`); the encounter's
  program is loaded over the map at `$0800` (`$2C71`: `JMP $091E`, reached
  from `$4A62`), with its texts at `$0300`, and the map comes back after.
  The monster is players 0 and 1 (`$0400`/`$0500` in single-line resolution,
  PMBASE 0), normal width, at `$79`/`$78`, colours `$40`/`$26` (*measured*);
  the players' areas are cleared at `$4A56`.

## What view3d.js does with this

The streets are redrawn with OpenGL from a copy of the map (taken while
the streets are shown: an encounter's or a building's code lies over
`$0800`-`$27FF` otherwise), with the game's projection: pixels per unit at
distance d are 2 at the eye, 1 a cell away, halving each cell, the same
across and up, so a wall is where the game draws it (the game, drawing a
row at a time, has the near facade full height for the whole cell and the
next row half; the view's heights follow its widths). Between the cells
the view takes the exponential through those points, 2^(1 - d / 36),
unless "Projection: Game" asks for the game's linear pieces: those make a
wall ahead grow fast on entering a cell and slower toward its end (the
growth is a fixed number of pixels a unit, a shrinking share of the
width), then fast again past the boundary, which is felt as a walk that is
quick, slow, quick in every cell (*live*); the two laws differ by 6 % at
most, mid-cell.
The eye is 36 to 72 along the facing by `$892A`, in the middle across, as
the game's own renderer has it, kept half a unit inside the cell at both
ends: at 72 the game stands against a wall and draws it over the whole
picture, and an eye on the wall's plane looked through it into the next
cell (tc12.a8s). What lies nearer than a quarter unit is cut off, no more:
the game's law has no singularity at the eye. Walls are the map's sides, a segment drawn when
the cell on the eye's side of it carries it, with the sign of the cell
beyond: a side of 1 the stone picture, 3 the door with that sign, every
side of a `$B3` cell the colonnade; the facade on the upper half of the wall and upside down on the
lower, as the game mirrors it, or over the whole wall ("Facades: Full"). The colours are sampled from the game's own picture on the screen
each frame (one readPixels of the picture's rectangle): the sky and the
ground line by line from value-3 pixels, the players' colour from value-0
pixels, the stones from values 1 and 2; the sky and the ground are drawn
as 72 bands behind everything, the skyline picture (its value 0 in the
players' colours of its lines, mirrored below) on the horizon, and the
facades' see-through pixels painted over the walls in the colours of the
lines they fall on, which is what the game shows through them (the player's
bar covers half the width on each line, so its colour is taken from a
value-0 pixel that is not black; and since the game switches its two
buffers in the vertical blank, which of them the screen shows at the read
is uncertain by a frame, a pixel is trusted only where both buffers agree
on its value, and the stones' colours are the most frequent of several
samples: without that every step flashed a frame of wrong colours). A
line the screen cannot answer for (a wall over the whole picture leaves no
sky pixel: tc12.a8s had black bands) takes the colour from the table the
DLI itself loads, `$BDCA` for the register and `$BE12` for the bar, both
indexed by 71 less the line. The backdrop is the game's four pictures, one a
facing (north `$ADC2`, east `$B04A`, south `$AB3A`, west `$B55A`, chosen
after a turn at `$66C0`-`$6780`), laid side by side as a panorama the
view's 72 columns look into at the eye's yaw, so a turn slides the horizon
round; it is not mirrored: below the horizon the game gives its silhouette
and the ground one colour. Walls and the ground's cells are cut at the
near plane with their texture coordinates, so the cell or wall the player
stands in shows the part of the picture that is ahead, not the whole
picture squeezed into what is left. The view projects its own points
(the game's law is not a perspective), so each vertex goes to GL
homogeneous, with w the inverse of its scale: the picture's x and y are
l / w and h / w, a perspective projection of a world whose depth is w, and
GL interpolates the textures in perspective; given plain screen points it
interpolated them linearly per triangle, which kinked a wall's picture
along the quad's diagonal (half frontal, half at an angle: tc8.a8s) and
warped the cobbles into zigzags. "Sky and
ground" draws the 72 lines as bands (the game's look), as one gradient
through the pairs' colours (the game dithers two lines a shade), or the
ground as a cobbled plane tinted by the lines' colours. An encounter's
monster is rebuilt from the players' data and registers and drawn over the
view. Player 2 in fair weather (the sun or star, the waterfall) is drawn
the same way behind the walls, over the sky and the skyline, in its
per-line colours, above the horizon only, and only at the pixels where the
game's own picture has value 0 under it, as the game shows it (drawn
whole, the waterfall's zigzag stood from the top of the sky to the
horizon: tc11.a8s); and the players' colour is not sampled from a pixel
under it (it made the mountains and a sign on its lines flash pink:
tc9.a8s). In rain (`$891D`) the view goes on: no skyline, the players'
colour black (the bar is gone), each line's colour the most frequent among
its first value-3 pixels (a drop may cover one), the drops rebuilt from
players 2-3 and missile 3 like the monster and drawn over everything, and
the sky and the ground either flickering as the game's do ("Rain: Game")
or settling to the mean of the random colours over a few frames ("Rain:
Calm", the default). Turns are interpolated between the game's facings
over 12 frames. For steps the eye walks toward the game's position at the
walking speed (the units a second the walk module sets, or the game's 6
every 16 frames), keeping about a step behind: the steps land on
irregular frames (the game's loop, the disk, a 3-4-3-4 cadence at 1.5x)
and spreading each step over the previous gap made the eye stall or jump
a frame at a time; a little faster when further behind and slower when
nearer, so the advance a frame varies by a tenth, not from zero to a
peak (*measured*: 0.51-0.65 units a frame at 1.5x, nominal 0.5625). The textures are rebuilt
only when their colours have held for six frames. The wide layout puts the view over the
whole width (336 x 168, still 2:1) with the game's top block (lines 0-71)
shrunk into the 36 lines above and the text rows in use below it (found in
the display list, as the Dungeon's) into the band below, which grows upward
for an encounter's menu; with the Atari view the game's own picture is
smoothed (smooth2d.js, Scale2x twice over its mode-E pixels) in its place
or enlarged into the wide view, and in a building its picture, 320 x 72
across the whole width (the display list's head with another continuation,
`$2E16` for the Best Armorers: tc6.a8s), is smoothed in its place.

## Methods

* The browser harness: the state loaded by a test that first writes the
  disk images into the module's file system at the path the state names
  (`../a8ext/ext/altreal/...`), so that the emulated drive has one; whole
  memory dumps before and after steps and turns, diffed; cycle profiles
  (`a8.profile`) and the PC sampled at frame ends; sectors logged by the
  extension (`disks.log`).
* The disassembler and the dumps are in the session's scratch directory;
  the facts above name the addresses so that they can be checked again.
