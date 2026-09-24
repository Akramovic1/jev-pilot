#!/usr/bin/env bash
# Pass: src/ is unchanged and ENV_READS.md names exactly the four direct readers
# (src/config.ts is the allowed one; db.ts's poolSize only mentions it in a comment).
git diff --quiet HEAD -- src || exit 1
[ -f ENV_READS.md ] || exit 1
got=$(grep -oE 'src/[a-z]+\.ts:[A-Za-z]+' ENV_READS.md | sort -u | tr '\n' ' ')
want="src/db.ts:connect src/flags.ts:isEnabled src/mail.ts:sendMail src/server.ts:startServer "
[ "$got" = "$want" ] || { echo "got: $got"; exit 1; }
