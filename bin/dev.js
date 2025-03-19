#!/usr/bin/env -S node --loader ts-node/esm --disable-warning=ExperimentalWarning

import {execute} from '@oclif/core'
import path from 'path'

await execute({dir: path.dirname(import.meta.dirname)})
