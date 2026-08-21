#!/usr/bin/env python3
"""Run pinned SkillSpector scans and apply the CI finding policy."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import os
import re
import stat
import subprocess
import sys
import tempfile
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterable
from urllib.parse import quote


EXPECTED_VERSION = "2.9.6"
BLOCKING_SEVERITIES = {"HIGH", "CRITICAL"}
REQUIRED_DISABLED_ANALYZERS = {
    "semantic_developer_intent",
    "semantic_quality_policy",
    "semantic_security_discovery",
}
ALLOWED_DISABLED_ANALYZERS = REQUIRED_DISABLED_ANALYZERS | {"meta_analyzer"}
EXCLUDED_DIRECTORIES = {
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "__pycache__",
    "node_modules",
}
GIT_LFS_HEADER = b"version https://git-lfs.github.com/spec/v1"
IMAGE_SIGNATURES = {
    ".gif": (b"GIF87a", b"GIF89a"),
    ".jpeg": (b"\xff\xd8\xff",),
    ".jpg": (b"\xff\xd8\xff",),
    ".png": (b"\x89PNG\r\n\x1a\n",),
}
MAX_SKILLS = 500
MAX_REPORT_BYTES = 20 * 1024 * 1024
MAX_COMMENT_FINDINGS = 20
MAX_ANNOTATIONS = 50
SCAN_TIMEOUT_SECONDS = 300
GIT_TIMEOUT_SECONDS = 30


class ScanError(RuntimeError):
    """A scanner or report error that must fail the action."""


@dataclass(frozen=True)
class Finding:
    """A normalized SkillSpector finding."""

    rule_id: str
    severity: str
    confidence: float
    path: str
    start_line: int | None
    end_line: int | None
    explanation: str
    remediation: str
    evidence: str
    skill_path: str
    file_digest: str

    def exact_comparison_key(self) -> tuple[str, str, str, str, str, str]:
        """Return a key that identifies a finding in one skill file."""
        return (
            self.rule_id,
            self.severity,
            self.skill_path,
            self.path,
            _normalize_evidence(self.evidence or self.explanation),
            self.file_digest if self.rule_id == "SC8" else "",
        )

    def move_comparison_key(self) -> tuple[str, str, str, str]:
        """Return a key that identifies an unchanged file move."""
        return (
            self.rule_id,
            self.severity,
            _normalize_evidence(self.evidence or self.explanation),
            self.file_digest,
        )

    def deduplication_key(self) -> tuple[object, ...]:
        """Return a key for duplicate results from nested skill scans."""
        return (
            self.rule_id,
            self.severity,
            self.path,
            self.start_line,
            self.end_line,
            _normalize_evidence(self.evidence or self.explanation),
        )

    def sanitized_dict(self) -> dict[str, object]:
        """Return report data without source snippets or scanner evidence."""
        data = asdict(self)
        data.pop("evidence")
        data.pop("file_digest")
        data["rule_id"] = _report_text(self.rule_id, 100)
        data["path"] = _report_text(self.path, 1000)
        data["explanation"] = _report_text(self.explanation, 1000)
        data["remediation"] = _report_text(self.remediation, 1000)
        data["skill_path"] = _report_text(self.skill_path, 1000)
        key = "\0".join(self.exact_comparison_key()).encode("utf-8", errors="replace")
        data["fingerprint"] = "sha256:" + hashlib.sha256(key).hexdigest()
        return data


@dataclass
class TreeScan:
    """Findings and summary data for one repository tree."""

    skill_count: int
    issue_count: int
    findings: list[Finding]
    partial_images: list["PartialImage"]
    limitations: list[str]


@dataclass(frozen=True)
class PartialImage:
    """An image that SkillSpector did not fully inspect."""

    path: str
    file_digest: str

    def comparison_key(self) -> tuple[str, str]:
        """Return a key that requires the same path and complete file digest."""
        return (self.path, self.file_digest)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--head-root", type=Path, required=True)
    parser.add_argument("--base-root", type=Path)
    parser.add_argument("--scanner", required=True)
    parser.add_argument("--expected-version", default=EXPECTED_VERSION)
    parser.add_argument("--min-confidence", type=float, default=0.8)
    parser.add_argument(
        "--annotation-level",
        choices=("error", "warning"),
        default="error",
    )
    parser.add_argument("--head-sha", default="")
    parser.add_argument("--repository", default="")
    parser.add_argument("--github-output", type=Path)
    parser.add_argument("--step-summary", type=Path)
    return parser.parse_args()


def discover_skill_roots(root: Path) -> list[Path]:
    """Find every skill root, including skills nested inside other skills."""
    root = root.resolve()
    candidates: list[Path] = []

    for current, directories, files in os.walk(root, followlinks=False):
        current_path = Path(current)
        safe_directories: list[str] = []
        for name in sorted(directories):
            path = current_path / name
            if path.is_symlink():
                display_path = _report_text(path.relative_to(root).as_posix(), 1000)
                raise ScanError(f"The scan root contains a symlinked directory: {display_path}")
            if name not in EXCLUDED_DIRECTORIES:
                safe_directories.append(name)
        directories[:] = safe_directories
        if "SKILL.md" in files:
            manifest = current_path / "SKILL.md"
            if manifest.is_symlink():
                raise ScanError("A SKILL.md file is a symlink. The scan cannot inspect it safely.")
            try:
                mode = manifest.stat(follow_symlinks=False).st_mode
            except OSError as error:
                raise ScanError("The scan cannot read a SKILL.md file.") from error
            if not stat.S_ISREG(mode):
                raise ScanError("A SKILL.md path is not a regular file.")
            candidates.append(current_path)

    candidates.sort(key=lambda path: (len(path.relative_to(root).parts), path.as_posix()))
    if len(candidates) > MAX_SKILLS:
        raise ScanError(
            f"Found {len(candidates)} skill roots. The action limit is {MAX_SKILLS}."
        )
    return candidates


def validate_no_submodules(tree_root: Path) -> None:
    """Reject Git submodules in the configured scan root."""
    try:
        probe = subprocess.run(
            ["git", "-C", str(tree_root), "rev-parse", "--is-inside-work-tree"],
            check=False,
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ScanError("The action could not inspect the Git index.") from error

    if probe.returncode != 0:
        git_marker_exists = any(
            (path / ".git").exists() for path in (tree_root, *tree_root.parents)
        )
        if git_marker_exists:
            raise ScanError("The action could not inspect the Git index.")
        return
    if probe.stdout.strip() != "true":
        return

    try:
        index = subprocess.run(
            ["git", "-C", str(tree_root), "ls-files", "--stage", "-z", "--", "."],
            check=False,
            capture_output=True,
            timeout=GIT_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ScanError("The action could not inspect the Git index.") from error

    if index.returncode != 0:
        raise ScanError("The action could not inspect the Git index.")
    for record in index.stdout.split(b"\0"):
        if not record:
            continue
        try:
            metadata, raw_path = record.split(b"\t", 1)
            mode = metadata.split(b" ", 1)[0]
        except ValueError as error:
            raise ScanError("The Git index contains an invalid entry.") from error
        if mode == b"160000":
            path = _report_text(raw_path.decode("utf-8", errors="replace"), 1000)
            raise ScanError(f"The scan root contains a Git submodule: {path}")


def validate_skill_tree(skill_root: Path) -> None:
    """Reject links, special files, and unresolved Git LFS pointers."""
    for current, directories, files in os.walk(skill_root, followlinks=False):
        current_path = Path(current)
        safe_directories: list[str] = []
        for name in sorted(directories):
            path = current_path / name
            if path.is_symlink():
                raise ScanError("A skill contains a symlinked directory.")
            if name == "__pycache__":
                _validate_bytecode_directory(path)
            if name not in EXCLUDED_DIRECTORIES:
                safe_directories.append(name)
        directories[:] = safe_directories

        for name in sorted(files):
            path = current_path / name
            if path.is_symlink():
                raise ScanError("A skill contains a symlinked file.")
            try:
                mode = path.stat(follow_symlinks=False).st_mode
                if not stat.S_ISREG(mode):
                    raise ScanError("A skill contains a path that is not a regular file.")
                with path.open("rb") as source:
                    header = source.read(200)
            except OSError as error:
                raise ScanError("The scan cannot read a file in a skill.") from error
            if header.splitlines()[:1] == [GIT_LFS_HEADER]:
                raise ScanError(
                    "A skill contains a Git LFS pointer instead of the file content."
                )


def _validate_bytecode_directory(directory: Path) -> None:
    """Require excluded Python cache directories to contain only bytecode."""
    for current, directories, files in os.walk(directory, followlinks=False):
        if directories:
            raise ScanError("A Python bytecode directory contains a nested directory.")
        current_path = Path(current)
        for name in files:
            path = current_path / name
            if path.is_symlink() or path.suffix.lower() not in {".pyc", ".pyo"}:
                raise ScanError("A Python bytecode directory contains unexpected content.")
            try:
                mode = path.stat(follow_symlinks=False).st_mode
            except OSError as error:
                raise ScanError("The scan cannot read a Python bytecode file.") from error
            if not stat.S_ISREG(mode):
                raise ScanError("A Python bytecode path is not a regular file.")


def _normalize_evidence(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _report_text(value: str, limit: int) -> str:
    return re.sub(r"[\x00-\x1f\x7f]+", " ", value).strip()[:limit]


def _as_text(value: object, default: str = "") -> str:
    return value if isinstance(value, str) else default


def _as_line(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value > 0:
        return value
    return None


def _file_digest(tree_root: Path, relative_path: str) -> str:
    """Hash one reported file without following links outside the tree."""
    path = tree_root / relative_path
    try:
        if path.is_symlink():
            return ""
        digest = hashlib.sha256()
        if path.is_file():
            with path.open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
        elif path.is_dir():
            digest.update(b"directory\0")
            entries: list[Path] = []
            for current, directories, files in os.walk(path, followlinks=False):
                current_path = Path(current)
                for name in directories:
                    directory = current_path / name
                    if directory.is_symlink():
                        return ""
                    entries.append(directory)
                for name in files:
                    file_path = current_path / name
                    if file_path.is_symlink() or not file_path.is_file():
                        return ""
                    entries.append(file_path)
            for entry in sorted(entries, key=lambda item: item.relative_to(path).as_posix()):
                relative_entry = entry.relative_to(path).as_posix()
                entry_type = b"directory" if entry.is_dir() else b"file"
                digest.update(entry_type + b"\0")
                digest.update(relative_entry.encode("utf-8", errors="replace") + b"\0")
                if entry.is_file():
                    entry_digest = hashlib.sha256()
                    with entry.open("rb") as source:
                        for chunk in iter(lambda: source.read(1024 * 1024), b""):
                            entry_digest.update(chunk)
                    digest.update(entry_digest.digest())
        else:
            return ""
        return digest.hexdigest()
    except OSError:
        return ""


def _relative_path(
    raw_path: object,
    *,
    tree_root: Path,
    skill_root: Path,
    skill_file: str,
) -> str:
    if not isinstance(raw_path, str) or not raw_path.strip():
        return skill_file

    raw = Path(raw_path)
    candidate = raw if raw.is_absolute() else skill_root / raw
    try:
        return candidate.resolve().relative_to(tree_root.resolve()).as_posix()
    except (OSError, ValueError):
        return skill_file


def normalize_findings(
    report: dict[str, Any], *, tree_root: Path, skill_root: Path
) -> list[Finding]:
    """Normalize active issues from one SkillSpector JSON report."""
    raw_issues = report.get("issues")
    if not isinstance(raw_issues, list):
        raise ScanError("The SkillSpector report does not contain an issues array.")

    skill_relative = skill_root.resolve().relative_to(tree_root.resolve()).as_posix()
    skill_file = "SKILL.md" if skill_relative == "." else f"{skill_relative}/SKILL.md"
    findings: list[Finding] = []

    for item in raw_issues:
        if not isinstance(item, dict):
            raise ScanError("The SkillSpector report contains an invalid issue.")
        location = item.get("location")
        if not isinstance(location, dict):
            location = {}
        raw_confidence = item.get("confidence")
        if (
            isinstance(raw_confidence, bool)
            or not isinstance(raw_confidence, (int, float))
            or not math.isfinite(raw_confidence)
            or not 0.0 <= raw_confidence <= 1.0
        ):
            raise ScanError("The SkillSpector report contains an invalid confidence value.")
        confidence = float(raw_confidence)

        explanation = _as_text(item.get("explanation"), "SkillSpector detected a risk.")
        evidence = _as_text(item.get("finding")) or _as_text(item.get("code_snippet"))
        relative_path = _relative_path(
            location.get("file"),
            tree_root=tree_root,
            skill_root=skill_root,
            skill_file=skill_file,
        )
        findings.append(
            Finding(
                rule_id=_as_text(item.get("id"), "UNKNOWN"),
                severity=_as_text(item.get("severity"), "LOW").upper(),
                confidence=confidence,
                path=relative_path,
                start_line=_as_line(location.get("start_line")),
                end_line=_as_line(location.get("end_line")),
                explanation=explanation,
                remediation=_as_text(item.get("remediation")),
                evidence=evidence,
                skill_path=skill_file,
                file_digest=_file_digest(tree_root, relative_path),
            )
        )
    return findings


def _partial_image(
    raw_path: str,
    *,
    tree_root: Path,
    skill_root: Path,
) -> PartialImage:
    """Validate and identify one partially inspected image."""
    raw = Path(raw_path)
    candidate = raw if raw.is_absolute() else skill_root / raw
    try:
        path = candidate.resolve(strict=True)
        path.relative_to(skill_root.resolve())
        relative_path = path.relative_to(tree_root.resolve()).as_posix()
        if path.is_symlink() or not path.is_file():
            raise ScanError("SkillSpector partially inspected an invalid image path.")
        with path.open("rb") as source:
            header = source.read(16)
    except (OSError, ValueError) as error:
        raise ScanError("SkillSpector partially inspected an invalid image path.") from error

    suffix = path.suffix.lower()
    signatures = IMAGE_SIGNATURES.get(suffix, ())
    valid_signature = any(header.startswith(signature) for signature in signatures)
    if suffix == ".webp":
        valid_signature = (
            len(header) >= 12 and header.startswith(b"RIFF") and header[8:12] == b"WEBP"
        )
    if not valid_signature:
        raise ScanError("SkillSpector partially inspected a file that is not an image asset.")

    file_digest = _file_digest(tree_root, relative_path)
    if not file_digest:
        raise ScanError("The action could not hash a partially inspected image asset.")
    return PartialImage(path=relative_path, file_digest=file_digest)


def validate_report(
    report: dict[str, Any],
    expected_version: str,
    *,
    tree_root: Path | None = None,
    skill_root: Path | None = None,
) -> list[PartialImage]:
    """Validate the no-LLM, scope, and complete-execution contract."""
    if report.get("execution_successful") is not True:
        raise ScanError("SkillSpector reported an incomplete scan.")

    metadata = report.get("metadata")
    if not isinstance(metadata, dict):
        raise ScanError("The SkillSpector report does not contain metadata.")
    if metadata.get("skillspector_version") != expected_version:
        raise ScanError(
            "The SkillSpector report version does not match the pinned version."
        )
    if metadata.get("llm_requested") is not False:
        raise ScanError("SkillSpector did not confirm that LLM analysis was disabled.")
    if metadata.get("meta_analysis_applied") is not False:
        raise ScanError("SkillSpector reported that LLM meta-analysis was active.")

    completeness = report.get("analysis_completeness")
    if not isinstance(completeness, dict):
        raise ScanError("The SkillSpector report does not contain scan-completeness data.")
    if completeness.get("execution_successful") is not True:
        raise ScanError("SkillSpector reported an incomplete analysis.")
    uninspected = completeness.get("entirely_uninspected_files")
    if not isinstance(uninspected, int) or isinstance(uninspected, bool):
        raise ScanError("SkillSpector did not report the number of uninspected files.")
    if uninspected != 0:
        raise ScanError("SkillSpector left one or more files entirely uninspected.")

    partially_inspected = completeness.get("partially_inspected_files")
    if not isinstance(partially_inspected, int) or isinstance(partially_inspected, bool):
        raise ScanError(
            "SkillSpector did not report the number of partially inspected files."
        )
    ledger_exceptions = completeness.get("ledger_exceptions")
    if not isinstance(ledger_exceptions, list):
        raise ScanError("SkillSpector did not report its inspection exceptions.")

    partial_images: dict[str, PartialImage] = {}
    degraded_analyzers: set[str] = set()
    for exception in ledger_exceptions:
        if not isinstance(exception, dict):
            raise ScanError("SkillSpector reported an invalid inspection exception.")
        analyzers = exception.get("analyzers")
        if (
            partially_inspected == 0
            or tree_root is None
            or skill_root is None
            or exception.get("fatal") is not False
            or exception.get("outcome") != "skipped"
            or exception.get("phase") != "static"
            or exception.get("reason_code") != "binary_content"
            or not isinstance(exception.get("path"), str)
            or not isinstance(analyzers, list)
            or not analyzers
            or any(
                not isinstance(analyzer, str)
                or not re.fullmatch(r"static_patterns_[a-z0-9_]+", analyzer)
                for analyzer in analyzers
            )
        ):
            raise ScanError("SkillSpector reported an unsupported inspection exception.")
        image = _partial_image(
            exception["path"],
            tree_root=tree_root,
            skill_root=skill_root,
        )
        partial_images[image.path] = image
        degraded_analyzers.update(analyzers)

    if partially_inspected != len(partial_images):
        raise ScanError("SkillSpector reported inconsistent partial-inspection data.")

    scope_exclusions = completeness.get("scope_exclusions")
    if not isinstance(scope_exclusions, list):
        raise ScanError("SkillSpector did not report its scope exclusions.")
    for exclusion in scope_exclusions:
        if not isinstance(exclusion, dict):
            raise ScanError("SkillSpector reported an invalid scope exclusion.")
        reason = exclusion.get("reason_code")
        raw_path = exclusion.get("path")
        if not isinstance(reason, str) or not isinstance(raw_path, str):
            raise ScanError("SkillSpector reported an invalid scope exclusion.")
        normalized_path = PurePosixPath(raw_path.rstrip("/"))
        name = normalized_path.name
        git_metadata = (
            name == ".git"
            and normalized_path.as_posix() == ".git"
            and tree_root is not None
            and skill_root is not None
            and tree_root.resolve() == skill_root.resolve()
        )
        if reason == "excluded_directory" and (
            name == "__pycache__" or git_metadata
        ):
            continue
        raise ScanError(
            "SkillSpector excluded content that this action requires it to inspect."
        )

    analyzer_statuses = completeness.get("analyzer_statuses")
    if not isinstance(analyzer_statuses, list):
        raise ScanError("SkillSpector did not report its analyzer statuses.")
    reported_disabled: set[str] = set()
    reported_degraded: set[str] = set()
    seen_analyzers: set[str] = set()
    for analyzer_status in analyzer_statuses:
        if not isinstance(analyzer_status, dict):
            raise ScanError("SkillSpector reported an invalid analyzer status.")
        analyzer_id = analyzer_status.get("analyzer_id")
        status_value = analyzer_status.get("status")
        failed = analyzer_status.get("failed")
        unaccounted = analyzer_status.get("unaccounted")
        if (
            not isinstance(analyzer_id, str)
            or not analyzer_id
            or analyzer_id in seen_analyzers
            or not isinstance(status_value, str)
            or not isinstance(failed, int)
            or isinstance(failed, bool)
            or not isinstance(unaccounted, int)
            or isinstance(unaccounted, bool)
            or failed != 0
            or unaccounted != 0
        ):
            raise ScanError("SkillSpector reported an invalid analyzer status.")
        seen_analyzers.add(analyzer_id)

        if status_value == "disabled":
            if (
                analyzer_id not in ALLOWED_DISABLED_ANALYZERS
                or analyzer_status.get("reason_code") != "disabled_by_configuration"
            ):
                raise ScanError("SkillSpector disabled an unexpected analyzer.")
            reported_disabled.add(analyzer_id)
        elif status_value == "degraded":
            skipped = analyzer_status.get("skipped")
            if (
                analyzer_id not in degraded_analyzers
                or not isinstance(skipped, int)
                or isinstance(skipped, bool)
                or skipped < 1
            ):
                raise ScanError("SkillSpector degraded an unexpected analyzer.")
            reported_degraded.add(analyzer_id)
        elif (
            analyzer_id == "meta_analyzer"
            and status_value == "not_applicable"
            and analyzer_status.get("reason_code") == "no_applicable_files"
        ):
            continue
        elif analyzer_id in ALLOWED_DISABLED_ANALYZERS:
            raise ScanError("SkillSpector ran an analyzer that no-LLM mode must disable.")
        elif status_value not in {"completed", "not_applicable"}:
            raise ScanError("SkillSpector reported an unsupported analyzer status.")

    if (
        not REQUIRED_DISABLED_ANALYZERS.issubset(reported_disabled)
        or not reported_disabled.issubset(ALLOWED_DISABLED_ANALYZERS)
    ):
        raise ScanError("SkillSpector did not disable the expected no-LLM analyzers.")
    if reported_degraded != degraded_analyzers:
        raise ScanError("SkillSpector reported inconsistent degraded analyzers.")

    limitations = completeness.get("limitations", [])
    if not isinstance(limitations, list) or any(
        not isinstance(item, str) for item in limitations
    ):
        raise ScanError("SkillSpector reported invalid scan limitations.")
    disabled = "Analyzer was disabled by the requested configuration."
    degraded = {
        f"Analyzer {analyzer} status: degraded." for analyzer in degraded_analyzers
    }
    unexpected = [
        item for item in limitations if item != disabled and item not in degraded
    ]
    if unexpected:
        raise ScanError("SkillSpector reported an unexpected analyzer limitation.")
    if limitations.count(disabled) != len(reported_disabled):
        raise ScanError("SkillSpector reported inconsistent no-LLM limitations.")
    if not degraded.issubset(set(limitations)):
        raise ScanError("SkillSpector did not report an expected analyzer limitation.")
    return sorted(partial_images.values(), key=lambda item: item.path)


def _discard_raw_report(report_path: Path) -> None:
    """Remove a raw scanner report that can contain matched source text."""
    try:
        report_path.unlink(missing_ok=True)
    except OSError:
        pass


def _run_scanner(
    scanner: str,
    skill_root: Path,
    report_path: Path,
    expected_version: str,
    tree_root: Path,
) -> tuple[dict[str, Any], list[PartialImage]]:
    command = [
        scanner,
        "scan",
        str(skill_root),
        "--no-llm",
        "--format",
        "json",
        "--output",
        str(report_path),
    ]
    environment = os.environ.copy()
    environment["LANGCHAIN_TRACING_V2"] = "false"
    environment["LANGSMITH_TRACING"] = "false"

    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=SCAN_TIMEOUT_SECONDS,
            env=environment,
        )
    except subprocess.TimeoutExpired as error:
        _discard_raw_report(report_path)
        raise ScanError(f"SkillSpector timed out while it scanned {skill_root}.") from error
    except OSError as error:
        _discard_raw_report(report_path)
        raise ScanError("The action could not start SkillSpector.") from error

    try:
        if completed.returncode not in {0, 1}:
            raise ScanError(
                f"SkillSpector failed while it scanned {skill_root}. "
                f"The scanner exit code was {completed.returncode}."
            )
        if not report_path.is_file():
            raise ScanError(f"SkillSpector did not create a report for {skill_root}.")
        if report_path.stat().st_size > MAX_REPORT_BYTES:
            raise ScanError(f"The SkillSpector report for {skill_root} is too large.")

        try:
            report = json.loads(report_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ScanError(
                f"SkillSpector created an invalid report for {skill_root}."
            ) from error
        if not isinstance(report, dict):
            raise ScanError(f"SkillSpector created an invalid report for {skill_root}.")
        partial_images = validate_report(
            report,
            expected_version,
            tree_root=tree_root,
            skill_root=skill_root,
        )
        return report, partial_images
    finally:
        _discard_raw_report(report_path)


def scan_tree(
    *,
    tree_root: Path,
    scanner: str,
    expected_version: str,
    output_directory: Path,
    label: str,
) -> TreeScan:
    """Scan each complete skill in one checked-out repository tree."""
    tree_root = tree_root.resolve()
    if not tree_root.is_dir():
        raise ScanError(f"The {label} scan root does not exist: {tree_root}")

    validate_no_submodules(tree_root)
    skill_roots = discover_skill_roots(tree_root)
    validated_roots: list[Path] = []
    for skill_root in skill_roots:
        if any(parent == skill_root or parent in skill_root.parents for parent in validated_roots):
            continue
        validate_skill_tree(skill_root)
        validated_roots.append(skill_root)

    findings: list[Finding] = []
    partial_images: dict[tuple[str, str], PartialImage] = {}
    limitations: list[str] = []

    for index, skill_root in enumerate(skill_roots, start=1):
        display_path = _report_text(
            skill_root.relative_to(tree_root).as_posix() or ".",
            1000,
        )
        print(f"SkillSpector scans {label} skill {index}/{len(skill_roots)}: {display_path}")
        report_path = output_directory / f"{label}-{index}.json"
        report, report_partial_images = _run_scanner(
            scanner,
            skill_root,
            report_path,
            expected_version,
            tree_root,
        )
        normalized = normalize_findings(
            report,
            tree_root=tree_root,
            skill_root=skill_root,
        )
        findings.extend(normalized)
        for image in report_partial_images:
            partial_images[image.comparison_key()] = image

    findings = deduplicate_findings(findings)

    return TreeScan(
        skill_count=len(skill_roots),
        issue_count=len(findings),
        findings=findings,
        partial_images=sorted(partial_images.values(), key=lambda item: item.path),
        limitations=sorted(set(limitations)),
    )


def policy_findings(findings: Iterable[Finding], min_confidence: float) -> list[Finding]:
    """Select high-confidence HIGH and CRITICAL findings."""
    return [
        finding
        for finding in findings
        if finding.severity in BLOCKING_SEVERITIES
        and finding.confidence >= min_confidence
    ]


def deduplicate_findings(findings: Iterable[Finding]) -> list[Finding]:
    """Prefer the most specific skill for duplicate nested-scan findings."""
    deduplicated: dict[tuple[object, ...], Finding] = {}
    for finding in findings:
        key = finding.deduplication_key()
        current = deduplicated.get(key)
        finding_depth = len(PurePosixPath(finding.skill_path).parts)
        current_depth = len(PurePosixPath(current.skill_path).parts) if current else -1
        if current is None or finding_depth > current_depth or (
            finding_depth == current_depth and finding.confidence > current.confidence
        ):
            deduplicated[key] = finding
    return list(deduplicated.values())


def subtract_existing(head: Iterable[Finding], base: Iterable[Finding]) -> list[Finding]:
    """Remove exact matches and verified unchanged file moves from head findings."""
    base_findings = list(base)
    remaining_exact = Counter(finding.exact_comparison_key() for finding in base_findings)
    consumed_exact: Counter[tuple[str, str, str, str, str, str]] = Counter()
    unmatched_head: list[Finding] = []

    for finding in head:
        key = finding.exact_comparison_key()
        if remaining_exact[key] > 0:
            remaining_exact[key] -= 1
            consumed_exact[key] += 1
        else:
            unmatched_head.append(finding)

    remaining_moves: Counter[tuple[str, str, str, str]] = Counter()
    for finding in base_findings:
        exact_key = finding.exact_comparison_key()
        if consumed_exact[exact_key] > 0:
            consumed_exact[exact_key] -= 1
            continue
        if finding.file_digest:
            remaining_moves[finding.move_comparison_key()] += 1

    introduced: list[Finding] = []
    for finding in unmatched_head:
        move_key = finding.move_comparison_key()
        if finding.file_digest and remaining_moves[move_key] > 0:
            remaining_moves[move_key] -= 1
        else:
            introduced.append(finding)
    return introduced


def _markdown_text(value: str, limit: int) -> str:
    value = _report_text(_normalize_evidence(value), limit)
    value = html.escape(value, quote=False).replace("@", "@\u200b")
    for character in ("\\", "`", "*", "_", "[", "]", "(", ")", "#", ">", "|"):
        value = value.replace(character, f"\\{character}")
    return value


def _inline_code(value: str) -> str:
    value = _report_text(_normalize_evidence(value), 1000)
    value = value.replace("`", "\u02cb").replace("@", "@\u200b")
    return html.escape(value, quote=False)


def _location_link(finding: Finding, repository: str, head_sha: str) -> str:
    location = _inline_code(finding.path)
    if finding.start_line:
        location += f":{finding.start_line}"
    label = f"`{location}`"
    if not repository or not head_sha:
        return label
    encoded_path = quote(finding.path, safe="/")
    line_fragment = f"#L{finding.start_line}" if finding.start_line else ""
    url = f"https://github.com/{repository}/blob/{head_sha}/{encoded_path}{line_fragment}"
    return f"{label} ([open]({url}))"


def render_markdown(
    findings: list[Finding],
    *,
    skill_count: int,
    compared_with_base: bool,
    repository: str,
    head_sha: str,
    limitations: Iterable[str] = (),
) -> str:
    """Render a bounded PR comment and job summary."""
    qualifier = "new " if compared_with_base else ""
    lines = ["### SkillSpector static scan", ""]

    if not findings:
        if skill_count == 0:
            lines.append("SkillSpector found no `SKILL.md` files. The scan passed.")
        else:
            skill_word = "skill" if skill_count == 1 else "skills"
            lines.append(
                f"SkillSpector scanned {skill_count} {skill_word}. It found no {qualifier}"
                "findings that meet the severity and confidence policy."
            )
        lines.extend(["", "The scan used static analysis only. It did not use an LLM."])
        for limitation in limitations:
            lines.append(f"Scan limit: {_markdown_text(limitation, 500)}")
        return "\n".join(lines) + "\n"

    finding_word = "finding" if len(findings) == 1 else "findings"
    policy_verb = "meets" if len(findings) == 1 else "meet"
    skill_word = "skill" if skill_count == 1 else "skills"
    lines.append(
        f"SkillSpector found {len(findings)} {qualifier}{finding_word} that {policy_verb} the "
        f"severity and confidence policy in {skill_count} scanned {skill_word}."
    )
    lines.extend(
        [
            "",
            "The scan used static analysis only. It did not use an LLM.",
        ]
    )
    for limitation in limitations:
        lines.append(f"Scan limit: {_markdown_text(limitation, 500)}")
    lines.extend(
        [
            "These are static findings. They are not confirmed vulnerabilities.",
            "",
        ]
    )

    for finding in findings[:MAX_COMMENT_FINDINGS]:
        confidence = round(finding.confidence * 100)
        location = _location_link(finding, repository, head_sha)
        rule_id = _markdown_text(finding.rule_id, 100)
        explanation = _markdown_text(finding.explanation, 400)
        lines.append(
            f"- **{finding.severity} · {rule_id} · {confidence}% confidence** at {location}"
        )
        lines.append(f"  - Finding: {explanation}")
        if finding.remediation:
            remediation = _markdown_text(finding.remediation, 300)
            lines.append(f"  - Fix: {remediation}")

    hidden_count = len(findings) - MAX_COMMENT_FINDINGS
    if hidden_count > 0:
        hidden_word = "finding" if hidden_count == 1 else "findings"
        lines.extend(
            [
                "",
                f"The JSON scan report contains {hidden_count} additional {hidden_word}.",
            ]
        )

    lines.extend(["", "Review each finding. Resolve confirmed risks before merge."])
    return "\n".join(lines) + "\n"


def _workflow_escape(value: str, *, property_value: bool = False) -> str:
    value = _report_text(value, 2000)
    value = value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    if property_value:
        value = value.replace(":", "%3A").replace(",", "%2C")
    return value


def emit_annotations(findings: list[Finding], annotation_level: str) -> None:
    """Emit bounded GitHub annotations for policy findings."""
    for finding in findings[:MAX_ANNOTATIONS]:
        properties = [
            f"file={_workflow_escape(finding.path, property_value=True)}",
            f"title={_workflow_escape(f'SkillSpector {finding.rule_id}', property_value=True)}",
        ]
        if finding.start_line:
            properties.append(f"line={finding.start_line}")
        message = _workflow_escape(_normalize_evidence(finding.explanation)[:500])
        print(f"::{annotation_level} {','.join(properties)}::{message}")

    if len(findings) > MAX_ANNOTATIONS:
        omitted = len(findings) - MAX_ANNOTATIONS
        print(f"::warning::SkillSpector omitted {omitted} annotations. Read the scan report.")


def _write_github_outputs(path: Path | None, values: dict[str, str]) -> None:
    if path is None:
        return
    with path.open("a", encoding="utf-8") as output:
        for key, value in values.items():
            if "\n" in value or "\r" in value:
                raise ScanError(f"The action output {key} contains a line break.")
            output.write(f"{key}={value}\n")


def _write_report(
    path: Path,
    *,
    findings: list[Finding],
    head: TreeScan,
    base: TreeScan | None,
    min_confidence: float,
    expected_version: str,
    head_sha: str,
) -> None:
    report = {
        "schema_version": 1,
        "scanner": {
            "name": "SkillSpector",
            "version": expected_version,
            "llm_enabled": False,
        },
        "policy": {
            "severities": ["HIGH", "CRITICAL"],
            "min_confidence": min_confidence,
            "new_findings_only": base is not None,
        },
        "head_sha": head_sha,
        "head_skill_count": head.skill_count,
        "base_skill_count": base.skill_count if base else None,
        "head_issue_count": head.issue_count,
        "base_issue_count": base.issue_count if base else None,
        "finding_count": len(findings),
        "limitations": sorted(set(head.limitations + (base.limitations if base else []))),
        "findings": [finding.sanitized_dict() for finding in findings],
    }
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def validate_partial_images(head: TreeScan, base: TreeScan | None) -> list[str]:
    """Allow only image assets that are byte-identical in the base tree."""
    if not head.partial_images:
        return []

    first_path = _report_text(head.partial_images[0].path, 1000)
    if base is None:
        raise ScanError(
            "SkillSpector cannot fully inspect an image asset without a base tree: "
            f"{first_path}"
        )
    base_images = {image.comparison_key() for image in base.partial_images}
    introduced_images = [
        image
        for image in head.partial_images
        if image.comparison_key() not in base_images
    ]
    if introduced_images:
        first_path = _report_text(introduced_images[0].path, 1000)
        raise ScanError(
            "SkillSpector cannot fully inspect a new or changed image asset: "
            f"{first_path}"
        )

    image_word = "asset" if len(head.partial_images) == 1 else "assets"
    return [
        f"SkillSpector partially inspected {len(head.partial_images)} unchanged image "
        f"{image_word}. The paths and SHA-256 digests matched in the head and base trees."
    ]


def run(args: argparse.Namespace) -> int:
    if not 0.0 <= args.min_confidence <= 1.0:
        raise ScanError("The minimum confidence must be from 0 through 1.")
    if args.repository and not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repository):
        raise ScanError("The repository must use the owner/name format.")
    if args.head_sha and not re.fullmatch(r"[0-9A-Fa-f]{7,64}", args.head_sha):
        raise ScanError("The head SHA must be a hexadecimal Git commit ID.")

    output_directory = Path(tempfile.mkdtemp(prefix="skillspector-", dir=os.getenv("RUNNER_TEMP")))
    head = scan_tree(
        tree_root=args.head_root,
        scanner=args.scanner,
        expected_version=args.expected_version,
        output_directory=output_directory,
        label="head",
    )
    base = None
    if args.base_root:
        base = scan_tree(
            tree_root=args.base_root,
            scanner=args.scanner,
            expected_version=args.expected_version,
            output_directory=output_directory,
            label="base",
        )

    head.limitations.extend(validate_partial_images(head, base))

    head_policy = policy_findings(head.findings, args.min_confidence)
    base_policy = policy_findings(base.findings, args.min_confidence) if base else []
    findings = subtract_existing(head_policy, base_policy) if base else head_policy
    findings.sort(
        key=lambda item: (
            0 if item.severity == "CRITICAL" else 1,
            -item.confidence,
            item.path,
            item.start_line or 0,
            item.rule_id,
        )
    )

    report_path = output_directory / "skillspector-results.json"
    comment_path = output_directory / "skillspector-comment.md"
    _write_report(
        report_path,
        findings=findings,
        head=head,
        base=base,
        min_confidence=args.min_confidence,
        expected_version=args.expected_version,
        head_sha=args.head_sha,
    )
    markdown = render_markdown(
        findings,
        skill_count=head.skill_count,
        compared_with_base=base is not None,
        repository=args.repository,
        head_sha=args.head_sha,
        limitations=head.limitations,
    )
    comment_path.write_text(markdown, encoding="utf-8")
    if args.step_summary:
        with args.step_summary.open("a", encoding="utf-8") as summary:
            summary.write(markdown)

    emit_annotations(findings, args.annotation_level)
    _write_github_outputs(
        args.github_output,
        {
            "scan-complete": "true",
            "finding-count": str(len(findings)),
            "skill-count": str(head.skill_count),
            "report-path": str(report_path),
            "comment-path": str(comment_path),
        },
    )
    return 0


def main() -> int:
    args = _parse_args()
    try:
        return run(args)
    except ScanError as error:
        _write_github_outputs(
            args.github_output,
            {
                "scan-complete": "false",
                "finding-count": "0",
                "skill-count": "0",
                "report-path": "",
                "comment-path": "",
            },
        )
        print(f"::error::{_workflow_escape(str(error))}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
