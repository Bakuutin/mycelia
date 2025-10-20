#!/bin/bash

set -e
docker build ./backend -t hub.tigor.net/mycelia/ui:latest
