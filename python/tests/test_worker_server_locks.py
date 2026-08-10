from worker_server import get_job_lock


def test_vad_requests_share_one_lock():
    assert get_job_lock("vad") is get_job_lock("vad")
    assert get_job_lock("vad") is not None


def test_unrelated_jobs_are_not_serialized_with_vad():
    assert get_job_lock("profileReenrollment") is None
