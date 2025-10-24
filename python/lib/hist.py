from datetime import timedelta, datetime
from typing import Literal

import pytz
from .resources import call_resource
from pydantic import BaseModel

class Range(BaseModel):
    start: datetime | None
    end: datetime | None
    done: bool


Scale = Literal["5min", "1hour", "1day", "1week"]

SCALE_TO_RESOLUTION: dict[Scale, timedelta] = {
    "5min": timedelta(minutes=5),
    "1hour": timedelta(hours=1),
    "1day": timedelta(days=1),
    "1week": timedelta(weeks=1),
}

LARGEST_SCALE = "1week"
SMALLEST_SCALE = "5min"

def date_to_bucket(date: datetime, scale: Scale) -> datetime:
    step = SCALE_TO_RESOLUTION[scale].total_seconds()
    return datetime.fromtimestamp((date.timestamp() // step) * step, tz=pytz.UTC)


def ensure_buckets_exist(start: datetime, end: datetime, scale: Scale):
    step = SCALE_TO_RESOLUTION[scale].total_seconds()

    call_resource(
        "tech.mycelia.mongo",
        {
            "action": "bulkWrite",
            "collection": f"histogram_{scale}",
            "operations": [
                {
                    "updateOne": {
                        "filter": {"start": datetime.fromtimestamp(bucket * step, tz=pytz.UTC)},
                        "update": {"$set": {"start": datetime.fromtimestamp(bucket * step, tz=pytz.UTC)}},
                        "upsert": True,
                    }
                }
                for bucket in range(
                    int(start.timestamp() // step) + 1,
                    int(end.timestamp() // step) - 1,
                )
            ]
        }
    )


def mark_buckets_as(
        status: Literal["done", "stale"],
        worker: str,
        start: datetime,
        end: datetime,
        *,
        scale: Scale = LARGEST_SCALE,
    ):

    delta = SCALE_TO_RESOLUTION[scale]
    
    ensure_buckets_exist(start, end, scale)

    if status == "stale":
        start -= delta
        end += delta

    now = datetime.now(tz=pytz.UTC)
    now_bucket = date_to_bucket(now, scale)
    
    query = {"start": {"$gte": start, "$lte": end - delta}}
    
    if status == "done":
        query["start"]["$lt"] = now_bucket

    call_resource(
        "tech.mycelia.mongo",
        {
            "action": "updateMany",
            "collection": f"histogram_{scale}",
            "query": query,
            "update": {"$set": {f"{worker}.status": status, "updated_at": datetime.now(tz=pytz.UTC) }},
        }
    )


def get_next(worker: str, scale: Scale, cursor: datetime | None, sort: Literal[1, -1], *, done: bool) -> dict | None:
    query = {
        f"{worker}.status": "done" if done else {"$ne": "done"},
    }
    if cursor is not None:
        if sort == 1:
            query["start"] = {"$gt": cursor}
        else:
            query["start"] = {"$lt": cursor}

    return call_resource(
        "tech.mycelia.mongo",
        {
            "action": "findOne",
            "collection": f"histogram_{scale}",
            "query": query,
            "options": {
                "sort": {"start": sort},
            },
        }
    )



def move_forward(
    worker: str, scale: Scale,
    cursor: datetime | None = None,
    *,
    done: bool,
) -> dict | None:
    return get_next(worker, scale, cursor, 1, done=done)


def move_backward(
    worker: str, scale: Scale,
    cursor: datetime | None = None,
    *,
    done: bool,
) -> dict | None:
    return get_next(worker, scale, cursor, -1, done=done)

def get_ranges(worker: str, scale: Scale, *, start: datetime | None = None, end: datetime | None = None) -> list[Range]:
    intervals = []
    cursor: datetime | None = start
    done: bool = False
    delta = SCALE_TO_RESOLUTION[scale]
    while True:
        n = move_forward(worker, scale, cursor, done=not done)
        if not n:
            if done:
                last_done = move_backward(worker, scale, end, done=True)
                intervals.append(
                    Range(
                        start=cursor,
                        end=last_done["start"] + delta,
                        done=True,
                    )
                )
                cursor = last_done["start"] + delta
            intervals.append(Range(
                start=cursor,
                end=None,
                done=False,
            ))
            break
        


        intervals.append(Range(
            start=cursor,
            end=n["start"],
            done=done,
        ))

        cursor = n["start"]
        done = not done

        if end and cursor >= end:
            break
    return intervals
