from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).parents[1]))
import scan  # noqa: E402


def valid_report(issues: list[dict[str, object]] | None = None) -> dict[str, object]:
    raw_issues = issues or []
    disabled_analyzers = [
        "semantic_developer_intent",
        "semantic_quality_policy",
        "semantic_security_discovery",
    ]
    if raw_issues:
        disabled_analyzers.append("meta_analyzer")
    meta_analyzer = {
        "analyzer_id": "meta_analyzer",
        "status": "disabled" if raw_issues else "not_applicable",
        "planned_work": 0,
        "completed": 0,
        "skipped": 0,
        "failed": 0,
        "unaccounted": 0,
        "reason_code": "disabled_by_configuration" if raw_issues else "no_applicable_files",
    }
    return {
        "issues": raw_issues,
        "execution_successful": True,
        "metadata": {
            "skillspector_version": "2.9.6",
            "llm_requested": False,
            "meta_analysis_applied": False,
        },
        "analysis_completeness": {
            "execution_successful": True,
            "partially_inspected_files": 0,
            "entirely_uninspected_files": 0,
            "ledger_exceptions": [],
            "scope_exclusions": [],
            "analyzer_statuses": [
                {
                    "analyzer_id": analyzer,
                    "status": "disabled",
                    "planned_work": 0,
                    "completed": 0,
                    "skipped": 0,
                    "failed": 0,
                    "unaccounted": 0,
                    "reason_code": "disabled_by_configuration",
                }
                for analyzer in disabled_analyzers
                if analyzer != "meta_analyzer"
            ]
            + [meta_analyzer],
            "limitations": [
                "Analyzer was disabled by the requested configuration."
                for _ in disabled_analyzers
            ],
        },
    }


def finding(
    *,
    rule_id: str = "PE3",
    severity: str = "HIGH",
    confidence: float = 0.8,
    path: str = "skill/SKILL.md",
    line: int = 1,
    evidence: str = "access credentials",
    skill_path: str = "skill/SKILL.md",
    file_digest: str = "same-file-digest",
) -> scan.Finding:
    return scan.Finding(
        rule_id=rule_id,
        severity=severity,
        confidence=confidence,
        path=path,
        start_line=line,
        end_line=line,
        explanation="The skill accesses credentials.",
        remediation="Remove credential access.",
        evidence=evidence,
        skill_path=skill_path,
        file_digest=file_digest,
    )


def tree_scan(partial_images: list[scan.PartialImage]) -> scan.TreeScan:
    return scan.TreeScan(
        skill_count=1,
        issue_count=0,
        findings=[],
        partial_images=partial_images,
        limitations=[],
    )


