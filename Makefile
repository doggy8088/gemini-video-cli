.DEFAULT_GOAL := help

NODE ?= node
NPM ?= npm
ARGS ?= --help

.PHONY: help install install-global test check verify run demo pack clean

help:
	@printf '%s\n' \
	  'Common tasks:' \
	  '  make install         Install locked dependencies with npm ci' \
	  '  make install-global  Install the gemini-video command globally' \
	  '  make test            Run automated tests' \
	  '  make check           Check JavaScript syntax' \
	  '  make verify          Run tests and syntax checks' \
	  '  make run ARGS="..."   Run the CLI (defaults to --help)' \
	  '  make demo            Preview the mixed-video example offline' \
	  '  make pack            Create an npm tarball in dist/' \
	  '  make clean           Remove generated dist/ artifacts'

install:
	$(NPM) ci

install-global:
	$(NPM) install --global .

test:
	$(NPM) test

check:
	$(NPM) run check

verify: test check

# Keep STDOUT clean for CLI output and preserve piped prompt input.
run:
	@$(NODE) src/cli.js $(ARGS)

demo:
	@$(NODE) src/cli.js --manifest examples/mixed-videos.json --prompt-file examples/compare.txt --dry-run

pack:
	@mkdir -p dist
	$(NPM) pack --pack-destination dist

clean:
	@$(NODE) -e 'require("node:fs").rmSync("dist", { recursive: true, force: true })'
