#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Offline XWiki MySQL dump analyzer.

This script reads a .sql or .sql.gz dump, extracts selected XWiki tables,
classifies pages into rough review buckets, and writes CSV inventories.

It is intentionally read-only: it never modifies the input dump or any raw backup.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import os
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple


SYSTEM_SPACES = {
    "XWiki",
    "Main",
    "Sandbox",
    "Panels",
    "Scheduler",
    "Dashboard",
    "ColorThemes",
    "IconThemes",
    "Help",
    "Tour",
    "AppWithinMinutes",
    "AnnotationCode",
    "Invitation",
    "Stats",
    "PanelsCode",
    "XWikiOrg",
}

SYSTEM_PAGE_NAMES = {
    "WebHome",
    "WebPreferences",
    "XWikiPreferences",
    "XWikiServerClass",
    "XWikiUsers",
    "XWikiGroups",
    "XWikiRights",
    "XWikiGlobalRights",
    "XWikiSkins",
    "XWikiComments",
    "XWikiAttachments",
    "XWikiTagClass",
    "XWikiPreferencesClass",
    "XWikiGuest",
    "Admin",
}

SPAM_KEYWORDS = {
    "casino",
    "poker",
    "บาคาร่า",
    "พนัน",
    "viagra",
    "levitra",
    "cialis",
    "loan",
    "payday",
    "seo",
    "backlink",
    "adult",
    "porn",
    "escort",
    "crypto giveaway",
    "free money",
    "betting",
    "sportsbook",
}

DOC_FALLBACK_COLUMNS = [
    "XWD_ID",
    "XWD_FULLNAME",
    "XWD_NAME",
    "XWD_TITLE",
    "XWD_LANGUAGE",
    "XWD_DEFAULT_LANGUAGE",
    "XWD_TRANSLATION",
    "XWD_DATE",
    "XWD_CONTENT_UPDATE_DATE",
    "XWD_CREATION_DATE",
    "XWD_AUTHOR",
    "XWD_CONTENT_AUTHOR",
    "XWD_CREATOR",
    "XWD_WEB",
    "XWD_CONTENT",
    "XWD_VERSION",
    "XWD_CUSTOM_CLASS",
    "XWD_PARENT",
    "XWD_CLASS_XML",
    "XWD_ELEMENTS",
    "XWD_DEFAULT_TEMPLATE",
    "XWD_VALIDATION_SCRIPT",
    "XWD_COMMENT",
    "XWD_MINOREDIT",
    "XWD_SYNTAX_ID",
    "XWD_HIDDEN",
]

ATTACHMENT_FALLBACK_COLUMNS = [
    "XWA_ID",
    "XWA_DOC_ID",
    "XWA_FILENAME",
    "XWA_AUTHOR",
    "XWA_DATE",
    "XWA_VERSION",
    "XWA_COMMENT",
    "XWA_CONTENT_SIZE",
    "XWA_MIMETYPE",
    "XWA_CHARSET",
]

OBJECT_FALLBACK_COLUMNS = [
    "XWO_ID",
    "XWO_CLASSNAME",
    "XWO_NUMBER",
    "XWO_NAME",
]

RECYCLE_FALLBACK_COLUMNS = [
    "XWR_ID",
    "XWR_FULLNAME",
    "XWR_DATE",
    "XWR_DELETER",
    "XWR_XML",
]

INSERT_RE = re.compile(
    r"^INSERT\s+INTO\s+`?([^`\s(]+)`?\s*(?:\((.*?)\))?\s+VALUES\s*(.*);\s*$",
    re.IGNORECASE | re.DOTALL,
)

URL_RE = re.compile(r"https?://|www\.", re.IGNORECASE)
CHINESE_RE = re.compile(r"[\u4e00-\u9fff]")
SAFE_FILENAME_RE = re.compile(r"[^\w.\-\u4e00-\u9fff]+", re.UNICODE)


