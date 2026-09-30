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


def search_cypher(label: str, field: str) -> str:
    """One query per label/field. No UNION: ranking happens in Python anyway,
    and per-label queries keep the dialect surface small."""
    return (
        f"MATCH (n:{label}) WHERE toLower(toString(n.{field})) CONTAINS $q "
        f"RETURN n AS n LIMIT $cap"
    )


DEGREE_FOR_IDS = (
    "MATCH (n)-[r]-() WHERE id(n) IN $ids RETURN id(n) AS id, count(r) AS degree"
)

NODE_BY_ID = "MATCH (n) WHERE id(n) = $id RETURN n AS n"
DEGREE_OUT = "MATCH (n)-[r]->() WHERE id(n) = $id RETURN type(r) AS type, count(*) AS n"
DEGREE_IN = "MATCH (n)<-[r]-() WHERE id(n) = $id RETURN type(r) AS type, count(*) AS n"


def rank(node: dict, needle: str) -> int:
    cap = caption(node).lower()
    if cap == needle:
        return 0
    if cap.startswith(needle):
        return 1
    if needle in cap:
        return 2
    return 3


def subtitle(node: dict) -> str:
    label = node["labels"][0] if node["labels"] else "?"
    props = node["props"]
    if label == "Decision":
        return f"{props.get('scope', '?')} · {props.get('status', '?')}"
    return label


def domain_key(node: dict) -> dict | None:
    label = node["labels"][0] if node["labels"] else ""
    field = DOMAIN_KEY.get(label)
    if field is None or field not in node["props"]:
        return None
    return {"field": field, "value": node["props"][field]}


def expand_cypher(edge_type: str | None, direction: str | None) -> str:
    """Neighbours along one direction or both (undirected), optionally one type.

    Ordered by neighbour id so that offset paging is stable.
    """
    rel = f"[r:{edge_type}]" if edge_type else "[r]"
    if direction == "out":
        pattern = f"(n)-{rel}->(m)"
    elif direction == "in":
        pattern = f"(n)<-{rel}-(m)"
    else:  # direction is None → undirected
        pattern = f"(n)-{rel}-(m)"
    return (
        f"MATCH {pattern} WHERE id(n) = $id "
        f"RETURN m AS m, r AS r ORDER BY id(m) SKIP $offset LIMIT $limit"
    )


def expand_count_cypher(edge_type: str | None, direction: str | None) -> str:
    rel = f"[r:{edge_type}]" if edge_type else "[r]"
    if direction == "out":
        pattern = f"(n)-{rel}->(m)"
    elif direction == "in":
        pattern = f"(n)<-{rel}-(m)"
    else:  # direction is None → undirected
        pattern = f"(n)-{rel}-(m)"
    return f"MATCH {pattern} WHERE id(n) = $id RETURN count(r) AS n"


EDGES_BETWEEN = (
    "MATCH (a)-[r]->(b) WHERE id(a) IN $ids AND id(b) IN $ids RETURN r AS r"
)
