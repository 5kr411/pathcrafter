.PHONY: build clean test bot-collect bot-collect-multi bot-craft-inv bot-craft-table bot-main bot-mine bot-mine-oneof bot-mine-anyof bot-smelt bot-attack bot-follow-attack bot-hunt bot-shield bot-food bot-agent bot-agent-config e2e

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
	node dist/bots/collect_paths.js $(if $(TARGETS),--targets "$(TARGETS)")

# Run multiple collector instances (default 10)
# Usage: make bot-collect-multi [NUM=10] [HOST=localhost] [PORT=25565] [NAME=collector]
bot-collect-multi: build
	node dist/bots/collect_paths_multi.js $(or $(NUM),10) $(or $(HOST),localhost) $(or $(PORT),25565) $(or $(NAME),collector) $(if $(TARGETS),--targets "$(TARGETS)")

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

bot-attack: build
	node dist/bots/attack_entity.js

bot-follow-attack: build
	node dist/bots/follow_and_attack_entity.js

bot-hunt: build
	node dist/bots/hunt_entity.js

bot-shield: build
	node dist/bots/shield_defense.js

bot-food: build
	node dist/bots/food_collection.js

bot-agent: build
	node dist/bots/collector_runner.js --targets "$(TARGETS)" $(if $(NUM),--num-bots $(NUM)) $(if $(TIMEOUT),--timeout $(TIMEOUT)) $(if $(HOST),--host $(HOST)) $(if $(PORT),--port $(PORT))

bot-agent-config: build
	node dist/bots/collector_runner.js --config $(CONFIG)

# E2E: spin up disposable Minecraft server and run bot swarm
e2e: build
	node dist/e2e/run_e2e.js --targets "$(TARGETS)" $(if $(NUM),--num-bots $(NUM)) $(if $(TIMEOUT),--timeout $(TIMEOUT)) $(if $(BIOME),--biome $(BIOME)) $(if $(DIFFICULTY),--difficulty $(DIFFICULTY))

# -- Dev harness --------------------------------------------------------------
# Drive a swarm of LLM-agent bots in real time via filesystem chat channels.
#
#   make dev-up ROSTER=scripts/dev-roster.example.json
#   make dev-say MSG='@agent_claude hi'
#   make dev-tail
#   make dev-logs BOT=agent_claude
#   make dev-down

DEV_ARTIFACT_GLOB := artifacts/dev-*
LATEST_RUNDIR = $$(ls -dt $(DEV_ARTIFACT_GLOB) 2>/dev/null | head -n 1)
RUNDIR ?= $(LATEST_RUNDIR)

.PHONY: dev-up dev-down dev-say dev-tail dev-logs

dev-up:
	@test -n "$(ROSTER)" || (echo "ROSTER=path/to/roster.json required" && exit 1)
	npx tsc
	node dist/e2e/run_dev.js --roster $(ROSTER) $(DEV_ARGS)

dev-say:
	@test -n "$(RUNDIR)" || (echo "no dev rundir found" && exit 1)
	@test -n "$(MSG)" || (echo "MSG='...' required" && exit 1)
	@printf '%s\n' '$(MSG)' >> $(RUNDIR)/chat_in
	@echo "sent to $(RUNDIR)/chat_in: $(MSG)"

dev-tail:
	@test -n "$(RUNDIR)" || (echo "no dev rundir found" && exit 1)
	tail -f $(RUNDIR)/chat_out

dev-logs:
	@test -n "$(RUNDIR)" || (echo "no dev rundir found" && exit 1)
	@test -n "$(BOT)" || (echo "BOT=<botname> required" && exit 1)
	tail -f $(RUNDIR)/$(BOT).log

dev-down:
	@pkill -f "dist/e2e/run_dev.js" || true
	@docker rm -f pathcrafter-e2e 2>/dev/null || true