@dataclass
class Document:
    doc_id: str = ""
    full_name: str = ""
    web: str = ""
    name: str = ""
    title: str = ""
    author: str = ""
    content_author: str = ""
    creator: str = ""
    created_at: str = ""
    updated_at: str = ""
    content_updated_at: str = ""
    version: str = ""
    syntax: str = ""
    hidden: str = ""
    content: str = ""
    content_len: int = 0
    chinese_chars: int = 0
    url_count: int = 0
    attachment_count: int = 0
    category: str = ""
    reasons: List[str] = field(default_factory=list)


@dataclass
class Attachment:
    attachment_id: str = ""
    doc_id: str = ""
    doc_full_name: str = ""
    filename: str = ""
    author: str = ""
    date: str = ""
    version: str = ""
    size: str = ""
    mimetype: str = ""
    charset: str = ""


def open_text(path: Path):
    if str(path).lower().endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8", errors="replace", newline="")
    return open(path, "rt", encoding="utf-8", errors="replace", newline="")


def iter_insert_statements(path: Path, wanted_tables: Optional[set[str]] = None) -> Iterator[Tuple[str, Optional[List[str]], str]]:
    """Yield (table, columns, values_sql) for INSERT statements."""
    with open_text(path) as f:
        buf: List[str] = []
        collecting = False
        for line in f:
            if not collecting:
                if not line.lstrip().upper().startswith("INSERT INTO"):
                    continue
                buf = [line]
                collecting = not line.rstrip().endswith(";")
            else:
                buf.append(line)
                if line.rstrip().endswith(";"):
                    collecting = False

            if not collecting and buf:
                stmt = "".join(buf)
                buf = []
                m = INSERT_RE.match(stmt.strip())
                if not m:
                    continue
                table = m.group(1)
                if wanted_tables and table.lower() not in wanted_tables:
                    continue
                raw_columns = m.group(2)
                values_sql = m.group(3)
                columns = parse_columns(raw_columns) if raw_columns else None
                yield table.lower(), columns, values_sql


def parse_columns(raw_columns: str) -> List[str]:
    cols = []
    for part in raw_columns.split(","):
        part = part.strip()
        if part.startswith("`") and part.endswith("`"):
            part = part[1:-1]
        cols.append(part)
    return cols


def decode_mysql_escape(ch: str) -> str:
    return {
        "0": "\0",
        "b": "\b",
        "n": "\n",
        "r": "\r",
        "t": "\t",
        "Z": "\x1a",
        "\\": "\\",
        "'": "'",
        '"': '"',
    }.get(ch, ch)


def parse_values(values_sql: str) -> Iterator[List[Any]]:
    """Parse the VALUES part of a MySQL INSERT statement.

    It supports common mysqldump output: quoted strings with backslash escapes,
    NULL, numbers, and unquoted tokens such as 0xABCD.
    """
    i = 0
    n = len(values_sql)

    def skip_ws(pos: int) -> int:
        while pos < n and values_sql[pos].isspace():
            pos += 1
        return pos

    while i < n:
        i = skip_ws(i)
        if i < n and values_sql[i] == ",":
            i += 1
            continue
        if i >= n:
            break
        if values_sql[i] != "(":
            i += 1
            continue
        i += 1
        row: List[Any] = []
        while i < n:
            i = skip_ws(i)
            if i < n and values_sql[i] == "'":
                i += 1
                chars: List[str] = []
                while i < n:
                    ch = values_sql[i]
                    if ch == "\\" and i + 1 < n:
                        chars.append(decode_mysql_escape(values_sql[i + 1]))
                        i += 2
                        continue
                    if ch == "'":
                        # MySQL may also escape a single quote as two single quotes.
                        if i + 1 < n and values_sql[i + 1] == "'":
                            chars.append("'")
                            i += 2
                            continue
                        i += 1
                        break
                    chars.append(ch)
                    i += 1
                value: Any = "".join(chars)
            else:
                start = i
                while i < n and values_sql[i] not in ",)":
                    i += 1
                token = values_sql[start:i].strip()
                if token.upper() == "NULL":
                    value = None
                else:
                    value = token
            row.append(value)
            i = skip_ws(i)
            if i < n and values_sql[i] == ",":
                i += 1
                continue
            if i < n and values_sql[i] == ")":
                i += 1
                break
        yield row


