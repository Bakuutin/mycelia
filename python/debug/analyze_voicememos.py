#!/usr/bin/env python3
"""
Analyze Apple Voice Memos CloudRecordings.db database.
Shows all metadata fields and provides statistics about recordings.
"""
import sqlite3
import os
from datetime import datetime, timedelta
from collections import defaultdict

# Apple's reference date: January 1, 2001 00:00:00 UTC
APPLE_REFERENCE_DATE = 978307200

DB_PATH = os.path.expanduser(
    "~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings/CloudRecordings.db"
)


def apple_to_datetime(apple_timestamp):
    """Convert Apple timestamp to datetime."""
    if apple_timestamp is None:
        return None
    return datetime.fromtimestamp(APPLE_REFERENCE_DATE + apple_timestamp)


def format_duration(seconds):
    """Format duration in human-readable format."""
    if seconds is None:
        return "N/A"
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    if hours > 0:
        return f"{hours}h {minutes}m {secs}s"
    elif minutes > 0:
        return f"{minutes}m {secs}s"
    else:
        return f"{secs}s"


def analyze_database():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    print("=" * 80)
    print("APPLE VOICE MEMOS DATABASE ANALYSIS")
    print("=" * 80)

    # 1. Database Schema Overview
    print("\n" + "=" * 80)
    print("1. DATABASE SCHEMA")
    print("=" * 80)

    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
    tables = cursor.fetchall()
    print(f"\nTables found: {len(tables)}")
    for table in tables:
        print(f"  - {table[0]}")

    # 2. ZCLOUDRECORDING Table Structure (Main recordings table)
    print("\n" + "=" * 80)
    print("2. ZCLOUDRECORDING TABLE STRUCTURE (Main Recordings)")
    print("=" * 80)

    cursor.execute("PRAGMA table_info(ZCLOUDRECORDING)")
    columns = cursor.fetchall()
    print("\n{:<5} {:<30} {:<12} {:<10}".format("ID", "Column Name", "Type", "Nullable"))
    print("-" * 60)
    for col in columns:
        print("{:<5} {:<30} {:<12} {:<10}".format(
            col['cid'], col['name'], col['type'] or 'ANY', 'Yes' if not col['notnull'] else 'No'
        ))

    # 3. Column meanings explanation
    print("\n" + "-" * 60)
    print("COLUMN MEANINGS:")
    print("-" * 60)
    column_meanings = {
        "Z_PK": "Primary key (internal ID)",
        "Z_ENT": "Entity type ID (CoreData internal)",
        "Z_OPT": "Optimistic locking counter (CoreData internal)",
        "ZFLAGS": "Status/sync flags (bitmask: 4=synced, 0=cloud-only, 516/1540/etc=various states)",
        "ZSHAREDFLAGS": "Sharing flags",
        "ZFOLDER": "Foreign key to ZFOLDER table (folder organization)",
        "ZDATE": "Recording start timestamp (Apple epoch: seconds since Jan 1, 2001)",
        "ZDURATION": "Total duration in seconds (cloud value)",
        "ZEVICTIONDATE": "When local copy was evicted/deleted to free space",
        "ZLOCALDURATION": "Local file duration (0 if file not downloaded)",
        "ZCUSTOMLABEL": "User-assigned label/name (or ISO timestamp if auto-named)",
        "ZCUSTOMLABELFORSORTING": "Sorting version of custom label",
        "ZENCRYPTEDTITLE": "Display title (often same as ZCUSTOMLABEL)",
        "ZPATH": "Local filename (e.g., '20231110 224128-7F90F196.m4a')",
        "ZUNIQUEID": "UUID identifier for the recording",
        "ZAUDIODIGEST": "Audio content hash (BLOB)",
        "ZAUDIOFUTURE": "Future/placeholder audio data (BLOB)",
        "ZAUDIOFUTUREUUIDS": "UUIDs for audio futures (BLOB)",
        "ZPLAYBACKPOSITION": "Last playback position in seconds",
        "ZMTAUDIOFUTURE": "Multi-track audio future (BLOB)",
        "ZMTLAYERMIX": "Multi-track layer mix value",
        "ZSILENCEREMOVERENABLED": "Whether silence removal is enabled (0/1)",
        "ZPLAYBACKRATE": "Playback speed (1.0 = normal)",
    }
    for col, meaning in column_meanings.items():
        print(f"  {col}: {meaning}")

    # 4. ZFOLDER Table Analysis
    print("\n" + "=" * 80)
    print("3. FOLDERS (ZFOLDER TABLE)")
    print("=" * 80)

    cursor.execute("""
        SELECT f.Z_PK, f.ZENCRYPTEDNAME, f.ZCOUNTOFRECORDINGS, f.ZRANK, f.ZUUID
        FROM ZFOLDER f
        ORDER BY f.ZRANK
    """)
    folders = cursor.fetchall()

    print("\n{:<5} {:<25} {:<15} {:<8} {:<40}".format("ID", "Name", "Recordings", "Rank", "UUID"))
    print("-" * 100)
    folder_map = {}
    for f in folders:
        folder_map[f['Z_PK']] = f['ZENCRYPTEDNAME']
        print("{:<5} {:<25} {:<15} {:<8} {:<40}".format(
            f['Z_PK'],
            (f['ZENCRYPTEDNAME'] or 'Unfiled')[:24],
            f['ZCOUNTOFRECORDINGS'] or 0,
            f['ZRANK'] or 0,
            f['ZUUID'] or 'N/A'
        ))

    # 5. Recording Statistics
    print("\n" + "=" * 80)
    print("4. RECORDING STATISTICS")
    print("=" * 80)

    cursor.execute("SELECT COUNT(*) FROM ZCLOUDRECORDING")
    total_recordings = cursor.fetchone()[0]

    cursor.execute("SELECT SUM(ZDURATION) FROM ZCLOUDRECORDING")
    total_duration = cursor.fetchone()[0] or 0

    cursor.execute("SELECT AVG(ZDURATION) FROM ZCLOUDRECORDING")
    avg_duration = cursor.fetchone()[0] or 0

    cursor.execute("SELECT MIN(ZDURATION), MAX(ZDURATION) FROM ZCLOUDRECORDING")
    min_max = cursor.fetchone()

    cursor.execute("SELECT MIN(ZDATE), MAX(ZDATE) FROM ZCLOUDRECORDING")
    date_range = cursor.fetchone()

    print(f"\nTotal recordings: {total_recordings}")
    print(f"Total duration: {format_duration(total_duration)} ({total_duration/3600:.1f} hours)")
    print(f"Average duration: {format_duration(avg_duration)}")
    print(f"Shortest recording: {format_duration(min_max[0])}")
    print(f"Longest recording: {format_duration(min_max[1])}")
    print(f"Date range: {apple_to_datetime(date_range[0])} to {apple_to_datetime(date_range[1])}")

    # 6. Local vs Cloud-only recordings
    print("\n" + "-" * 60)
    print("LOCAL vs CLOUD-ONLY:")
    print("-" * 60)

    cursor.execute("""
        SELECT
            CASE WHEN ZPATH IS NULL OR ZPATH = '' THEN 'Cloud-only' ELSE 'Local file exists' END as status,
            COUNT(*) as count,
            SUM(ZDURATION)/3600.0 as hours
        FROM ZCLOUDRECORDING
        GROUP BY status
    """)
    for row in cursor.fetchall():
        print(f"  {row[0]}: {row[1]} recordings ({row[2]:.1f} hours)")

    # 7. Flags analysis
    print("\n" + "-" * 60)
    print("FLAGS DISTRIBUTION:")
    print("-" * 60)

    cursor.execute("""
        SELECT ZFLAGS, COUNT(*) as count
        FROM ZCLOUDRECORDING
        GROUP BY ZFLAGS
        ORDER BY count DESC
    """)
    flag_meanings = {
        0: "Cloud-only (not downloaded)",
        4: "Synced (standard)",
        12: "Synced + additional flag",
        516: "Special state (editing/multi-track?)",
        1540: "Special state",
        1548: "Special state",
    }
    for row in cursor.fetchall():
        meaning = flag_meanings.get(row[0], "Unknown")
        print(f"  Flag {row[0]:>4}: {row[1]:>4} recordings - {meaning}")

    # 8. Yearly breakdown
    print("\n" + "-" * 60)
    print("RECORDINGS BY YEAR:")
    print("-" * 60)

    cursor.execute("""
        SELECT
            strftime('%Y', datetime(ZDATE + 978307200, 'unixepoch')) as year,
            COUNT(*) as count,
            SUM(ZDURATION)/3600.0 as hours
        FROM ZCLOUDRECORDING
        GROUP BY year
        ORDER BY year
    """)
    for row in cursor.fetchall():
        print(f"  {row[0]}: {row[1]:>4} recordings ({row[2]:>6.1f} hours)")

    # 9. Recordings by folder
    print("\n" + "-" * 60)
    print("RECORDINGS BY FOLDER:")
    print("-" * 60)

    cursor.execute("""
        SELECT
            COALESCE(f.ZENCRYPTEDNAME, 'Unfiled') as folder_name,
            COUNT(r.Z_PK) as count,
            SUM(r.ZDURATION)/3600.0 as hours
        FROM ZCLOUDRECORDING r
        LEFT JOIN ZFOLDER f ON r.ZFOLDER = f.Z_PK
        GROUP BY folder_name
        ORDER BY count DESC
    """)
    for row in cursor.fetchall():
        print(f"  {row[0]:.<25} {row[1]:>4} recordings ({row[2]:>6.1f} hours)")

    # 10. Sample records
    print("\n" + "=" * 80)
    print("5. SAMPLE RECORDS (5 Most Recent)")
    print("=" * 80)

    cursor.execute("""
        SELECT * FROM ZCLOUDRECORDING
        ORDER BY ZDATE DESC
        LIMIT 5
    """)
    records = cursor.fetchall()

    for i, rec in enumerate(records, 1):
        print(f"\n--- Recording {i} ---")
        print(f"  ID: {rec['Z_PK']}")
        print(f"  Date: {apple_to_datetime(rec['ZDATE'])}")
        print(f"  Duration: {format_duration(rec['ZDURATION'])}")
        print(f"  Local Duration: {format_duration(rec['ZLOCALDURATION'])}")
        print(f"  Title: {rec['ZENCRYPTEDTITLE'] or rec['ZCUSTOMLABEL'] or 'N/A'}")
        print(f"  Path: {rec['ZPATH'] or '(cloud-only)'}")
        print(f"  UUID: {rec['ZUNIQUEID']}")
        print(f"  Folder: {folder_map.get(rec['ZFOLDER'], 'Unfiled')}")
        print(f"  Flags: {rec['ZFLAGS']}")
        print(f"  Playback Position: {format_duration(rec['ZPLAYBACKPOSITION'])}")
        print(f"  Playback Rate: {rec['ZPLAYBACKRATE']}x")

    # 11. Cloud-only recordings (not downloaded)
    print("\n" + "=" * 80)
    print("6. CLOUD-ONLY RECORDINGS (Not Downloaded Locally)")
    print("=" * 80)

    cursor.execute("""
        SELECT Z_PK, ZDATE, ZDURATION, ZCUSTOMLABEL, ZENCRYPTEDTITLE, ZUNIQUEID
        FROM ZCLOUDRECORDING
        WHERE ZPATH IS NULL OR ZPATH = ''
        ORDER BY ZDATE DESC
        LIMIT 10
    """)
    cloud_only = cursor.fetchall()

    if cloud_only:
        print(f"\n(Showing up to 10 of cloud-only recordings)")
        for rec in cloud_only:
            print(f"  {apple_to_datetime(rec['ZDATE'])} | {format_duration(rec['ZDURATION']):>12} | {rec['ZCUSTOMLABEL'] or rec['ZENCRYPTEDTITLE'] or 'Untitled'}")
    else:
        print("\n  All recordings have local files!")

    # 12. Files in folder vs DB
    print("\n" + "=" * 80)
    print("7. LOCAL FILES vs DATABASE RECORDS")
    print("=" * 80)

    recordings_dir = os.path.dirname(DB_PATH)
    m4a_files = [f for f in os.listdir(recordings_dir) if f.endswith('.m4a')]

    cursor.execute("SELECT ZPATH FROM ZCLOUDRECORDING WHERE ZPATH IS NOT NULL AND ZPATH != ''")
    db_paths = set(row[0] for row in cursor.fetchall())

    files_in_folder = set(m4a_files)
    in_db_not_folder = db_paths - files_in_folder
    in_folder_not_db = files_in_folder - db_paths

    print(f"\n  .m4a files in folder: {len(files_in_folder)}")
    print(f"  Recordings with local path in DB: {len(db_paths)}")
    print(f"  In DB but missing from folder: {len(in_db_not_folder)}")
    print(f"  In folder but not in DB: {len(in_folder_not_db)}")

    if in_folder_not_db:
        print(f"\n  Files not tracked in DB (first 5):")
        for f in sorted(in_folder_not_db)[:5]:
            print(f"    - {f}")

    # 13. Other tables summary
    print("\n" + "=" * 80)
    print("8. OTHER RELEVANT TABLES")
    print("=" * 80)

    cursor.execute("SELECT COUNT(*) FROM ZRECORDING")
    legacy_count = cursor.fetchone()[0]
    print(f"\n  ZRECORDING (legacy table): {legacy_count} records")

    cursor.execute("SELECT COUNT(*) FROM ATRANSACTION")
    tx_count = cursor.fetchone()[0]
    print(f"  ATRANSACTION (sync transactions): {tx_count} records")

    cursor.execute("SELECT COUNT(*) FROM ANSCKRECORDMETADATA")
    ck_count = cursor.fetchone()[0]
    print(f"  ANSCKRECORDMETADATA (CloudKit metadata): {ck_count} records")

    conn.close()

    print("\n" + "=" * 80)
    print("ANALYSIS COMPLETE")
    print("=" * 80)


if __name__ == "__main__":
    analyze_database()
