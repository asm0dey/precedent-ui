"""Cypher strings and row shaping. Pure — no I/O, no FastAPI."""

from __future__ import annotations

from typing import Any

# Which property carries a node's human-readable caption, per label.
CAPTION_FIELD: dict[str, str] = {
    "Decision": "title",
    "Project": "name",
    "Tag": "name",
    "Topic": "name",
    "Option": "name",
    "Principle": "statement",
    "Lesson": "statement",
}

# Which properties search scans, per label.
SEARCH_FIELDS: dict[str, list[str]] = {
    "Decision": ["title", "statement", "rationale"],
    "Project": ["name", "id"],
    "Tag": ["name"],
    "Topic": ["name"],
    "Option": ["name"],
    "Principle": ["statement"],
    "Lesson": ["statement"],
}

# The stable, rebuild-surviving key, per label.
DOMAIN_KEY: dict[str, str] = {
    "Decision": "id",
    "Project": "id",
    "Principle": "id",
    "Lesson": "id",
    "Tag": "name",
    "Topic": "name",
    "Option": "name",
}


def node_out(raw: dict) -> dict:
    return {
        "id": raw["__id"],
        "labels": raw["__labels"],
        "props": {k: v for k, v in raw.items() if not k.startswith("__")},
    }


def rel_out(raw: dict) -> dict:
    """Synthesise an edge id: graphdblite exposes none, and graphology needs one.

    The schema has no parallel edges of the same type between the same pair,
    so src-type-dst is unique in practice.
    """
    src, dst, typ = raw["__src"], raw["__dst"], raw["__label"]
    return {"id": f"{src}-{typ}-{dst}", "src": src, "dst": dst, "type": typ}


def classify(value: Any) -> dict:
    if isinstance(value, dict) and "__labels" in value:
        return {"kind": "node", "node": node_out(value)}
    if isinstance(value, dict) and "__label" in value and "__src" in value:
        return {"kind": "rel", "rel": rel_out(value)}
    return {"kind": "scalar", "value": value}


def caption(node: dict) -> str:
    label = node["labels"][0] if node["labels"] else ""
    field = CAPTION_FIELD.get(label)
    value = node["props"].get(field) if field else None
    return str(value) if value is not None else f"{label} #{node['id']}"