def fallback_columns_for_table(table: str) -> List[str]:
    if table == "xwikidoc":
        return DOC_FALLBACK_COLUMNS
    if table == "xwikiattachment":
        return ATTACHMENT_FALLBACK_COLUMNS
    if table == "xwikiobjects":
        return OBJECT_FALLBACK_COLUMNS
    if table == "xwikirecyclebin":
        return RECYCLE_FALLBACK_COLUMNS
    return []


def row_to_dict(row: Sequence[Any], columns: Optional[List[str]], table: str) -> Dict[str, Any]:
    cols = columns or fallback_columns_for_table(table)
    d: Dict[str, Any] = {}
    for idx, value in enumerate(row):
        if idx < len(cols):
            d[cols[idx].upper()] = value
        else:
            d[f"COL_{idx}"] = value
    return d


def first_value(d: Dict[str, Any], names: Sequence[str], default: str = "") -> str:
    for name in names:
        value = d.get(name.upper())
        if value is not None:
            return str(value)
    return default


def boolish(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def split_full_name(full_name: str, web: str = "", name: str = "") -> Tuple[str, str]:
    if web and name:
        return web, name
    if "." in full_name:
        left, right = full_name.rsplit(".", 1)
        return left or web, right or name
    return web, name or full_name


def normalize_author(author: str) -> str:
    author = (author or "").strip()
    for prefix in ("xwiki:", "XWiki."):
        if author.startswith(prefix):
            return author[len(prefix):]
    return author


def make_document(d: Dict[str, Any]) -> Document:
    doc_id = first_value(d, ["XWD_ID", "ID"])
    full_name = first_value(d, ["XWD_FULLNAME", "FULLNAME"])
    web = first_value(d, ["XWD_WEB", "WEB"])
    name = first_value(d, ["XWD_NAME", "NAME"])
    web, name = split_full_name(full_name, web, name)
    if not full_name:
        full_name = f"{web}.{name}" if web else name
    content = first_value(d, ["XWD_CONTENT", "CONTENT"])
    return Document(
        doc_id=doc_id,
        full_name=full_name,
        web=web,
        name=name,
        title=first_value(d, ["XWD_TITLE", "TITLE"]),
        author=first_value(d, ["XWD_AUTHOR", "AUTHOR"]),
        content_author=first_value(d, ["XWD_CONTENT_AUTHOR", "CONTENT_AUTHOR"]),
        creator=first_value(d, ["XWD_CREATOR", "CREATOR"]),
        created_at=first_value(d, ["XWD_CREATION_DATE", "CREATION_DATE"]),
        updated_at=first_value(d, ["XWD_DATE", "DATE"]),
        content_updated_at=first_value(d, ["XWD_CONTENT_UPDATE_DATE", "CONTENT_UPDATE_DATE"]),
        version=first_value(d, ["XWD_VERSION", "VERSION"]),
        syntax=first_value(d, ["XWD_SYNTAX_ID", "SYNTAX_ID"]),
        hidden=first_value(d, ["XWD_HIDDEN", "HIDDEN"]),
        content=content,
    )


def make_attachment(d: Dict[str, Any]) -> Attachment:
    return Attachment(
        attachment_id=first_value(d, ["XWA_ID", "ID"]),
        doc_id=first_value(d, ["XWA_DOC_ID", "DOC_ID"]),
        filename=first_value(d, ["XWA_FILENAME", "FILENAME"]),
        author=first_value(d, ["XWA_AUTHOR", "AUTHOR"]),
        date=first_value(d, ["XWA_DATE", "DATE"]),
        version=first_value(d, ["XWA_VERSION", "VERSION"]),
        size=first_value(d, ["XWA_CONTENT_SIZE", "CONTENT_SIZE", "XWA_SIZE", "SIZE"]),
        mimetype=first_value(d, ["XWA_MIMETYPE", "MIMETYPE", "XWA_MIME_TYPE"]),
        charset=first_value(d, ["XWA_CHARSET", "CHARSET"]),
    )


def analyze_text(doc: Document) -> None:
    content = doc.content or ""
    doc.content_len = len(content)
    doc.chinese_chars = len(CHINESE_RE.findall(content))
    doc.url_count = len(URL_RE.findall(content))


def classify_document(doc: Document) -> None:
    reasons: List[str] = []
    content_lower = (doc.content or "").lower()
    web_head = (doc.web or "").split(".")[0]
    name = doc.name or ""
    hidden = boolish(doc.hidden)

    is_system_space = web_head in SYSTEM_SPACES or doc.web in SYSTEM_SPACES
    is_system_name = name in SYSTEM_PAGE_NAMES or name.endswith("Class") or name.endswith("Sheet") or name.endswith("Template")
    is_user_profile_page = doc.web == "XWiki" and name not in SYSTEM_PAGE_NAMES and doc.content_len < 800
    spam_hits = sorted(k for k in SPAM_KEYWORDS if k in content_lower)
    suspicious_author = any(
        token in normalize_author(doc.author).lower()
        for token in ("anonymous", "guest", "spam", "bot")
    )

    if is_system_space:
        reasons.append("system_space")
    if is_system_name:
        reasons.append("system_page_name")
    if hidden:
        reasons.append("hidden")
    if doc.content_len >= 500:
        reasons.append("long_content")
    if doc.chinese_chars >= 80:
        reasons.append("has_chinese_content")
    if doc.attachment_count > 0:
        reasons.append("has_attachment")
    if doc.url_count >= 5:
        reasons.append("many_urls")
    if suspicious_author:
        reasons.append("suspicious_author")
    if spam_hits:
        reasons.append("spam_keywords:" + "|".join(spam_hits[:8]))

    looks_spam = False
    if spam_hits and (doc.url_count >= 2 or doc.chinese_chars == 0):
        looks_spam = True
    if doc.url_count >= 10 and doc.content_len < 3000:
        looks_spam = True
    if suspicious_author and doc.content_len < 300 and doc.attachment_count == 0:
        looks_spam = True

    strong_personal_signal = (
        doc.content_len >= 800
        or doc.chinese_chars >= 120
        or doc.attachment_count > 0
    )
    weak_personal_signal = doc.content_len >= 200 or doc.chinese_chars >= 30

    if looks_spam:
        doc.category = "candidate_spam_or_junk"
    elif is_system_space or is_system_name or hidden or is_user_profile_page:
        # A system-space page with substantial Chinese text may still be useful,
        # but keep it in system bucket for the first pass and surface the reasons.
        doc.category = "candidate_system_page"
    elif strong_personal_signal:
        doc.category = "candidate_user_content"
    elif weak_personal_signal:
        doc.category = "needs_review"
    else:
        doc.category = "needs_review"

    doc.reasons = reasons


def safe_filename(index: int, doc: Document) -> str:
    base = f"{index:04d}_{doc.category}_{doc.full_name}"[:180]
    base = SAFE_FILENAME_RE.sub("_", base).strip("._")
    return base + ".xwiki.md"


def write_csv(path: Path, rows: Iterable[Dict[str, Any]], fieldnames: Sequence[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def doc_to_row(doc: Document, include_content: bool = False) -> Dict[str, Any]:
    row = {
        "doc_id": doc.doc_id,
        "full_name": doc.full_name,
        "web": doc.web,
        "name": doc.name,
        "title": doc.title,
        "creator": doc.creator,
        "author": doc.author,
        "content_author": doc.content_author,
        "created_at": doc.created_at,
        "updated_at": doc.updated_at,
        "content_updated_at": doc.content_updated_at,
        "version": doc.version,
        "syntax": doc.syntax,
        "hidden": doc.hidden,
        "content_len": doc.content_len,
        "chinese_chars": doc.chinese_chars,
        "url_count": doc.url_count,
        "attachment_count": doc.attachment_count,
        "category": doc.category,
        "reasons": ";".join(doc.reasons),
    }
    if include_content:
        row["content"] = doc.content
    return row


def attachment_to_row(att: Attachment) -> Dict[str, Any]:
    return {
        "attachment_id": att.attachment_id,
        "doc_id": att.doc_id,
        "doc_full_name": att.doc_full_name,
        "filename": att.filename,
        "author": att.author,
        "date": att.date,
        "version": att.version,
        "size": att.size,
        "mimetype": att.mimetype,
        "charset": att.charset,
    }


def load_dump(dump_path: Path) -> Tuple[List[Document], List[Attachment], Counter]:
    docs: List[Document] = []
    attachments: List[Attachment] = []
    object_classes: Counter = Counter()
    wanted = {"xwikidoc", "xwikiattachment", "xwikiobjects", "xwikirecyclebin"}

    for table, columns, values_sql in iter_insert_statements(dump_path, wanted):
        for raw_row in parse_values(values_sql):
            d = row_to_dict(raw_row, columns, table)
            if table == "xwikidoc":
                docs.append(make_document(d))
            elif table == "xwikiattachment":
                attachments.append(make_attachment(d))
            elif table == "xwikiobjects":
                class_name = first_value(d, ["XWO_CLASSNAME", "CLASSNAME"])
                if class_name:
                    object_classes[class_name] += 1
            elif table == "xwikirecyclebin":
                object_classes["__recyclebin_rows__"] += 1

    return docs, attachments, object_classes


def summarize_authors(docs: Sequence[Document]) -> List[Dict[str, Any]]:
    stats: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "author": "",
        "page_count": 0,
        "content_bytes": 0,
        "attachments": 0,
        "candidate_user_content": 0,
        "needs_review": 0,
        "candidate_system_page": 0,
        "candidate_spam_or_junk": 0,
    })
    for doc in docs:
        key = doc.author or doc.content_author or doc.creator or "(empty)"
        s = stats[key]
        s["author"] = key
        s["page_count"] += 1
        s["content_bytes"] += doc.content_len
        s["attachments"] += doc.attachment_count
        s[doc.category] += 1
    return sorted(stats.values(), key=lambda r: (r["content_bytes"], r["page_count"]), reverse=True)


def summarize_spaces(docs: Sequence[Document]) -> List[Dict[str, Any]]:
    stats: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "space": "",
        "page_count": 0,
        "content_bytes": 0,
        "attachments": 0,
        "candidate_user_content": 0,
        "needs_review": 0,
        "candidate_system_page": 0,
        "candidate_spam_or_junk": 0,
    })
    for doc in docs:
        key = doc.web or "(empty)"
        s = stats[key]
        s["space"] = key
        s["page_count"] += 1
        s["content_bytes"] += doc.content_len
        s["attachments"] += doc.attachment_count
        s[doc.category] += 1
    return sorted(stats.values(), key=lambda r: (r["content_bytes"], r["page_count"]), reverse=True)


