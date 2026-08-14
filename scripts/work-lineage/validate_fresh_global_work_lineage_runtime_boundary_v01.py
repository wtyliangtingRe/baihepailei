#!/usr/bin/env python3
"""Validate the terminal website runtime boundary after the legacy cutover."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


FORBIDDEN_PREFIXES = (
    ".github/workflows/validate-radar-",
    "src/access/",
    "src/collections/",
    "src/migrations/",
    "src/app/(payload)/",
    "src/app/(frontend)/account/",
    "src/app/(frontend)/me/",
    "src/app/(frontend)/api/account/",
    "src/app/(frontend)/api/comments/",
    "src/app/(frontend)/api/personnel/",
    "src/app/(frontend)/api/studio/",
)

FORBIDDEN_FILES = {
    "payload.config.ts",
    "payload-types.ts",
    "src/app/(frontend)/_actions/account.ts",
    "src/app/(frontend)/_components/AccountClient.tsx",
    "src/app/(frontend)/_components/AuthPanel.tsx",
    "src/app/(frontend)/_components/CommentBlock.tsx",
    "src/app/(frontend)/_components/FeedbackForm.tsx",
    "src/app/(frontend)/_components/MyListsClient.tsx",
    "src/app/(frontend)/_components/PersonnelClient.tsx",
    "src/app/(frontend)/_components/WorkListControl.tsx",
    "src/app/(frontend)/_lib/radar-public-rating-bridge.ts",
    "src/app/(frontend)/_lib/radar-read-repository.ts",
    "src/lib/audit.ts",
    "src/lib/mergedWork.ts",
    "src/lib/newWorkProposal.ts",
    "src/lib/publicIndexSync.ts",
    "src/lib/radarReadOnlyAudit.ts",
    "src/lib/ratingTracks.ts",
    "src/lib/richTextPlain.ts",
}

EXPECTED_SCRIPTS = {
    "build",
    "dev",
    "dev:setup",
    "dev:webpack",
    "start",
    "test:fresh-runtime-boundary",
    "test:work-lineage-runtime",
}

FORBIDDEN_DEPENDENCIES = {
    "@payloadcms/db-postgres",
    "@payloadcms/email-nodemailer",
    "@payloadcms/next",
    "@payloadcms/richtext-lexical",
    "graphql",
    "payload",
}

FORBIDDEN_ENV_KEYS = {
    "ACCOUNT_EMAIL_VERIFICATION_ENABLED",
    "DATABASE_URL",
    "PAYLOAD_DB_PUSH",
    "PAYLOAD_SECRET",
    "RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY",
    "RADAR_PUBLIC_RECORDS_SCHEMA_READY",
    "RADAR_PUBLIC_RATINGS_SCHEMA_READY",
    "STEWARDSHIP_NOTICES_SCHEMA_READY",
}


def fail(message: str) -> None:
    raise SystemExit(f"FRESH WORK LINEAGE RUNTIME BOUNDARY: FAIL: {message}")


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(value, dict), f"expected JSON object: {path}")
    return value


def tracked_paths(root: Path) -> set[str]:
    try:
        raw = subprocess.check_output(
            ["git", "-C", str(root), "ls-files", "-z"],
        )
    except subprocess.CalledProcessError as exc:
        fail(f"git ls-files failed with exit {exc.returncode}")
    return {item.decode("utf-8") for item in raw.split(b"\0") if item}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    root = args.repo_root.resolve()

    require((root / ".git").exists(), "repo root must be a Git checkout")
    paths = tracked_paths(root)

    for path in sorted(paths):
        require(path not in FORBIDDEN_FILES, f"retired runtime file remains: {path}")
        require(
            not any(path.startswith(prefix) for prefix in FORBIDDEN_PREFIXES),
            f"retired runtime path remains: {path}",
        )

    package = load_json(root / "package.json")
    scripts = package.get("scripts")
    require(isinstance(scripts, dict), "package scripts missing")
    require(set(scripts) == EXPECTED_SCRIPTS, "package script surface drift")
    dependencies = {
        *package.get("dependencies", {}),
        *package.get("devDependencies", {}),
    }
    require(
        not (dependencies & FORBIDDEN_DEPENDENCIES),
        f"retired runtime dependencies remain: {sorted(dependencies & FORBIDDEN_DEPENDENCIES)}",
    )

    next_config = (root / "next.config.mjs").read_text(encoding="utf-8")
    require("withPayload" not in next_config, "Next runtime is still wrapped by Payload")
    require("@payloadcms" not in next_config, "Next config still imports Payload")

    tsconfig = load_json(root / "tsconfig.json")
    aliases = tsconfig.get("compilerOptions", {}).get("paths", {})
    require("@payload-config" not in aliases, "Payload TypeScript alias remains")

    import_pattern = re.compile(
        r"@payload-config|@payloadcms/|(?:from|import)\s*['\"]payload['\"]|getPayload\s*\(",
    )
    scanned_source_files = 0
    for path in sorted(paths):
        if not path.startswith("src/") or Path(path).suffix not in {".js", ".mjs", ".ts", ".tsx"}:
            continue
        scanned_source_files += 1
        source = (root / path).read_text(encoding="utf-8")
        require(not import_pattern.search(source), f"Payload runtime import remains: {path}")

    layout = (root / "src/app/(frontend)/layout.tsx").read_text(encoding="utf-8")
    require("'/account'" not in layout and '"/account"' not in layout, "account navigation remains")
    require("'/me/" not in layout and '"/me/' not in layout, "personal-center navigation remains")

    feedback = (root / "src/app/(frontend)/feedback/page.tsx").read_text(encoding="utf-8")
    for token in ("FeedbackForm", "/account", "/me/", "/api/"):
        require(token not in feedback, f"feedback route retained legacy writer token: {token}")

    env_keys = set()
    for line in (root / ".env.example").read_text(encoding="utf-8").splitlines():
        match = re.match(r"^([A-Z][A-Z0-9_]*)=", line)
        if match:
            env_keys.add(match.group(1))
    require("WORK_LINEAGE_DATABASE_URL" in env_keys, "fresh runtime database URL missing")
    require(not (env_keys & FORBIDDEN_ENV_KEYS), f"retired environment keys remain: {sorted(env_keys & FORBIDDEN_ENV_KEYS)}")
    require(not any(key.startswith("SMTP_") for key in env_keys), "retired account SMTP keys remain")

    lock = load_json(root / "config/global-work-lineage-fresh-database-import-v01.lock.json")
    require(lock.get("frozenBlockCount") == 13, "Frozen block count changed")
    require(lock.get("legacyModuleMode") == "retired", "legacy module is not retired")
    require(lock.get("target", {}).get("compatibilityBridges") == 0, "compatibility bridge count changed")
    require(lock.get("target", {}).get("legacyRuntimeDependencies") == 0, "legacy runtime dependency count changed")

    route_entries = sorted(
        path for path in paths
        if path.startswith("src/app/") and re.search(r"/(?:layout|page|route)\.(?:js|ts|tsx)$", path)
    )
    result = {
        "schemaVersion": "global-work-lineage-fresh-runtime-boundary-validation-v01",
        "status": "PASS_RUNTIME_SEVERED",
        "frozenBlockCount": 13,
        "compatibilityBridges": 0,
        "legacyRuntimeDependencies": 0,
        "payloadRuntimeDependencies": 0,
        "payloadRuntimeRoutes": 0,
        "legacyAccountRoutes": 0,
        "legacyAutomatedWorkflows": 0,
        "activeRouteEntries": len(route_entries),
        "scannedRuntimeSourceFiles": scanned_source_files,
        "runtimeDatabaseEnvironmentKey": "WORK_LINEAGE_DATABASE_URL",
    }

    rendered = (json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_bytes(rendered)
    sys.stdout.buffer.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
