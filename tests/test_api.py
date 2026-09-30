def test_meta_reports_label_and_edge_counts(client):
    body = client.get("/api/meta").json()
    assert body["labels"]["Decision"] > 0
    assert body["labels"]["Project"] > 0
    assert body["edge_types"]["IN_PROJECT"] > 0
    # journal-derived change stamp ("<mtime_ns>:<size>"), not a numeric mtime
    assert body["mtime"].count(":") == 1


def test_a_missing_store_names_the_resolved_path(tmp_path):
    from fastapi.testclient import TestClient

    from server.precedent_ui import create_app

    with TestClient(create_app(tmp_path / "nowhere"), raise_server_exceptions=False) as c:
        r = c.get("/api/meta")
    assert r.status_code == 503
    assert "nowhere" in r.json()["detail"]


def test_search_finds_a_decision_by_title(client):
    hits = client.get("/api/search", params={"q": "postgres"}).json()
    assert any("Postgres" in h["caption"] for h in hits)
    assert all({"id", "labels", "caption", "sub", "degree"} <= h.keys() for h in hits)


def test_search_finds_a_tag_by_name(client):
    hits = client.get("/api/search", params={"q": "python"}).json()
    assert any(h["labels"] == ["Tag"] and h["caption"] == "python" for h in hits)


def test_search_ranks_an_exact_caption_match_first(client):
    hits = client.get("/api/search", params={"q": "python"}).json()
    assert hits[0]["caption"] == "python"


def test_search_is_case_insensitive(client):
    assert client.get("/api/search", params={"q": "PYTHON"}).json()


def test_search_respects_limit(client):
    hits = client.get("/api/search", params={"q": "e", "limit": 3}).json()
    assert len(hits) <= 3


def test_search_with_empty_query_returns_nothing(client):
    assert client.get("/api/search", params={"q": "  "}).json() == []


def _first_decision_id(client):
    hits = client.get("/api/search", params={"q": "postgres"}).json()
    return next(h["id"] for h in hits if h["labels"] == ["Decision"])


def test_node_returns_props_and_caption(client):
    nid = _first_decision_id(client)
    body = client.get(f"/api/node/{nid}").json()
    assert body["labels"] == ["Decision"]
    assert body["props"]["rationale"]
    assert body["caption"]


def test_node_reports_the_stable_domain_key(client):
    nid = _first_decision_id(client)
    body = client.get(f"/api/node/{nid}").json()
    assert body["key"]["field"] == "id"
    assert body["key"]["value"]


def test_node_degrees_are_split_by_type_and_direction(client):
    nid = _first_decision_id(client)
    degrees = client.get(f"/api/node/{nid}").json()["degrees"]
    out = {(d["type"], d["dir"]): d["count"] for d in degrees}
    assert out[("IN_PROJECT", "out")] == 1
    assert out[("CHOSE", "out")] >= 1


def test_node_404_for_a_missing_id(client):
    assert client.get("/api/node/99999999").status_code == 404


def test_expand_returns_neighbours_and_connecting_edges(client):
    nid = _first_decision_id(client)
    body = client.get(f"/api/expand/{nid}", params={"type": "CHOSE", "dir": "out"}).json()
    assert body["nodes"]
    assert body["edges"]
    assert all(e["type"] == "CHOSE" for e in body["edges"])
    assert all(e["src"] == nid for e in body["edges"])


def test_expand_reports_the_untruncated_total(client):
    nid = _first_decision_id(client)
    body = client.get(f"/api/expand/{nid}", params={"type": "REJECTED", "dir": "out", "limit": 1}).json()
    assert len(body["nodes"]) == 1
    assert body["total"] == 2, "total must be the untruncated count, not len(nodes)"


def test_expand_pages_by_offset(client):
    nid = _first_decision_id(client)
    args = {"type": "REJECTED", "dir": "out", "limit": 1}
    first = client.get(f"/api/expand/{nid}", params=args).json()
    second = client.get(f"/api/expand/{nid}", params={**args, "offset": 1}).json()
    assert first["nodes"], "both pages must be non-empty with 2 edges"
    assert second["nodes"], "both pages must be non-empty with 2 edges"
    assert first["nodes"][0]["id"] != second["nodes"][0]["id"]


def test_expand_without_a_type_returns_every_type(client):
    nid = _first_decision_id(client)
    types = {e["type"] for e in client.get(f"/api/expand/{nid}").json()["edges"]}
    assert len(types) > 1


def test_edges_between_finds_edges_among_loaded_nodes(client):
    nid = _first_decision_id(client)
    expanded = client.get(f"/api/expand/{nid}").json()
    ids = [nid] + [n["id"] for n in expanded["nodes"]]
    edges = client.post("/api/edges-between", json={"ids": ids}).json()["edges"]
    assert len(edges) >= len(expanded["edges"])


def test_edges_between_with_no_ids_returns_nothing(client):
    assert client.post("/api/edges-between", json={"ids": []}).json()["edges"] == []


