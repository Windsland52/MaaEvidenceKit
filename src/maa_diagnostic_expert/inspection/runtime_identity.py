from __future__ import annotations

import hashlib
import re
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path
from typing import Protocol

from maa_diagnostic_expert.contracts.domain import (
    Evidence,
    EvidenceReliability,
    EvidenceRole,
    SourceRole,
    SourceSnapshot,
)
from maa_diagnostic_expert.contracts.mla import MlaPreflightResult
from maa_diagnostic_expert.contracts.workflow import (
    RuntimeComponent,
    RuntimeIdentity,
    RuntimeVersionObservation,
    VersionObservationKind,
)


class MlaPreflightArtifact(Protocol):
    @property
    def path(self) -> Path: ...

    @property
    def preflight(self) -> MlaPreflightResult: ...


_RELEASE_VERSION = re.compile(r"^v?\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$")


def _observed_at(value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _evidence_id(
    component: RuntimeComponent,
    source_ref: str,
    line_number: int | None,
    session_id: str | None,
    version: str,
) -> str:
    digest = hashlib.sha256(
        f"{component.value}|{source_ref}|{line_number}|{session_id}|{version}".encode()
    ).hexdigest()[:20]
    return f"evidence:runtime-version:{digest}"


def _source_path(source_ref: str) -> str:
    return source_ref.removeprefix("file:") if source_ref.startswith("file:") else source_ref


def _observation(
    *,
    component: RuntimeComponent = RuntimeComponent.MAA_FRAMEWORK,
    version: str,
    kind: VersionObservationKind,
    source_ref: str,
    line_number: int | None,
    session_id: str | None,
    timestamp: str | None,
    confidence: float,
) -> RuntimeVersionObservation:
    return RuntimeVersionObservation(
        component=component,
        version=version,
        kind=kind,
        source_ref=source_ref,
        line_number=line_number,
        evidence_id=_evidence_id(component, source_ref, line_number, session_id, version),
        session_id=session_id,
        observed_at=_observed_at(timestamp),
        confidence=confidence,
    )


def extract_runtime_identity(
    preflights: Sequence[MlaPreflightArtifact],
    source_snapshots: Sequence[SourceSnapshot] = (),
) -> RuntimeIdentity:
    observations: list[RuntimeVersionObservation] = []
    known: set[tuple[RuntimeComponent, str, str | None, str]] = set()

    for artifact in preflights:
        framework = artifact.preflight.framework
        artifact_versions: set[str] = set()
        for session in framework.sessions:
            session_versions: set[str] = set()
            for item in session.version_evidence:
                key = (
                    RuntimeComponent.MAA_FRAMEWORK,
                    item.source,
                    session.session_id,
                    item.version,
                )
                if key in known:
                    continue
                known.add(key)
                session_versions.add(item.version)
                artifact_versions.add(item.version)
                observations.append(
                    _observation(
                        version=item.version,
                        kind=VersionObservationKind.OBSERVED,
                        source_ref=item.source,
                        line_number=item.line,
                        session_id=session.session_id,
                        timestamp=item.timestamp,
                        confidence=1,
                    )
                )

            unresolved_versions = set(session.versions)
            if session.version is not None:
                unresolved_versions.add(session.version)
            for version in sorted(unresolved_versions - session_versions):
                key = (
                    RuntimeComponent.MAA_FRAMEWORK,
                    session.start.source,
                    session.session_id,
                    version,
                )
                if key in known:
                    continue
                known.add(key)
                artifact_versions.add(version)
                observations.append(
                    _observation(
                        version=version,
                        kind=VersionObservationKind.RESOLVED,
                        source_ref=session.start.source,
                        line_number=session.start.line,
                        session_id=session.session_id,
                        timestamp=session.start.timestamp,
                        confidence=0.9,
                    )
                )

        for version in framework.versions:
            if version in artifact_versions:
                continue
            source_ref = str(artifact.path)
            key = (RuntimeComponent.MAA_FRAMEWORK, source_ref, None, version)
            if key in known:
                continue
            known.add(key)
            observations.append(
                _observation(
                    version=version,
                    kind=VersionObservationKind.RESOLVED,
                    source_ref=source_ref,
                    line_number=None,
                    session_id=None,
                    timestamp=None,
                    confidence=0.7,
                )
            )

    for snapshot in source_snapshots:
        version = snapshot.requested_revision
        if (
            snapshot.role is not SourceRole.PROJECT
            or version is None
            or _RELEASE_VERSION.fullmatch(version) is None
        ):
            continue
        source_ref = str(snapshot.path)
        key = (RuntimeComponent.PROJECT, source_ref, None, version)
        if key in known:
            continue
        known.add(key)
        observations.append(
            _observation(
                component=RuntimeComponent.PROJECT,
                version=version,
                kind=VersionObservationKind.USER_DECLARED,
                source_ref=source_ref,
                line_number=None,
                session_id=None,
                timestamp=None,
                confidence=0.8,
            )
        )

    return RuntimeIdentity(versions=observations)


def synthesize_runtime_identity_evidence(identity: RuntimeIdentity) -> list[Evidence]:
    evidence: list[Evidence] = []
    for observation in identity.versions:
        if observation.evidence_id is None:
            continue
        scope = (
            f"session={observation.session_id}"
            if observation.session_id is not None
            else "source-level"
        )
        evidence.append(
            Evidence(
                id=observation.evidence_id,
                kind=(
                    "runtime_version"
                    if observation.component is RuntimeComponent.MAA_FRAMEWORK
                    else f"{observation.component.value}_version"
                ),
                source_component=(
                    "mla:preflight"
                    if observation.component is RuntimeComponent.MAA_FRAMEWORK
                    else f"source-revision:{observation.component.value}"
                ),
                source_path=_source_path(observation.source_ref),
                content=(
                    f"component={observation.component.value}; version={observation.version}; "
                    f"observation={observation.kind.value}; {scope}; "
                    f"confidence={observation.confidence}"
                ),
                line_start=observation.line_number,
                line_end=observation.line_number,
                role=EvidenceRole.CONTEXT,
                reliability=(
                    EvidenceReliability.PRIMARY
                    if observation.kind is VersionObservationKind.OBSERVED
                    else EvidenceReliability.CONTEXT
                ),
            )
        )
    return evidence
