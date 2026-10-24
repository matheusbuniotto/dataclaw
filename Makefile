# The DataClaw console, locally.
#
#   make start     start it in the background, wait until it answers, print the URL
#   make run       run it in the foreground (Ctrl-C stops it)
#   make restart   down, then start
#   make down      stop it, including a server started by hand
#   make clean     drop runtime state and build caches; your data stays
#
#   make status    is it up, and on what port
#   make logs      tail the background log
#   make clean-all stop, then drop node_modules, the database and local plugins
#
# Override per invocation:  make start PORT=3001 HOST=0.0.0.0

SHELL := /bin/sh
.DEFAULT_GOAL := help

HOST ?= 127.0.0.1
PORT ?= 3000
BASE_URL := http://$(HOST):$(PORT)

TARGET ?= dev
PROFILE ?= dev
APP_NAME ?= dataclaw

BUN ?= bun
ENTRY := src/console/api/server.ts

# `.run/` is gitignored; keeping the pidfile and log there means `logs` stays a command.
RUN_DIR := .run
PID_FILE := $(RUN_DIR)/console.pid
LOG_FILE := $(RUN_DIR)/console.log

# Cheap and side-effect free: reads the capability catalog — no harness, no Databricks auth.
PROBE := $(BASE_URL)/api/capabilities

.PHONY: help start run restart down status logs clean clean-all dab-validate dab-deploy dab-logs vps-start vps-run

help:
	@echo "DataClaw Console:"
	@echo "  make start         start the console in the background and wait until it answers"
	@echo "  make run           run it in the foreground (Ctrl-C stops it)"
	@echo "  make restart       down, then start"
	@echo "  make down          stop it, including a server started by hand"
	@echo "  make status        is it up, and on what port"
	@echo "  make logs          tail the background log"
	@echo "  make clean         drop runtime state and build caches; the database and workspace stay"
	@echo "  make clean-all     stop, then drop node_modules, the database, per-agent homes, plugins"
	@echo
	@echo "Databricks Apps & DAB (Asset Bundles):"
	@echo "  make dab-validate  validate Databricks Asset Bundle (TARGET=dev PROFILE=dev)"
	@echo "  make dab-deploy    deploy DataClaw to Databricks Apps via bundle/script"
	@echo "  make dab-logs      tail Databricks Apps runtime logs"
	@echo
	@echo "VPS / Server Production Runner:"
	@echo "  make vps-start     start on 0.0.0.0 in background (NODE_ENV=production)"
	@echo "  make vps-run       run on 0.0.0.0 in foreground (NODE_ENV=production)"
	@echo
	@echo "Override per invocation: make start PORT=3001 HOST=0.0.0.0"

# One shell for the whole target: a guard that finds a live server must stop the recipe, and
# separate recipe lines would each run in their own shell and carry on regardless.
start: $(RUN_DIR)
	@if [ -f "$(PID_FILE)" ] && kill -0 "$$(cat $(PID_FILE))" 2>/dev/null; then \
		echo "already running (pid $$(cat $(PID_FILE))) at $(BASE_URL)/console"; \
	elif curl -fsS -o /dev/null --max-time 1 "$(PROBE)" 2>/dev/null; then \
		echo "something already answers on $(BASE_URL) — run 'make down', or pick another PORT"; \
		exit 1; \
	elif ! command -v $(BUN) >/dev/null 2>&1; then \
		echo "$(BUN) is not on PATH"; exit 1; \
	elif [ ! -d node_modules ]; then \
		echo "node_modules is missing — run: bun install"; exit 1; \
	else \
		HOST=$(HOST) PORT=$(PORT) nohup $(BUN) run $(ENTRY) > $(LOG_FILE) 2>&1 & \
		echo $$! > $(PID_FILE); \
		printf "starting (pid %s) " "$$(cat $(PID_FILE))"; \
		i=0; \
		while [ $$i -lt 60 ]; do \
			if curl -fsS -o /dev/null --max-time 2 "$(PROBE)" 2>/dev/null; then \
				echo; echo "ready: $(BASE_URL)/console"; exit 0; \
			fi; \
			if ! kill -0 "$$(cat $(PID_FILE))" 2>/dev/null; then \
				echo; echo "it exited on startup — last of $(LOG_FILE):"; \
				tail -n 20 $(LOG_FILE); rm -f $(PID_FILE); exit 1; \
			fi; \
			printf "."; sleep 0.5; i=$$((i + 1)); \
		done; \
		echo; echo "not answering after 30s — see $(LOG_FILE)"; exit 1; \
	fi

