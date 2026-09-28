# Benchmarks

Local, argument-driven efficiency benchmarks for the CLI. Nothing here is a unit test, and no corpus,
log, report, or result is committed: the harness only ever reads paths the caller passes in.

## `verify-manifest.mjs`

The acceptance check for the coverage manifest, in one command and without a benchmark run:

```sh
node scripts/bench/verify-manifest.mjs <corpus-dir> [cli-path]
```

It prints the six falsifiable properties the manifest is specified by: row count, both size budgets,
digest completeness, the row key union, every rotation family member with its index, whether the
manifest alone names the artifact covering a fixed instant, the extraction state, the coverage
counts, whether every skipped row carries a reason, and whether two runs are identical apart from
`generatedAt`. It then corroborates the manifest against the directory itself: the file count, the
total bytes, and one digest recomputed from the bytes. It needs a corpus on disk and does not gate on
its fingerprint, so treat the numbers as comparable only when the corpus line matches.

## `bench-mek.mjs`

Measures the checkout build (`<root>/dist/cli/main.js`) against an extracted MaaFramework corpus and
answers one question per number: what does a fixed diagnostic workload cost, in wall clock and in the
bytes a harness has to read?

### Run

```sh
pnpm build   # the measured binary is <root>/dist/cli/main.js
node scripts/bench/bench-mek.mjs \
  --root   C:/github/MaaEvidenceKit \
  --corpus C:/Users/you/maaend-mek-audit/bench/ext \
  --workdir C:/Users/you/maaend-mek-audit/bench \
  --window  2026-09-26T18:38:00..2026-09-26T18:43:00 \
  --window2 2026-09-26T18:23:00..2026-09-26T18:28:00 \
  --root-cause-line 47758 \
  --root-cause-artifact maafw.bak.2026.09.26-18.42.09.422.log \
  --root-cause-time 2026-09-26T18:42:09.390
```

### Arguments

| argument | required | meaning |
| --- | --- | --- |
| `--root <path>` | yes | MaaEvidenceKit checkout whose `dist/cli/main.js` is the CLI under test. The global npm shim is never used, because its name resolution can hand off to another copy. |
| `--corpus <path>` | yes | Extracted corpus directory. Gated on its fingerprint before anything runs. |
| `--workdir <path>` | yes | Where run artifacts are written (`reports/`, `results/`). |
| `--window <from>..<to>` | yes | Incident window; every question and probe runs here. |
| `--window2 <from>..<to>` | yes | Contrast window (the design's suggestion is the dense navigation segment 18:23–18:28). Both windows are always reported side by side. |
| `--root-cause-line <n>` | yes | Line of the root-cause record in the raw material. |
| `--root-cause-artifact <name>` | yes | Artifact file name expected to carry that line. |
| `--root-cause-time <ISO>` | yes | Instant inside that artifact's `timeCoverage` interval (`2026-09-26T18:42:09.390`). |
| `--label <name>` | no | Results file name (default `run`). |
| `--quick`, `--questions-only` | no | Skip the item and probe batteries. The questions and the manifest metric still run; the reports they read are generated on the spot instead. Either one turns a full run (roughly a quarter of an hour) into a couple of minutes. |

Timestamps use the log's own form (`YYYY-MM-DDTHH:MM:SS[.mmm]`). Instants are compared numerically, so
`…:09.39` and `…:09.390` are the same moment.

### Corpus gate

The benchmark refuses to start unless the corpus is exactly **22 files / 160,222,022 B**, and prints
the observed values in the refusal. Which files those are is not hardcoded; the run's own inventory
(relative path, bytes, log lines, sha256) is recorded in the results so the material is pinned by
content as well as by size. A number produced against other material is not comparable to the ones in
the efficiency design, so it is never produced silently.

### Exit codes

| code | meaning |
| --- | --- |
| 0 | the run completed |
| 2 | usage or argument error (a usage message is printed) |
| 3 | corpus fingerprint mismatch |
| 4 | environment error (missing `dist/cli/main.js`, or a binary outside `--root`) |

### Metrics

| metric | definition |
| --- | --- |
| cold / warm parse | One cold run per item (its first execution in this session) plus `n=5` warm runs; the reported item numbers are the median of the warm runs. The OS file cache is never flushed, so "cold" is not "cold cache". |
| `callCount` | CLI invocations a question needed. |
| idle calls | Calls that did not reach an answer. A call is idle when its return carried no fact the step exists to read (unparseable output, non-zero exit, or the field the step reads missing); an unanswered question counts every one of its calls as idle. |
| `maxSingleReturnBytes` | The largest **single** call return inside a question (stdout + stderr bytes) — the "one read blows up the context" figure, not the sum over calls. |
| window delta | window2 minus window1, absolute and as a percentage of window1. Every window-scoped question and probe is measured under both windows. |
| q5 manifest | The only q5 input is `mla inspect <corpus> --format manifest` — no log content at all. Score = the artifact the manifest names for `--root-cause-time`, plus the bytes it took (budget 8192 B, against 30,099 B / 188,785 B for the replaced upstream fast path). Assertions: exactly one artifact's `timeCoverage` covers the instant, the named artifact equals `--root-cause-artifact`, and the document's `input.extraction` is `"not-run"` (zero content reads). |

q5 reads a discovery-state document, and that command takes no window; the one measurement is
reported under both windows marked `shared`, so nothing is silently dropped from the comparison.

Because the measured binary is the checkout build, a rebuild landing mid-run would silently mix two
builds. The harness hashes every `dist/**/*.js` before and after the run and marks the report
`changedDuringRun` if they differ.

### Scope

This is the harness itself. The audit workspace's companions (before/after comparison, paired A/B
runner, report-equivalence check, RSS probe) are not ported: they read result files this script
writes and measure nothing new.

### Output

- Human summary (Markdown) on **stdout**; progress lines on **stderr**.
- `<workdir>/results/<label>.json` — every measured number, the arguments that produced it, the
  corpus inventory, the binary/git/environment identity, the per-window results, and the deltas.
- `<workdir>/reports/*.json` — the raw CLI documents the questions read.
- Not measured on purpose: OS file-cache state is not flushed between runs (that needs administrative
  privileges on Windows), so "cold" means "first execution of this item in this session".

Point `--workdir` at a directory that is not under version control: the reports embed real log
material and are megabytes each. The reference harness wrote them under `bench/` next to the
extracted corpus, never inside the repository.
