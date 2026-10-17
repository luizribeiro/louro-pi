def oneline: gsub("\\s+"; " ") | if length > 300 then .[:300] + "…" else . end;

if .type == "tool_execution_start" then
  "$ \(.args.command)"
elif .type == "tool_execution_end" then
  "  \(.result.content | map(.text // "") | join(" ") | oneline)"
elif .type == "message_end" and .message.role == "assistant" then
  (.message.content | map(select(.type == "text") | .text) | join(" ") | select(. != "") | "> \(oneline)"),
  (.message.errorMessage // empty | "! \(oneline)")
elif .type == "auto_retry_start" then
  "! retry \(.attempt)/\(.maxAttempts) in \(.delayMs / 1000)s: \(.errorMessage | oneline)"
elif .type == "compaction_start" then
  "~ compacting (\(.reason))"
else
  empty
end