run: $(RUN_DIR)
	@HOST=$(HOST) PORT=$(PORT) exec $(BUN) run $(ENTRY)

restart: down start

down:
	@if [ -f "$(PID_FILE)" ]; then \
		pid=$$(cat $(PID_FILE)); \
		if kill -0 "$$pid" 2>/dev/null; then \
			kill "$$pid" 2>/dev/null; \
			i=0; while [ $$i -lt 40 ] && kill -0 "$$pid" 2>/dev/null; do sleep 0.25; i=$$((i + 1)); done; \
			kill -0 "$$pid" 2>/dev/null && kill -9 "$$pid" 2>/dev/null; \
			echo "stopped (pid $$pid)"; \
		else \
			echo "not running (stale pidfile)"; \
		fi; \
		rm -f $(PID_FILE); \
	else \
		echo "not running"; \
	fi
	@# `bun run` keeps the entry as a child, and a server started by hand has no pidfile at all.
	@if pgrep -f "$(ENTRY)" >/dev/null 2>&1; then \
		pkill -f "$(ENTRY)"; echo "stopped a leftover $(ENTRY)"; \
	fi

status:
	@if [ -f "$(PID_FILE)" ] && kill -0 "$$(cat $(PID_FILE))" 2>/dev/null; then \
		printf "pid %s · " "$$(cat $(PID_FILE))"; \
	else \
		printf "not started by make · "; \
	fi; \
	if curl -fsS -o /dev/null --max-time 2 "$(PROBE)" 2>/dev/null; then \
		echo "answering on $(BASE_URL)/console"; \
	else \
		echo "nothing answering on $(BASE_URL)"; \
	fi

logs: $(RUN_DIR)
	@test -f $(LOG_FILE) || { echo "no log yet — run 'make start'"; exit 1; }
	@tail -n 40 -f $(LOG_FILE)

clean: down
	@rm -rf $(RUN_DIR) dist out coverage .cache
	@rm -f ./*.tsbuildinfo
	@echo "dropped runtime state and build caches — the database and workspace are untouched"

clean-all: down
	@printf "This deletes node_modules, the SQLite database, per-agent homes and local plugins.\nContinue? [y/N] "
	@read answer && [ "$$answer" = "y" ] || { echo "aborted"; exit 1; }
	@rm -rf node_modules plugins workspace/agents dataclaw.plugins.json dataclaw.capabilities.json
	@rm -f *.sqlite *.sqlite-wal *.sqlite-shm
	@$(MAKE) --no-print-directory clean

$(RUN_DIR):
	@mkdir -p $(RUN_DIR)

# Databricks Asset Bundle & Apps
dab-validate:
	databricks bundle validate -t $(TARGET) --profile $(PROFILE)

dab-deploy:
	./deploy/databricks/deploy.sh $(APP_NAME) $(TARGET) $(PROFILE)

dab-logs:
	databricks apps logs $(APP_NAME) --profile $(PROFILE)

# VPS / Remote Server Runner
vps-start:
	@HOST=0.0.0.0 PORT=$${PORT:-3000} NODE_ENV=production $(MAKE) start

vps-run:
	@HOST=0.0.0.0 PORT=$${PORT:-3000} NODE_ENV=production $(MAKE) run
