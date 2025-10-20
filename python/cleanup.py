# %%
from datetime import datetime, timedelta

import pytz

from lib import call_resource
from lib.transcription import known_errors


# %%
end_date = datetime.now(pytz.UTC)
start_date = end_date - timedelta(days=3000)
error_patterns = list(known_errors)
    
pipeline = [
    {
        "$match": {
            "start": {
                "$gte": start_date,
                "$lt": end_date,
            }
        }
    },
    {
        "$addFields": {
            "cleanedSegments": {
                "$filter": {
                    "input": "$segments",
                    "as": "seg",
                    "cond": {
                        "$and": [
                            {
                                "$not": {
                                    "$in": [
                                        {"$trim": {"input": "$$seg.text"}},
                                        error_patterns
                                    ]
                                }
                            },
                            {
                                "$not": {
                                    "$regexMatch": {
                                        "input": {"$trim": {"input": "$$seg.text"}},
                                        "regex": r"^\*.*\*$"
                                    }
                                }
                            }
                        ]
                    }
                }
            },
            "originalSegmentCount": {"$size": "$segments"}
        }
    },
    {
        "$addFields": {
            "cleanedSegmentCount": {"$size": "$cleanedSegments"},
            "needsUpdate": {
                "$or": [
                    {"$ne": [{"$size": "$segments"}, {"$size": "$cleanedSegments"}]},
                    {"$eq": [{"$size": "$cleanedSegments"}, 0]}
                ]
            }
        }
    },
    {
        "$match": {
            "needsUpdate": True
        }
    },
    {
        "$project": {
            "_id": 1,
            "start": 1,
            "originalSegmentCount": 1,
            "cleanedSegmentCount": 1,
            "cleanedSegments": 1,
            # "needsUpdate": 1,
            "shouldDelete": {"$eq": ["$cleanedSegmentCount", 0]}
        }
    }
]

results = call_resource(
    "tech.mycelia.mongo",
    {
        "action": "aggregate",
        "collection": "transcriptions",
        "pipeline": pipeline,
    }
)

len(results)

#%%
from collections import Counter

def get_verdict(result: dict) -> str:
    if result["shouldDelete"]:
        return "delete"
    elif not result.get("needsUpdate", True):
        return "no action"

    return "update"

counter = Counter(get_verdict(result) for result in results)
counter.most_common()

#%%



bulk_operations = []
deleted_count = 0
updated_count = 0
total_segments_removed = 0

for result in results:
    if not result.get("needsUpdate", True):
        continue

    segments_removed = result["originalSegmentCount"] - result["cleanedSegmentCount"]
    total_segments_removed += segments_removed
    
    if result["shouldDelete"]:
        bulk_operations.append({
            "deleteOne": {
                "filter": {"_id": result["_id"]}
            }
        })
        deleted_count += 1
    else:
        bulk_operations.append({
            "updateOne": {
                "filter": {"_id": result["_id"]},
                "update": {"$set": {"segments": result["cleanedSegments"]}}
            }
        })
        updated_count += 1
#%%
print(f"  Total transcripts processed: {len(results)}")
print(f"  Deleted transcripts: {deleted_count}")
print(f"  Updated transcripts: {updated_count}")
print(f"  Total segments removed: {total_segments_removed}")

#%%

if bulk_operations:
    call_resource(
        "tech.mycelia.mongo",
        {
            "action": "bulkWrite",
            "collection": "transcriptions",
            "operations": bulk_operations,
            "options": {"ordered": False}
        }
    )


#%%

from bson import ObjectId
call_resource(
    "tech.mycelia.mongo",
    {
        "action": "findOne",
        "collection": "transcriptions",
        "query": {"_id": ObjectId("68ed0af5eafdc893101bbce9")},
    }
)
# %%
