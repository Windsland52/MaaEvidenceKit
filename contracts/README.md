# Contracts

Cross-process JSON schemas are generated from the Python domain models. The TypeScript adapter must not define competing diagnosis-domain models.

Generated contracts cover:

- `AnalysisRequest`, including named project, MaaFramework, GUI, and agent source inputs
- `PreparedAnalysis`, including independently resolved source snapshots
- `Evidence`
- `EvidenceQuery` and `EvidenceWindow`
- `DiagnosisResult`
- `DiagnosticEvent`
- `ReasoningRequest`
- the JSONL tool-adapter request and response envelopes
