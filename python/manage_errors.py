#!/usr/bin/env python3

import sys
from daemon import list_errored_files, clear_error, clear_all_errors, ingests_missing_sources
from bson import ObjectId


def print_help():
    print("""
Mycelia Daemon Error Management

Commands:
  list                    List all errored files
  retry-all              Clear all errors and retry all files
  retry <file_id>        Clear error for specific file and retry it
  clear-all              Clear all errors (without retrying)
  clear <file_id>        Clear error for specific file (without retrying)

Examples:
  uv run manage_errors.py list
  uv run manage_errors.py retry 68ee1a98a5ba09aadf9a8838
  uv run manage_errors.py retry-all
""")


def main():
    if len(sys.argv) < 2:
        print_help()
        sys.exit(1)

    command = sys.argv[1]

    if command == "list":
        list_errored_files()

    elif command == "retry-all":
        count = clear_all_errors()
        print(f"Cleared {count} errors. Starting ingestion with retry_errors=True...")
        ingests_missing_sources(limit=None, retry_errors=True)

    elif command == "retry" and len(sys.argv) > 2:
        file_id = ObjectId(sys.argv[2])
        if clear_error(file_id):
            print(f"Cleared error for {file_id}. Retrying ingestion...")
            ingests_missing_sources(limit=1, retry_errors=False)
        else:
            print(f"Failed to clear error for {file_id}")
            sys.exit(1)

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