def export_pages(out_dir: Path, docs: Sequence[Document]) -> None:
    pages_dir = out_dir / "exported_pages_xwiki_syntax"
    pages_dir.mkdir(parents=True, exist_ok=True)
    index_rows = []
    exportable = [d for d in docs if d.category in {"candidate_user_content", "needs_review"}]
    for i, doc in enumerate(exportable, start=1):
        filename = safe_filename(i, doc)
        page_path = pages_dir / filename
        header = [
            f"---",
            f"full_name: {doc.full_name}",
            f"title: {doc.title}",
            f"author: {doc.author}",
            f"creator: {doc.creator}",
            f"updated_at: {doc.updated_at}",
            f"syntax: {doc.syntax}",
            f"category: {doc.category}",
            f"reasons: {';'.join(doc.reasons)}",
            f"---",
            "",
        ]
        page_path.write_text("\n".join(header) + (doc.content or ""), encoding="utf-8")
        row = doc_to_row(doc)
        row["exported_file"] = str(page_path.relative_to(out_dir))
        index_rows.append(row)

    if index_rows:
        fields = list(index_rows[0].keys())
        write_csv(out_dir / "exported_pages_index.csv", index_rows, fields)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Analyze an XWiki MySQL dump offline.")
    parser.add_argument("--dump", required=True, help="Path to .sql or .sql.gz dump")
    parser.add_argument("--out", required=True, help="Output directory")
    parser.add_argument("--export-pages", action="store_true", help="Export candidate user/review pages as XWiki syntax text")
    parser.add_argument("--include-content-in-csv", action="store_true", help="Also include page content in xwiki_docs_inventory.csv")
    args = parser.parse_args(argv)

    dump_path = Path(args.dump)
    out_dir = Path(args.out)
    if not dump_path.exists():
        print(f"ERROR: dump not found: {dump_path}", file=sys.stderr)
        return 2
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Reading dump: {dump_path}")
    docs, attachments, object_classes = load_dump(dump_path)
    print(f"Loaded documents: {len(docs)}")
    print(f"Loaded attachments: {len(attachments)}")

    docs_by_id = {doc.doc_id: doc for doc in docs if doc.doc_id}
    attachments_by_doc_id: Dict[str, List[Attachment]] = defaultdict(list)
    for att in attachments:
        attachments_by_doc_id[att.doc_id].append(att)
        if att.doc_id in docs_by_id:
            att.doc_full_name = docs_by_id[att.doc_id].full_name

    for doc in docs:
        doc.attachment_count = len(attachments_by_doc_id.get(doc.doc_id, []))
        analyze_text(doc)
        classify_document(doc)

    doc_fields = [
        "doc_id",
        "full_name",
        "web",
        "name",
        "title",
        "creator",
        "author",
        "content_author",
        "created_at",
        "updated_at",
        "content_updated_at",
        "version",
        "syntax",
        "hidden",
        "content_len",
        "chinese_chars",
        "url_count",
        "attachment_count",
        "category",
        "reasons",
    ]
    if args.include_content_in_csv:
        doc_fields.append("content")

    docs_sorted = sorted(docs, key=lambda d: (d.category, -d.content_len, d.full_name))
    write_csv(
        out_dir / "xwiki_docs_inventory.csv",
        (doc_to_row(d, include_content=args.include_content_in_csv) for d in docs_sorted),
        doc_fields,
    )

    for category in [
        "candidate_user_content",
        "needs_review",
        "candidate_system_page",
        "candidate_spam_or_junk",
    ]:
        selected = sorted([d for d in docs if d.category == category], key=lambda d: (-d.content_len, d.full_name))
        write_csv(
            out_dir / f"xwiki_{category}.csv",
            (doc_to_row(d) for d in selected),
            doc_fields,
        )

    attachment_fields = [
        "attachment_id",
        "doc_id",
        "doc_full_name",
        "filename",
        "author",
        "date",
        "version",
        "size",
        "mimetype",
        "charset",
    ]
    write_csv(out_dir / "xwiki_attachment_inventory.csv", (attachment_to_row(a) for a in attachments), attachment_fields)

    summary_fields = [
        "author",
        "page_count",
        "content_bytes",
        "attachments",
        "candidate_user_content",
        "needs_review",
        "candidate_system_page",
        "candidate_spam_or_junk",
    ]
    write_csv(out_dir / "xwiki_author_summary.csv", summarize_authors(docs), summary_fields)

    space_fields = [
        "space",
        "page_count",
        "content_bytes",
        "attachments",
        "candidate_user_content",
        "needs_review",
        "candidate_system_page",
        "candidate_spam_or_junk",
    ]
    write_csv(out_dir / "xwiki_space_summary.csv", summarize_spaces(docs), space_fields)

    object_rows = [
        {"class_name": name, "count": count}
        for name, count in object_classes.most_common()
    ]
    write_csv(out_dir / "xwiki_object_class_summary.csv", object_rows, ["class_name", "count"])

    if args.export_pages:
        export_pages(out_dir, docs)

    category_counts = Counter(d.category for d in docs)
    print("\nCategory counts:")
    for category, count in category_counts.most_common():
        print(f"  {category}: {count}")
    print(f"\nWrote audit output to: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
