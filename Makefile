.PHONY: build clean test bot-collect bot-craft-inv bot-craft-table bot-main bot-mine bot-mine-oneof bot-mine-anyof bot-smelt

# Build TypeScript sources
build:
	npm run build

# Clean compiled files
clean:
	rm -rf dist/

# Run test suite
tests: build
	npm test

# E2E Bots
bot-collect: build
	node dist/bots/collect_paths.js

bot-craft-inv: build
	node dist/bots/craft_inventory.js

bot-craft-table: build
	node dist/bots/craft_table.js

bot-main: build
	node dist/bots/main.js

bot-mine: build
	node dist/bots/mine_block.js

bot-mine-oneof: build
	node dist/bots/mine_one_of.js

bot-mine-anyof: build
	node dist/bots/mine_any_of.js

bot-smelt: build
	node dist/bots/smelt_only.js

