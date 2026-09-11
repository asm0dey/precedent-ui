def test_meta_reports_label_and_edge_counts(client):
    body = client.get("/api/meta").json()
    assert body["labels"]["Decision"] > 0
    assert body["labels"]["Project"] > 0
    assert body["edge_types"]["IN_PROJECT"] > 0
    assert body["mtime"] > 0


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
    assert body["nodes"] and body["edges"]
    assert all(e["type"] == "CHOSE" for e in body["edges"])
    assert all(e["src"] == nid for e in body["edges"])


def test_expand_reports_the_untruncated_total(client):
    nid = _first_decision_id(client)
    body = client.get(f"/api/expand/{nid}", params={"type": "CHOSE", "dir": "out", "limit": 1}).json()
    assert len(body["nodes"]) == 1
    assert body["total"] >= 1


def test_expand_pages_by_offset(client):
    nid = _first_decision_id(client)
    args = {"type": "CHOSE", "dir": "out", "limit": 1}
    first = client.get(f"/api/expand/{nid}", params=args).json()
    second = client.get(f"/api/expand/{nid}", params={**args, "offset": 1}).json()
    if second["nodes"]:
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
