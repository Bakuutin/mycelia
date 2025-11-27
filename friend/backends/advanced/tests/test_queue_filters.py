from datetime import datetime, timedelta, timezone

from advanced_omi_backend.controllers.queue_controller import _job_in_date_range, _normalize_datetime


def test_job_in_date_range_respects_boundaries():
    base = datetime(2024, 5, 1, 12, 0, tzinfo=timezone.utc)
    start = base - timedelta(hours=1)
    end = base + timedelta(hours=1)

    normalized_base = _normalize_datetime(base)
    normalized_start = _normalize_datetime(start)
    normalized_end = _normalize_datetime(end)

    assert _job_in_date_range(normalized_base, normalized_start, normalized_end)
    assert not _job_in_date_range(normalized_base, normalized_end, None)
    assert not _job_in_date_range(normalized_base, None, normalized_start)
    assert not _job_in_date_range(None, normalized_start, normalized_end)


def test_normalize_datetime_converts_timezone_to_naive_utc():
    aware_time = datetime(2024, 5, 1, 8, 0, tzinfo=timezone(timedelta(hours=-4)))
    normalized = _normalize_datetime(aware_time)

    assert normalized.tzinfo is None
    assert normalized == datetime(2024, 5, 1, 12, 0)