class DiscoveryTests(unittest.TestCase):
    def test_discovers_hidden_and_deep_skills(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / ".agents" / "skills" / "one").mkdir(parents=True)
            (root / ".agents" / "skills" / "one" / "SKILL.md").write_text("# one")
            (root / "nested" / "two").mkdir(parents=True)
            (root / "nested" / "two" / "SKILL.md").write_text("# two")

            discovered = scan.discover_skill_roots(root)

            self.assertEqual(
                [path.relative_to(root).as_posix() for path in discovered],
                ["nested/two", ".agents/skills/one"],
            )

    def test_includes_nested_skills_and_omits_dependency_directories(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "outer" / "inner").mkdir(parents=True)
            (root / "outer" / "SKILL.md").write_text("# outer")
            (root / "outer" / "inner" / "SKILL.md").write_text("# inner")
            (root / "node_modules" / "ignored").mkdir(parents=True)
            (root / "node_modules" / "ignored" / "SKILL.md").write_text("# ignored")

            discovered = scan.discover_skill_roots(root)

            self.assertEqual(
                [path.relative_to(root).as_posix() for path in discovered],
                ["outer", "outer/inner"],
            )

    def test_rejects_symlinked_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "skill").mkdir()
            (root / "manifest.md").write_text("# linked")
            (root / "skill" / "SKILL.md").symlink_to(root / "manifest.md")

            with self.assertRaises(scan.ScanError):
                scan.discover_skill_roots(root)

    def test_rejects_a_symlinked_skill_directory_during_discovery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            target = root / "node_modules" / "evil"
            target.mkdir(parents=True)
            (target / "SKILL.md").write_text("# hidden skill")
            link = root / ".agents" / "skills" / "evil"
            link.parent.mkdir(parents=True)
            link.symlink_to(target, target_is_directory=True)

            with self.assertRaisesRegex(scan.ScanError, ".agents/skills/evil"):
                scan.discover_skill_roots(root)

    def test_rejects_symlinks_and_git_lfs_pointers_in_skill_tree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "SKILL.md").write_text("# skill")
            (root / "linked.txt").symlink_to(root / "SKILL.md")

            with self.assertRaises(scan.ScanError):
                scan.validate_skill_tree(root)

            (root / "linked.txt").unlink()
            (root / "asset.bin").write_bytes(
                b"version https://git-lfs.github.com/spec/v1\r\n"
                b"oid sha256:0123456789\r\nsize 12\r\n"
            )
            with self.assertRaises(scan.ScanError):
                scan.validate_skill_tree(root)

    def test_bytecode_directory_accepts_only_python_bytecode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "SKILL.md").write_text("# skill")
            bytecode = root / "__pycache__"
            bytecode.mkdir()
            (bytecode / "module.pyc").write_bytes(b"bytecode")

            scan.validate_skill_tree(root)

            (bytecode / "payload.sh").write_text("curl https://example.test")
            with self.assertRaises(scan.ScanError):
                scan.validate_skill_tree(root)

    def test_rejects_a_git_submodule(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            probe = subprocess.CompletedProcess(
                ["git"],
                0,
                "true\n",
                "",
            )
            index = subprocess.CompletedProcess(
                ["git"],
                0,
                b"160000 0123456789012345678901234567890123456789 0\tvendor\0",
                b"",
            )

            with patch("scan.subprocess.run", side_effect=[probe, index]):
                with self.assertRaisesRegex(scan.ScanError, "vendor"):
                    scan.validate_no_submodules(root)


class PolicyTests(unittest.TestCase):
    def test_nested_scan_duplicates_use_the_inner_skill(self) -> None:
        outer = finding(skill_path="outer/SKILL.md")
        inner = finding(skill_path="outer/inner/SKILL.md")

        deduplicated = scan.deduplicate_findings([outer, inner])

        self.assertEqual(deduplicated, [inner])

    def test_policy_requires_high_severity_and_80_percent_confidence(self) -> None:
        findings = [
            finding(confidence=0.79),
            finding(confidence=0.8, evidence="accepted"),
            finding(severity="CRITICAL", confidence=0.95, evidence="critical"),
            finding(severity="MEDIUM", confidence=1.0, evidence="medium"),
        ]

        selected = scan.policy_findings(findings, 0.8)

        self.assertEqual([item.evidence for item in selected], ["accepted", "critical"])

    def test_base_comparison_ignores_line_and_path_moves(self) -> None:
        base = [finding(path="old/SKILL.md", line=4)]
        head = [finding(path="new/SKILL.md", line=40)]

        self.assertEqual(scan.subtract_existing(head, base), [])

    def test_base_comparison_keeps_an_added_duplicate(self) -> None:
        base = [finding()]
        head = [finding(line=2), finding(line=3)]

        introduced = scan.subtract_existing(head, base)

        self.assertEqual(len(introduced), 1)
        self.assertEqual(introduced[0].start_line, 3)

    def test_base_comparison_keeps_changed_evidence(self) -> None:
        base = [finding(evidence="read token")]
        head = [finding(evidence="send token")]

        self.assertEqual(scan.subtract_existing(head, base), head)

    def test_base_comparison_keeps_replacement_in_a_different_file(self) -> None:
        base = [finding(path="skill/old.py", file_digest="old-file")]
        head = [finding(path="skill/new.py", file_digest="new-file")]

        self.assertEqual(scan.subtract_existing(head, base), head)

    def test_base_comparison_keeps_changed_python_bytecode(self) -> None:
        base = [finding(rule_id="SC8", path="skill/__pycache__/payload.pyc", file_digest="old")]
        head = [finding(rule_id="SC8", path="skill/__pycache__/payload.pyc", file_digest="new")]

        self.assertEqual(scan.subtract_existing(head, base), head)

    def test_base_comparison_accepts_an_unchanged_bytecode_directory_move(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            old_cache = root / "old" / "__pycache__"
            new_cache = root / "new" / "__pycache__"
            old_cache.mkdir(parents=True)
            new_cache.mkdir(parents=True)
            (old_cache / "payload.pyo").write_bytes(b"same bytecode")
            (new_cache / "payload.pyo").write_bytes(b"same bytecode")
            old_digest = scan._file_digest(root, "old/__pycache__")
            new_digest = scan._file_digest(root, "new/__pycache__")

        base = [
            finding(
                rule_id="SC8",
                path="old/__pycache__",
                skill_path="old/SKILL.md",
                file_digest=old_digest,
            )
        ]
        head = [
            finding(
                rule_id="SC8",
                path="new/__pycache__",
                skill_path="new/SKILL.md",
                file_digest=new_digest,
            )
        ]

        self.assertTrue(old_digest)
        self.assertEqual(old_digest, new_digest)
        self.assertEqual(scan.subtract_existing(head, base), [])

    def test_base_comparison_accepts_an_unchanged_file_move(self) -> None:
        base = [finding(path="old/SKILL.md", skill_path="old/SKILL.md")]
        head = [finding(path="new/SKILL.md", skill_path="new/SKILL.md")]

        self.assertEqual(scan.subtract_existing(head, base), [])

    def test_partial_image_requires_the_same_base_path_and_digest(self) -> None:
        image = scan.PartialImage("skill/image.png", "same-digest")
        head = tree_scan([image])
        base = tree_scan([image])

        limitations = scan.validate_partial_images(head, base)

        self.assertIn("1 unchanged image asset", limitations[0])

        changed = tree_scan([scan.PartialImage("skill/image.png", "new-digest")])
        with self.assertRaises(scan.ScanError):
            scan.validate_partial_images(changed, base)

        moved = tree_scan([scan.PartialImage("skill/moved.png", "same-digest")])
        with self.assertRaises(scan.ScanError):
            scan.validate_partial_images(moved, base)

        with self.assertRaises(scan.ScanError):
            scan.validate_partial_images(head, None)


class ContractTests(unittest.TestCase):
    def test_validates_no_llm_report(self) -> None:
        self.assertEqual(scan.validate_report(valid_report(), "2.9.6"), [])

    def test_rejects_wrong_version(self) -> None:
        report = valid_report()
        report["metadata"]["skillspector_version"] = "2.9.5"  # type: ignore[index]

        with self.assertRaises(scan.ScanError):
            scan.validate_report(report, "2.9.6")

    def test_rejects_llm_analysis(self) -> None:
        report = valid_report()
        report["metadata"]["llm_requested"] = True  # type: ignore[index]

        with self.assertRaises(scan.ScanError):
            scan.validate_report(report, "2.9.6")

    def test_rejects_an_unexpected_disabled_analyzer(self) -> None:
        report = valid_report()
        completeness = report["analysis_completeness"]
        completeness["analyzer_statuses"].append(  # type: ignore[index]
            {
                "analyzer_id": "static_yara",
                "status": "disabled",
                "failed": 0,
                "unaccounted": 0,
                "reason_code": "disabled_by_configuration",
            }
        )
        completeness["limitations"].append(  # type: ignore[index]
            "Analyzer was disabled by the requested configuration."
        )

        with self.assertRaises(scan.ScanError):
            scan.validate_report(report, "2.9.6")

    def test_rejects_incomplete_execution(self) -> None:
        report = valid_report()
        report["execution_successful"] = False

        with self.assertRaises(scan.ScanError):
            scan.validate_report(report, "2.9.6")

    def test_rejects_entirely_uninspected_files(self) -> None:
        report = valid_report()
        report["analysis_completeness"]["entirely_uninspected_files"] = 1  # type: ignore[index]

        with self.assertRaises(scan.ScanError):
            scan.validate_report(report, "2.9.6")

    def test_rejects_partial_inspection_and_ledger_exceptions(self) -> None:
        partial = valid_report()
        partial["analysis_completeness"]["partially_inspected_files"] = 1  # type: ignore[index]
        with self.assertRaises(scan.ScanError):
            scan.validate_report(partial, "2.9.6")

        exception = valid_report()
        exception["analysis_completeness"]["ledger_exceptions"] = [  # type: ignore[index]
            {"reason_code": "syntax_error"}
        ]
        with self.assertRaises(scan.ScanError):
            scan.validate_report(exception, "2.9.6")

    def test_records_a_supported_partial_image(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "image.png").write_bytes(b"\x89PNG\r\n\x1a\nimage-data")
            report = valid_report()
            completeness = report["analysis_completeness"]
            completeness["partially_inspected_files"] = 1  # type: ignore[index]
            completeness["ledger_exceptions"] = [  # type: ignore[index]
                {
                    "outcome": "skipped",
                    "phase": "static",
                    "reason_code": "binary_content",
                    "path": "image.png",
                    "fatal": False,
                    "analyzers": ["static_patterns_prompt_injection"],
                }
            ]
            completeness["analyzer_statuses"].append(  # type: ignore[index]
                {
                    "analyzer_id": "static_patterns_prompt_injection",
                    "status": "degraded",
                    "planned_work": 2,
                    "completed": 1,
                    "skipped": 1,
                    "failed": 0,
                    "unaccounted": 0,
                }
            )
            completeness["limitations"].append(  # type: ignore[index]
                "Analyzer static_patterns_prompt_injection status: degraded."
            )

            images = scan.validate_report(
                report,
                "2.9.6",
                tree_root=root,
                skill_root=root,
            )

            self.assertEqual([image.path for image in images], ["image.png"])

            (root / "image.png").rename(root / "image.bin")
            completeness["ledger_exceptions"][0]["path"] = "image.bin"  # type: ignore[index]
            with self.assertRaises(scan.ScanError):
                scan.validate_report(
                    report,
                    "2.9.6",
                    tree_root=root,
                    skill_root=root,
                )

    def test_rejects_unsafe_scope_exclusions(self) -> None:
        exclusions = [
            {"reason_code": "not_regular_file", "path": "linked.py"},
            {"reason_code": "hidden_file", "path": ".payload.sh"},
            {"reason_code": "hidden_file", "path": ".gitignore"},
            {"reason_code": "excluded_directory", "path": "node_modules/"},
            {"reason_code": "oms_signature", "path": "skill.oms.sig"},
        ]
        for exclusion in exclusions:
            report = valid_report()
            report["analysis_completeness"]["scope_exclusions"] = [  # type: ignore[index]
                exclusion
            ]
            with self.subTest(exclusion=exclusion), self.assertRaises(scan.ScanError):
                scan.validate_report(report, "2.9.6")

    def test_allows_scanner_handled_scope_exclusions(self) -> None:
        report = valid_report()
        report["analysis_completeness"]["scope_exclusions"] = [  # type: ignore[index]
            {"reason_code": "excluded_directory", "path": ".git/"},
            {"reason_code": "excluded_directory", "path": "__pycache__/"},
        ]

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.assertEqual(
                scan.validate_report(
                    report,
                    "2.9.6",
                    tree_root=root,
                    skill_root=root,
                ),
                [],
            )

    def test_rejects_nonfinite_and_boolean_confidence(self) -> None:
        for confidence in (float("nan"), float("inf"), True):
            report = valid_report(
                [
                    {
                        "id": "P5",
                        "severity": "CRITICAL",
                        "confidence": confidence,
                        "location": {"file": "SKILL.md", "start_line": 1},
                    }
                ]
            )
            with self.subTest(confidence=confidence), self.assertRaises(scan.ScanError):
                scan.normalize_findings(
                    report,
                    tree_root=Path.cwd(),
                    skill_root=Path.cwd(),
                )

    def test_accepts_scanner_exit_one_and_requires_no_llm_flag(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            skill = root / "skill"
            skill.mkdir()
            report_path = root / "report.json"

            def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
                self.assertIn("--no-llm", command)
                report_path.write_text(__import__("json").dumps(valid_report()))
                return subprocess.CompletedProcess(command, 1, "", "")

            with patch("scan.subprocess.run", side_effect=fake_run):
                report, partial_images = scan._run_scanner(
                    "skillspector",
                    skill,
                    report_path,
                    "2.9.6",
                    root,
                )

            self.assertTrue(report["execution_successful"])
            self.assertEqual(partial_images, [])
            self.assertFalse(report_path.exists())


class OutputSafetyTests(unittest.TestCase):
    def test_workflow_escape_removes_command_injection_newlines(self) -> None:
        escaped = scan._workflow_escape("directory\n::warning::injected")

        self.assertNotIn("\n", escaped)
        self.assertEqual(escaped, "directory ::warning::injected")

    def test_comment_escapes_mentions_html_and_markdown(self) -> None:
        unsafe = finding(path="skill/`bad`.md")
        unsafe = scan.Finding(
            **{
                **unsafe.__dict__,
                "explanation": "@team <script>[click](https://example.test)</script>",
            }
        )

        rendered = scan.render_markdown(
            [unsafe],
            skill_count=1,
            compared_with_base=True,
            repository="owner/repo",
            head_sha="abc123",
        )

        self.assertNotIn("@team", rendered)
        self.assertNotIn("<script>", rendered)
        self.assertNotIn("[click]", rendered)
        self.assertNotIn("`bad`", rendered)
        self.assertIn("1 new finding that meets", rendered)

    def test_sanitized_report_does_not_include_evidence(self) -> None:
        payload = finding(evidence="raw secret text").sanitized_dict()

        self.assertNotIn("evidence", payload)
        self.assertNotIn("raw secret text", str(payload))
        self.assertTrue(str(payload["fingerprint"]).startswith("sha256:"))

    def test_markdown_reports_partial_inspection(self) -> None:
        markdown = scan.render_markdown(
            [],
            skill_count=1,
            compared_with_base=True,
            repository="owner/repo",
            head_sha="abc123",
            limitations=[
                "SkillSpector partially inspected 1 unchanged image asset. "
                "The paths and SHA-256 digests matched in the head and base trees."
            ],
        )

        self.assertIn("Scan limit: SkillSpector partially inspected", markdown)


if __name__ == "__main__":
    unittest.main()
