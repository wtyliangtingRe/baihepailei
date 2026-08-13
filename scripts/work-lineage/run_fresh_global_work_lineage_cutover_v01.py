#!/usr/bin/env python3
"""Execute the one-time fresh WorkLineage database cutover.

The command never connects to an old database and never deletes a caller-owned
package or database. All generated import material lives in a unique temporary
directory and is removed before the database-only validation pass.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


PREPARER = Path("scripts/work-lineage/prepare_fresh_global_work_lineage_database_v01.py")
DATABASE_VALIDATOR = Path("scripts/work-lineage/validate_fresh_global_work_lineage_database_v01.py")
LOCK = Path("config/global-work-lineage-fresh-database-import-v01.lock.json")


def fail(message: str) -> None:
    raise SystemExit(f"FRESH WORK LINEAGE CUTOVER: FAIL: {message}")


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_bytes())
    require(isinstance(value, dict), f"expected object: {path}")
    return value


def run_bytes(command: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> bytes:
    proc = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        fail(
            f"command failed with exit {proc.returncode}: {command[0]}\n"
            + proc.stdout.decode("utf-8", errors="replace")
            + proc.stderr.decode("utf-8", errors="replace")
        )
    return proc.stdout


def run_json(command: list[str], *, cwd: Path | None = None) -> tuple[dict[str, Any], bytes]:
    payload = run_bytes(command, cwd=cwd)
    value = json.loads(payload)
    require(isinstance(value, dict), f"command emitted a non-object: {command[0]}")
    return value, payload


def tree_digest(root: Path) -> tuple[str, list[tuple[str, int, str]]]:
    files = sorted(path for path in root.rglob("*") if path.is_file())
    members = [
        (
            path.relative_to(root).as_posix(),
            path.stat().st_size,
            sha256_bytes(path.read_bytes()),
        )
        for path in files
    ]
    payload = "".join(f"{name}\t{size}\t{digest}\n" for name, size, digest in members).encode("utf-8")
    return sha256_bytes(payload), members


def database_name(database_url: str) -> str:
    parsed = urlparse(database_url)
    require(parsed.scheme in {"postgres", "postgresql"}, "database URL must use postgres or postgresql")
    name = unquote(parsed.path.lstrip("/"))
    require(name and "/" not in name, "database URL must name exactly one database")
    return name


def assert_empty_database(database_url: str, expected_name: str) -> None:
    query = r"""
