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
