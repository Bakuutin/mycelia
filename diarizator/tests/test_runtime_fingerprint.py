from simple_speaker_recognition.provenance import build_runtime_fingerprint


def test_embedding_space_changes_when_preprocessing_changes() -> None:
    first = build_runtime_fingerprint(
        diarization_model="diar-v1",
        embedding_model="embed-v1",
        sample_rate=16000,
        embedding_dimension=256,
        preprocessing="soundfile-v1",
    )
    second = build_runtime_fingerprint(
        diarization_model="diar-v1",
        embedding_model="embed-v1",
        sample_rate=8000,
        embedding_dimension=256,
        preprocessing="soundfile-v1",
    )
    assert first["embeddingSpaceId"] != second["embeddingSpaceId"]
    assert first["modelId"] == "diar-v1"
    assert first["modelVersion"] == "unknown"
    assert first["diarizationFingerprint"]["resolvedRevision"] == "unknown"


def test_resolves_model_revisions_from_huggingface_cache(tmp_path, monkeypatch) -> None:
    cache = tmp_path / "hub"
    diar_ref = cache / "models--pyannote--diar-v1" / "refs" / "main"
    embed_ref = cache / "models--pyannote--embed-v1" / "refs" / "main"
    diar_ref.parent.mkdir(parents=True)
    embed_ref.parent.mkdir(parents=True)
    diar_ref.write_text("diar-commit\n")
    embed_ref.write_text("embed-commit\n")
    monkeypatch.setenv("HF_HOME", str(tmp_path))

    result = build_runtime_fingerprint(
        diarization_model="pyannote/diar-v1",
        embedding_model="pyannote/embed-v1",
        sample_rate=16000,
        embedding_dimension=256,
        preprocessing="soundfile-v1",
    )

    assert result["diarizationFingerprint"]["resolvedRevision"] == "diar-commit"
    assert result["modelId"] == "pyannote/diar-v1"
    assert result["modelVersion"] == "diar-commit"
    assert result["embeddingFingerprint"]["resolvedRevision"] == "embed-commit"