SELECT json_build_object(
  'database', current_database(),
  'userTables', count(*)
)::text
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  AND table_type = 'BASE TABLE';
"""
    env = os.environ.copy()
    env["PGOPTIONS"] = "-c default_transaction_read_only=on"
    payload = run_bytes(
        [
            "psql",
            "--no-psqlrc",
            "--set",
            "ON_ERROR_STOP=1",
            "--tuples-only",
            "--no-align",
            "--dbname",
            database_url,
            "--command",
            query,
        ],
        env=env,
    ).decode("utf-8").strip()
    state = json.loads(payload)
    require(isinstance(state, dict), "database preflight did not return an object")
    require(state.get("database") == expected_name, "database name changed during preflight")
    require(state.get("userTables") == 0, "target database is not empty")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--formal-package", type=Path, required=True)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--expected-database-name", default="baihepailei_v01")
    parser.add_argument("--proof-dir", type=Path, required=True)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    formal_package = args.formal_package.resolve()
    proof_dir = args.proof_dir.resolve()
    lock_path = root / LOCK
    preparer = root / PREPARER
    validator = root / DATABASE_VALIDATOR

    require(shutil.which("psql") is not None, "psql is required")
    require(formal_package.is_dir(), "formal package directory is missing")
    require(lock_path.is_file() and preparer.is_file() and validator.is_file(), "cutover source file missing")
    require(not proof_dir.exists(), "proof directory already exists")
    require(database_name(args.database_url) == args.expected_database_name, "refusing unexpected database name")

    lock = load_json(lock_path)
    require(lock["target"]["databaseMustBeEmpty"] is True, "lock does not require an empty database")
    require(lock["target"]["compatibilityBridges"] == 0, "lock permits compatibility bridges")
    require(lock["target"]["legacyRuntimeDependencies"] == 0, "lock permits legacy runtime dependencies")
    require(lock["target"]["referenceRuntimeDependencies"] == 0, "lock permits reference runtime dependencies")
    assert_empty_database(args.database_url, args.expected_database_name)

    proof_dir.mkdir(parents=True)
    with tempfile.TemporaryDirectory(prefix="baihepailei-work-lineage-cutover-v01-") as temp_raw:
        temp = Path(temp_raw)
        prepared1 = temp / "prepared-1"
        prepared2 = temp / "prepared-2"
        import_prepared = temp / "import-prepared"
        prepare1_path = temp / "prepare-1.json"
        prepare2_path = temp / "prepare-2.json"
        import_path = temp / "import.json"

        common = [
            sys.executable,
            str(preparer),
            "--formal-package",
            str(formal_package),
            "--lock",
            str(lock_path),
        ]
        prepare1, prepare1_bytes = run_json(common + ["--out", str(prepared1), "--proof", str(prepare1_path)])
        prepare2, prepare2_bytes = run_json(common + ["--out", str(prepared2), "--proof", str(prepare2_path)])
        require(prepare1_bytes == prepare1_path.read_bytes(), "prepare run 1 stdout/proof drift")
        require(prepare2_bytes == prepare2_path.read_bytes(), "prepare run 2 stdout/proof drift")
        require(prepare1_bytes == prepare2_bytes and prepare1 == prepare2, "prepare proofs are not deterministic")
        tree1, members1 = tree_digest(prepared1)
        tree2, members2 = tree_digest(prepared2)
        require(tree1 == tree2 and members1 == members2, "prepared import trees are not byte-identical")
        require(prepare1["status"] == "PASS_PREPARED", "unexpected prepare status")

        imported, import_bytes = run_json(
            common
            + [
                "--out",
                str(import_prepared),
                "--execute",
                "--database-url",
                args.database_url,
                "--proof",
                str(import_path),
            ]
        )
        require(import_bytes == import_path.read_bytes(), "import stdout/proof drift")
        require(imported["status"] == "PASS_IMPORTED", "unexpected import status")

        shutil.copy2(prepare1_path, proof_dir / "prepare.json")
        shutil.copy2(import_path, proof_dir / "import.json")

        # Remove every generated package derivative before the database-only pass.
        for generated in (prepared1, prepared2, import_prepared):
            shutil.rmtree(generated)
            require(not generated.exists(), f"generated import material survived: {generated.name}")

        isolated = temp / "database-only-validation"
        isolated.mkdir()
        isolated_validator = isolated / "validate-db.py"
        isolated_lock = isolated / "import.lock.json"
        database_proof_path = isolated / "database-proof.json"
        shutil.copy2(validator, isolated_validator)
        shutil.copy2(lock_path, isolated_lock)
        database_proof, database_proof_bytes = run_json(
            [
                sys.executable,
                str(isolated_validator),
                "--database-url",
                args.database_url,
                "--lock",
                str(isolated_lock),
                "--out",
                str(database_proof_path),
            ],
            cwd=isolated,
        )
        require(database_proof_bytes == database_proof_path.read_bytes(), "database stdout/proof drift")
        require(database_proof["status"] == "PASS_FRESH_ISOLATED_DATABASE", "unexpected database status")
        shutil.copy2(database_proof_path, proof_dir / "database-proof.json")

    summary = {
        "schemaVersion": "global-work-lineage-fresh-database-cutover-result-v01",
        "status": "PASS_CUTOVER_COMPLETE",
        "packageId": lock["packageId"],
        "contractVersion": "global-work-lineage-v01",
        "frozenBlockCount": 13,
        "databaseName": args.expected_database_name,
        "counts": lock["formalPackage"]["counts"],
        "proofs": {
            name: sha256_bytes((proof_dir / name).read_bytes())
            for name in ("prepare.json", "import.json", "database-proof.json")
        },
        "preparedTreeSha256": tree1,
        "isolation": {
            "oldDatabaseConnections": 0,
            "legacySourceReadByDatabaseValidator": False,
            "formalPackageReadByDatabaseValidator": False,
            "referencePackageReadByDatabaseValidator": False,
            "compatibilityBridges": 0,
            "dualReads": 0,
            "generatedImportMaterialRemovedBeforeValidation": True,
        },
    }
    summary_bytes = (json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    (proof_dir / "cutover-summary.json").write_bytes(summary_bytes)
    sys.stdout.buffer.write(summary_bytes)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
