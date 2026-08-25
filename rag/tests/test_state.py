from __future__ import annotations

from mycelia_rag.state import StateStore


def projection(projection_id: str, state: str = "catching_up") -> dict[str, object]:
    return {
        "id": projection_id,
        "fingerprint": "f" * 64,
        "generation": projection_id,
        "collectionName": f"rag_{projection_id}",
        "state": state,
        "createdAt": "2026-01-01T00:00:00Z",
        "buildStartedAt": "2026-01-01T00:00:00Z",
        "sourceSchemaFingerprint": "s" * 64,
        "chunkerVersion": "char-boundary-v1",
        "chunkerFingerprint": "c" * 64,
        "modelFingerprint": "m" * 64,
        "denseModel": "dense",
        "denseDimensions": 8,
        "sparseModel": "bm25",
    }


def test_activation_atomically_supersedes_previous_projection(tmp_path) -> None:
    state = StateStore(tmp_path / "state.sqlite3")
    state.create_projection(projection("one"))
    state.activate_projection("one", resume_token={"_data": "one"}, checkpoint_state="watching")
    state.create_projection(projection("two"))
    state.activate_projection("two", resume_token={"_data": "two"}, checkpoint_state="watching")

    assert state.active_projection()["id"] == "two"
    assert state.projection("one")["state"] == "superseded"
    assert state.projection("one")["supersededAt"] is not None


def test_building_projection_cannot_be_activated(tmp_path) -> None:
    state = StateStore(tmp_path / "state.sqlite3")
    state.create_projection(projection("building", state="building"))

    try:
        state.activate_projection(
            "building", resume_token={"_data": "bad"}, checkpoint_state="watching"
        )
    except ValueError as error:
        assert "catching_up" in str(error)
    else:
        raise AssertionError("activation should fail")
