# Builds the web site: the atari800 fork's web build (the emulator as
# WebAssembly and the page that hosts extensions) with the extensions of this
# repository, plus whatever is in site/ (demos.json, programs to show).
#
#   make            build dist/
#   make serve      serve dist/ on http://localhost:8800
#   make clean
#
# ATARI800 is a checkout of the fork; set it here, on the command line, or in
# config.mk (which is not tracked).

ATARI800 ?= ../atari800
-include config.mk

OUT = $(CURDIR)/dist

all:
	@test -f $(ATARI800)/web/Makefile || { echo "No atari800 web build at $(ATARI800): set ATARI800"; exit 1; }
	$(MAKE) -C $(ATARI800)/web EXT_DIR=$(CURDIR) OUT=$(OUT)
	@if [ -d site ]; then cp -R site/. $(OUT)/; fi
	@echo "Built $(OUT) with atari800 at $$(git -C $(ATARI800) rev-parse --short HEAD) (tested with $$(cut -c1-8 ATARI800_VERSION))"

serve: all
	cd $(OUT) && python3 -m http.server 8800

clean:
	rm -rf $(OUT)

.PHONY: all serve clean
