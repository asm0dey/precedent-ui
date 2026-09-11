from server.queries import caption, classify, node_out, rel_out

NODE = {"__id": 2, "__labels": ["Decision"], "title": "Postgres", "status": "active"}
REL = {"__src": 1, "__dst": 13, "__label": "TAGGED"}


def test_node_out_splits_metadata_from_properties():
    assert node_out(NODE) == {
        "id": 2,
        "labels": ["Decision"],
        "props": {"title": "Postgres", "status": "active"},
    }


def test_rel_out_synthesises_a_stable_edge_id():
    assert rel_out(REL) == {"id": "1-TAGGED-13", "src": 1, "dst": 13, "type": "TAGGED"}


def test_classify_recognises_a_node():
    assert classify(NODE)["kind"] == "node"


def test_classify_recognises_a_relationship():
    assert classify(REL)["kind"] == "rel"


def test_classify_treats_a_path_as_a_scalar():
    # graphdblite returns paths as bare id lists with no type marker,
    # indistinguishable from a list of integers.
    assert classify([2, 3]) == {"kind": "scalar", "value": [2, 3]}


def test_classify_treats_plain_values_as_scalars():
    assert classify("postgres") == {"kind": "scalar", "value": "postgres"}
    assert classify(7) == {"kind": "scalar", "value": 7}
    assert classify(None) == {"kind": "scalar", "value": None}


def test_caption_uses_the_per_label_field():
    assert caption(node_out(NODE)) == "Postgres"
    tag = {"__id": 13, "__labels": ["Tag"], "name": "python"}
    assert caption(node_out(tag)) == "python"
