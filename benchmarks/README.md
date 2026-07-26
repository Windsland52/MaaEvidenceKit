# External diagnostic benchmark

The benchmark is intentionally separate from the deterministic unit-test gate. Real issue
archives, extracted logs, screenshots, source checkouts, model responses, and credentials belong
in an external dataset root such as `tmp/benchmark/`; they must not be committed here.

Each external case keeps three surfaces separate:

1. the system-under-test input contains only the issue snapshot, artifacts, and source revisions
   visible at the observation cutoff;
2. `BenchmarkAnnotation` contains the independently adjudicated symptom, observed mechanism,
   initiating trigger, root cause, evidence requirements, acceptable conclusions, forbidden
   claims, and known evidence gaps;
3. `BenchmarkResult` contains only a diagnosis hash, bounded judge output, deterministic metrics,
   and the pass decision. It does not serialize model configuration or credentials.

Generate a diagnosis normally, then run a separate judge model:

```powershell
uv run maa-diagnostic-expert diagnose `
  --request tmp/benchmark/cases/example/request.json `
  --model-config tmp/benchmark/sut-model.json `
  --output tmp/benchmark/runs/example/diagnosis.json

uv run maa-diagnostic-benchmark `
  --case tmp/benchmark/cases/example/case.json `
  --annotation tmp/benchmark/cases/example/annotation.json `
  --diagnosis tmp/benchmark/runs/example/diagnosis.json `
  --judge-model-config tmp/benchmark/judge-model.json `
  --output tmp/benchmark/runs/example/result.json
```

Use different system-under-test and judge runs. Never expose the annotation, closing comments,
fixing pull requests, or post-cutoff source to the diagnosis command. The judge sees the gold rubric
only after the diagnosis has been serialized. Its prompt excludes annotation provenance,
adjudication, annotator identities, and fix direction so those post-cutoff fields cannot influence
the judgment.

## Scoring

Python validates all judge-produced evidence IDs and zero-based indexes before scoring. The base
score is deterministic:

- 30% required-evidence coverage;
- 30% acceptable-conclusion coverage;
- 10% required-absence coverage;
- 10% acknowledgment of known evidence gaps;
- 10% separation of symptom, mechanism, and trigger/root cause;
- 10% citation traceability.

Each forbidden claim subtracts 0.25. A case passes only when the diagnosis is `complete`, contains
no forbidden claim, and meets the configured threshold (0.70 by default). Empty optional rubric
dimensions receive full neutral credit. Judge-model comparisons should report per-case metrics and
confidence intervals across repeated runs; a single aggregate score is not sufficient evidence of
quality.
