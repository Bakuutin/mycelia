#!/usr/bin/env python3

import os
import sys

from bson import ObjectId

from daemon import (
    clear_all_errors,
    clear_error,
    ingests_missing_sources,
    initialize_auth,
    list_errored_files,
)


def print_help():
    print("""
Mycelia Daemon Error Management

Commands:
  list                    List all errored files
  retry-all              Retry all errored sources without clearing failures
  retry <file_id> [replacement_path]
                          Retry the exact source, optionally reading audio from
                          a repaired copy while preserving the stored path
  clear-all              Clear all errors (without retrying)
  clear <file_id>        Clear error for specific file (without retrying)

Examples:
  uv run manage_errors.py list
  uv run manage_errors.py retry 68ee1a98a5ba09aadf9a8838
  uv run manage_errors.py retry 68ee1a98a5ba09aadf9a8838 ~/recovered.m4a
  uv run manage_errors.py retry-all
""")


def main():
    if len(sys.argv) < 2:
        print_help()
        sys.exit(1)

    command = sys.argv[1]
    initialize_auth()

    if command == "list":
        list_errored_files()

    elif command == "retry-all":
        print("Retrying all sources with cached ingestion errors...")
        ingests_missing_sources(
            limit=None,
            retry_errors=True,
            only_errors=True,
        )

    elif command == "retry" and len(sys.argv) > 2:
        file_id = ObjectId(sys.argv[2])
        replacement_path = (
            os.path.abspath(os.path.expanduser(sys.argv[3]))
            if len(sys.argv) > 3
            else None
        )
        if replacement_path and not os.path.isfile(replacement_path):
            print(f"Replacement audio file does not exist: {replacement_path}")
            sys.exit(1)
        print(f"Retrying ingestion for {file_id}...")
        # Keep the cached error until this exact source succeeds. Previously
        # the command cleared the selected error and then processed whichever
        # pending source sorted first, so it could silently retry another file.
        ingests_missing_sources(
            limit=1,
            retry_errors=True,
            source_ids=[file_id],
            source_path_overrides=(
                {str(file_id): replacement_path}
                if replacement_path
                else None
            ),
        )

    elif command == "clear-all":
        count = clear_all_errors()
        print(f"Cleared {count} errors")

    elif command == "clear" and len(sys.argv) > 2:
        file_id = ObjectId(sys.argv[2])
        if clear_error(file_id):
            print(f"Cleared error for {file_id}")
        else:
            print(f"Failed to clear error for {file_id}")
            sys.exit(1)

    else:
        print(f"Unknown command: {command}")
        print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
