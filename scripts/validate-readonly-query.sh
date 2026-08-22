#!/bin/bash
# Blocks the verifier agent from mutating anything it is supposed to be checking.
# Wired via PreToolUse in .claude/agents/verifier.md

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -iE '\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|MERGE)\b' > /dev/null; then
  echo "Blocked: verifier is read-only, write operations not allowed" >&2
  exit 2
fi

exit 0
