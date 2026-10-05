# a8ext: game extensions for atari800

Scripts that change how particular Atari 8-bit games look and run inside the
[atari800](https://github.com/MarcinZukowski/atari800) emulator: scenes drawn
again in 3D from the games' own data, faster drawing, smoother pictures,
maps, and so on. Each directory here is one game's extension, with notes on
how the game works inside (`<name>/<name>.md`).

The extensions are JavaScript. The emulator's fork provides the framework
that runs them, on its `better-yoomp` branch: hooks into the emulated
machine, an `a8` object for its memory and registers and a `gl` object for
drawing. Its API reference is
[data/ext/README.md](https://github.com/MarcinZukowski/atari800/blob/better-yoomp/data/ext/README.md)
in that repository; this one holds only the games.

## Running them

**In the emulator.** Build the fork with `--with-ext` (see its README), then
point it at the `ext/` directory here:

    atari800 -ext-dir /path/to/a8ext/ext

or put `EXT_DIR=/path/to/a8ext/ext` in the emulator's configuration file. Start
a game and press TAB: the extension whose fingerprint matches the program in
memory is offered with its options.

**In a browser.** The fork also builds as a web page that runs the same
scripts. `make` here builds that page with these extensions into `dist/`
(it needs Emscripten and a checkout of the fork):

    make ATARI800=/path/to/atari800     # or set ATARI800 in config.mk
    make serve                          # http://localhost:8800

Everything in `site/` is copied into `dist/` as well: put a `demos.json`
there, and the programs it lists, to have them offered on the page (the
format is in the fork's `web/README.md`). The page also carries the fork's
own self-test extension, listed under Demos: it checks the emulator built
into the page and reports in the log. Mind the rights before publishing
programs: a saved state contains the game and the operating system ROM it
was saved with.

`ATARI800_VERSION` names the commit of the fork these scripts were last
tested with.

## Layout

Everything the emulator loads is under `ext/`, laid out as the page serves it:

* `ext/<name>/init.js` - an extension: its default export is the extension object
* `ext/<name>/*.js`, data files - what it imports and loads; it finds them through `a8.extDir`
* `ext/<name>/<name>.md` - notes on the game's internals
* `ext/common.js`, `ext/smooth2d.js` - helpers shared by the extensions
* `ext/extensions.json` - where the page's "Source" link points

# Games extended (in order of creation)

These games are also discussed in [this video on YouTube](https://www.youtube.com/watch?v=075qLp5kIlc).

* Yoomp!: [yoomp/init.js](ext/yoomp/init.js) (originally in C, now JavaScript); the game's disk,
  [yoomp.atr](ext/yoomp/yoomp.atr) (version 1.1), comes with it as the page's first demo, with a
  saved game ([yoomp-gameplay.a8s](ext/yoomp/yoomp-gameplay.a8s), its ROMs the Altirra ones) as
  its "(gameplay)" variant
  * the tunnel drawn with OpenGL ([yoomp/tunnel.js](ext/yoomp/tunnel.js)): a cylinder textured
    with the game's own tile pixels of the moment, read from its texture ring buffer, through
    the projection its lookup table encodes (the geometry is in the file's header comment,
    from the game's source); "Smooth tiles" scales the texture with Scale2x and filters it,
    "Fog" darkens it a little toward the far end; it follows the earthquake's shaking of the
    display list; the 3D balls turn with the game's own jump cycle, so they stand still when
    the game does
  * various 3D balls
  * one high-res background
* Mercenary: [mercenary/init.js](ext/mercenary/init.js), [mercenary.md](ext/mercenary/mercenary.md) (originally in C, now JavaScript)
  * accelerated Atari-like line drawing
  * the 3D scene redrawn with OpenGL from the game's own geometry: exact vertex positions
    and view angles are read as the game projects them, the transform is redone in floating
    point, and edges are drawn between sub-pixel end points (3 line styles)
  * faces found in each model's edge graph (coplanar chordless cycles) and drawn as translucent
    "glass" or shaded polygons under the lines
  * the 3D window as a scene ([mercenary/view3d.js](ext/mercenary/view3d.js)), each part its own option:
    sky and a ground plane with an exact horizon instead of the game's row-by-row fill, lines as
    ribbons that thin out with distance, ground marks cut at the horizon as the game's pen trick
    cuts them, rooms drawn solid, a light grain over ground and faces, fog and lighting
  * an FPS option: the game moves a fixed amount a pass of its main loop (one frame each), and
    with the drawing done here a pass takes two display frames instead of the original's six to
    ten, so the passes are held to 8 a second (the original's pace), 12 (the default), 20, or
    not at all
* Zybex: [zybex/init.js](ext/zybex/init.js), [zybex.md](ext/zybex/zybex.md) (originally in C, now JavaScript)
  * scrolling background (grayscale and color modes)
* Behind Jaggi Lines: [bjl/init.js](ext/bjl/init.js) (originally in C, now JavaScript)
  * faster rendering
* Alternate Reality: [altreal/init.js](ext/altreal/init.js), [altreal.md](ext/altreal/altreal.md) (originally in C, now JavaScript)
  * faster rendering
  * smooth walking: small steps instead of five big ones per cell, at the game's own speed or
    1.5, 2 or 3 times it (needs the acceleration, see the notes for how the engine moves), and
    one quarter turn per push of the stick
  * the maze redrawn with OpenGL ([altreal/view3d.js](ext/altreal/view3d.js)): the level map is read
    from memory and drawn with the game's own projection (so both views agree), plus fog,
    shading and interpolated steps and turns, with the game's monster sprites drawn over it;
    the walls, doors
    and arches carry the game's own art, decoded from its memory in the game's current colours
    (so the picture flashes when the game flashes it), optionally upscaled 4x with Scale2x
    (the monster sprites too), and
    arches open onto what lies beyond. A wide layout puts the view over the whole width with the
    game's texts and compass shrunk above and below it. In a dark area lit only by the player's
    torch (the game's own test), the torch is a light at the player's position: it falls off with
    the distance, so what is near is light and the corridor's end dark, and its flame flickers a
    little, which shows on the near walls ("Torch light")
  * the game's own pictures, shop interiors and the Atari view, smoothed the same way
    ([altreal/smooth2d.js](ext/altreal/smooth2d.js)): read back from the framebuffer at the game's
    pixel grid, upscaled and drawn over their place
  * an automatic map ([altreal/automap.js](ext/altreal/automap.js)): the cells visited and seen are
    remembered, the M key shows the level's map with walls, doors, arches, the player, the kinds
    of the cells named from the game's own location line, and marks set with the digit keys; the
    record is a file per character in `ext/altreal/maps/`, so it survives states and restarts;
    in a browser "Show map" keeps the map at the bottom of the page's panel beside the screen
  * no disk swapping: boot from side 1 as usual, then the game's sector reads are served from the
    five disk images placed in `ext/altreal/` ([altreal/disks.js](ext/altreal/disks.js)), so "Please
    insert Disk..." never comes up (the game only ever reads)
    The notes document the engine: map, movement, picture buffer, art and renderer
* Numen: [numen/init.js](ext/numen/init.js), [numen/world3d.js](ext/numen/world3d.js) (the demo's sector levels drawn with OpenGL), [numen.md](ext/numen/numen.md)
  * the 3D scenes drawn again with OpenGL ([numen/world3d.js](ext/numen/world3d.js)): the demo's engine is a
    sector renderer, and its level tables (sectors with floor and ceiling heights, walls, sprites, the
    backdrop) are read from memory and drawn through the demo's own camera at the window's resolution,
    with the camera gliding between the demo's positions; optional shading, shadows and a light fog,
    the view over the whole picture, a ground texture (a grain, dithers as tiles) and smooth edges.
    Works for the forest and the maze; the notes document the engine's tables and projection
  * the demo's 3D scenes run about ten times faster: the hottest code, found with the emulator's profile,
    runs in no emulated time (`createAccelerator` in [common.js](ext/common.js), usable by any game)
  * their picture smoothed with Scale2x over the scene's 4 x 4 pixel grid ([smooth2d.js](ext/smooth2d.js),
    the shared smoother that Alternate Reality's shops use too)
* Robbo: [robbo/init.js](ext/robbo/init.js), [robbo.md](ext/robbo/robbo.md)
  * the level drawn with OpenGL in a slight perspective ([robbo/view3d.js](ext/robbo/view3d.js)): the
    floor in the level's colour, walls as blocks, the other tiles as cards above the floor with
    shadows, the art upscaled with Scale2x, the camera following the game's scrolling
* River Raid: [river-raid/init.js](ext/river-raid/init.js), [river-raid.md](ext/river-raid/river-raid.md) (originally in C, now JavaScript)
  * 3D rendering
  * custom sounds example

## Reverse-engineering games

The best way to detect where the time is going is to use the
`TRACE` functionality of Atari800:
* start a game
* enter the monitor (`F8`)
* type: `trace file.trace` - this starts recording the trace to `file.trace`.
* type: `cont` - this returns to the game
* play for some time (not too long, a few seconds should be enough)
* enter the monitor again (`F8`)
* type: `trace` - this stops the recording
* type: `quit`

Now, you can use the helper tool in the emulator's fork to analyze the `file.trace`, by running:

    tools/trace-postprocess.py < file.trace

This will show the memory areas where we spend most time (based on how often code is execute there).
