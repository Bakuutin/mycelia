from simple_speaker_recognition.provenance import build_runtime_fingerprint


def test_embedding_space_changes_when_preprocessing_changes() -> None:
    first = build_runtime_fingerprint(
        diarization_model="diar-v1", embedding_model="embed-v1",
        sample_rate=16000, embedding_dimension=256, preprocessing="soundfile-v1",
    )
    second = build_runtime_fingerprint(
        diarization_model="diar-v1", embedding_model="embed-v1",
        sample_rate=8000, embedding_dimension=256, preprocessing="soundfile-v1",
    )
    assert first["embeddingSpaceId"] != second["embeddingSpaceId"]
    assert first["diarizationFingerprint"]["resolvedRevision"] == "unknown"
