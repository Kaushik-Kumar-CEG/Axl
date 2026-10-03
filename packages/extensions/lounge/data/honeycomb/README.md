<!-- SPDX-FileCopyrightText: 2026 Hari Srinivasan -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Honeycomb word data

The Honeycomb word list is transformed from the English Speller Database (ESDB, formerly SCOWLv2) release `rel-2026.02.25`, commit `7e99edab8e32f9f9ea2b15f249ca8d4d67237410`. This is the same upstream as the Wordle dictionaries. `provenance.json` records the commands, rules, reviewed exclusions, counts, and the SHA-256 digest of the decoded list.

The list uses the size-35 American English tier and keeps four to twelve lowercase ASCII letters. Slurs and explicit sexual terms are removed. Honeycomb accepts exactly this list, so every word a player can enter has been through the same review.

`words.frontcoded` stores each sorted word as one uppercase letter followed by a lowercase suffix. The letter is `A` plus the length of the prefix shared with the previous word, from `A` (no shared prefix) through `L` (eleven). A decoder reads each uppercase letter and the lowercase run after it. The newlines split the stream into fixed-width chunks for review and do not delimit records.

The upstream archive for the pinned commit was downloaded from GitHub and its database built with `make`. The recorded archive digest is for that download. Regenerating the runtime module does not fetch anything:

```bash
node packages/extensions/lounge/scripts/generate-honeycomb.ts
```

The generator decodes and validates the list, then derives the puzzle set with the rules in `provenance.json` and writes `src/honeycomb-data.generated.ts`. Repository generated-file checks rerun it in check mode.

The word data is licensed under `LicenseRef-ESDB`. See `LICENSES/LicenseRef-ESDB.txt` and `NOTICE`. The script and this documentation are Apache-2.0 licensed.
