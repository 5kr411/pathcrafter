.PHONY: build clean test test-planner test-analyzer bot-collect bot-craft-inv bot-craft-table bot-main bot-mine bot-mine-oneof bot-smelt

# Build TypeScript sources
build:
	npm run build

# Clean compiled files
clean:
	rm -rf dist/

# Run test suite
test: build
	npm test

# Test scripts
test-planner: build
	node testPlanner.js

test-analyzer: build
	node testRecipeAnalyzer.js

# E2E Bots
bot-collect: build
	node bots/collect_paths.js

bot-craft-inv: build
	node bots/craft_inventory.js

bot-craft-table: build
	node bots/craft_table.js

bot-main: build
	node bots/main.js

bot-mine: build
	node bots/mine_block.js

bot-mine-oneof: build
	node bots/mine_one_of.js

bot-smelt: build
	node bots/smelt_only.js

