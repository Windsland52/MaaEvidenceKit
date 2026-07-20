# Contracts

Cross-process JSON schemas are generated from the Python domain models. The TypeScript adapter must not define competing diagnosis-domain models.

Generated contracts cover:

- `AnalysisRequest`, including named project, MaaFramework, GUI, and agent source inputs
- `PreparedAnalysis`, including independently resolved source snapshots
- `DeterministicInspection`, combining prepared inputs with MLA preflight facts
- `Evidence`
- `EvidenceQuery` and `EvidenceWindow`
- `DiagnosisDraft`, the model-produced interpretation without evidence objects
- `DiagnosisResult`, with evidence attached from an authoritative ledger
- `DiagnosticEvent`
- `MlaPreflightResult`, including source-backed MaaFramework runtime sessions
- `ReasoningRequest`
- the JSONL tool-adapter request and response envelopes