def test_expand_without_direction_respects_the_cap(client):
    nid = _first_decision_id(client)
    body = client.get(f"/api/expand/{nid}", params={"limit": 3}).json()
    assert len(body["nodes"]) <= 3, "an omitted dir must not return 2x the cap"
    assert body["total"] == 6, "total counts both directions undirected"


def test_expand_with_invalid_type_returns_400(client):
    nid = _first_decision_id(client)
    r = client.get(f"/api/expand/{nid}", params={"type": "invalid-type"})
    assert r.status_code == 400
    assert "invalid edge type" in r.json()["detail"]


def test_expand_with_invalid_direction_returns_400(client):
    nid = _first_decision_id(client)
    r = client.get(f"/api/expand/{nid}", params={"dir": "outt"})
    assert r.status_code == 400
    assert "invalid direction" in r.json()["detail"]


def test_cypher_returns_classified_cells(client):
    body = client.post(
        "/api/cypher", json={"query": "MATCH (d:Decision) RETURN d AS d LIMIT 2"}
    ).json()
    assert body["columns"] == ["d"]
    assert body["rows"][0][0]["kind"] == "node"


def test_cypher_classifies_relationships(client):
    body = client.post(
        "/api/cypher", json={"query": "MATCH ()-[r]->() RETURN r AS r LIMIT 1"}
    ).json()
    assert body["rows"][0][0]["kind"] == "rel"


def test_cypher_takes_parameters(client):
    body = client.post(
        "/api/cypher",
        json={
            "query": "MATCH (t:Tag) WHERE t.name = $n RETURN t.name AS name",
            "params": {"n": "python"},
        },
    ).json()
    assert body["rows"][0][0]["value"] == "python"


def test_cypher_rejects_writes_via_the_engine(client):
    r = client.post("/api/cypher", json={"query": "CREATE (x:Zzz) RETURN x AS x"})
    assert r.status_code == 400
    assert "read transaction" in r.json()["detail"]["error"]


def test_cypher_surfaces_parse_errors_verbatim(client):
    r = client.post("/api/cypher", json={"query": "MATCH ("})
    assert r.status_code == 400
    assert r.json()["detail"]["type"]


def test_cypher_caps_rows_and_says_so(client):
    body = client.post(
        "/api/cypher", json={"query": "MATCH (n) RETURN n AS n", "max_rows": 3}
    ).json()
    assert len(body["rows"]) == 3
    assert body["truncated"] is True


def test_mtime_events_emits_immediately_then_on_change(store, store_home, tmp_path):
    """Direct test of the SSE frame generator - no HTTP, no hang.

    Verifies that the generator:
    1. Emits immediately on first call (even before any change)
    2. Emits a new frame only when the journal-derived stamp changes (not on
       every poll)
    3. Frame format is correct SSE (data: JSON\n\n)
    """
    import asyncio
    import json

    from server.precedent_ui import mtime_events
    from tests.conftest import FIXTURE, build_store

    async def scenario() -> tuple[str, str]:
        gen = mtime_events(store, interval=0.01)
        first = await anext(gen)

        # build_store copies a *different* (shorter) journal over
        # journal.jsonl before rebuilding — the copy is what moves the
        # journal's mtime/size (the change_stamp the generator watches), the
        # same way a real `precedent.py record` append would.
        shorter = tmp_path / "shorter.jsonl"
        shorter.write_text("".join(FIXTURE.read_text().splitlines(keepends=True)[:6]))
        build_store(store_home, shorter)

        second = await anext(gen)
        await gen.aclose()
        return first, second

    first, second = asyncio.run(asyncio.wait_for(scenario(), timeout=10))

    assert first.startswith("data: ")
    assert first.endswith("\n\n")
    first_stamp = json.loads(first.removeprefix("data: "))["mtime"]
    assert first_stamp

    assert second.startswith("data: ")
    assert second.endswith("\n\n")
    second_stamp = json.loads(second.removeprefix("data: "))["mtime"]
    assert second_stamp != first_stamp, "a rewritten journal must produce a new frame"


def test_mtime_events_emits_only_on_change(store):
    """A generator missing its `if now != last` guard would still pass the
    emits-immediately-then-on-change test above, and in the UI that means a
    "graph changed" badge flashing every second. Drive the generator across
    several intervals with no journal write and assert no further frame
    arrives.
    """
    import asyncio

    import pytest

    from server.precedent_ui import mtime_events

    async def scenario() -> None:
        gen = mtime_events(store, interval=0.01)
        await anext(gen)  # the immediate first frame

        pending = anext(gen)
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(pending, timeout=0.2)

        await gen.aclose()

    asyncio.run(scenario())


def test_cypher_clamps_max_rows_to_at_least_one(client):
    """max_rows is client-controlled; unclamped at the bottom, `0` returned no
    rows at all while claiming `truncated: true`."""
    body = client.post(
        "/api/cypher", json={"query": "MATCH (n) RETURN n AS n", "max_rows": 0}
    ).json()
    assert len(body["rows"]) == 1
