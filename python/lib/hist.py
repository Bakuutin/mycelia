from datetime import timedelta, datetime
from typing import Literal

import pytz


Scale = Literal["5min", "1hour", "1day", "1week"]

SCALE_TO_RESOLUTION: dict[Scale, timedelta] = {
    "5min": timedelta(minutes=5),
    "1hour": timedelta(hours=1),
    "1day": timedelta(days=1),
    "1week": timedelta(weeks=1),
}

def date_to_bucket(date: datetime, scale: Scale) -> datetime:
    step = SCALE_TO_RESOLUTION[scale].total_seconds()
    return datetime.fromtimestamp((date.timestamp() // step) * step, tz=pytz.UTC)
