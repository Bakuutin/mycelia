# Voice Identity: Sky-first pipeline, versioned diarization и historical backfill

## Цель

Надёжно определять для каждого активного diarization-сегмента `Sky / not Sky / uncertain`, показывать результат на Timeline и Transcript, поддерживать ручные исправления и поиск похожих голосов, а также безопасно строить и переключать новые поколения diarization.

Аудио/diarization-сегмент — единица истины. Transcript и Timeline являются проекциями. Word-level attribution не заявляется: word timestamps отсутствуют.

## Исходная база

- 27 258 legacy diarization-сегментов уже содержат 256-мерные embeddings.
- Legacy embeddings регистрируются как `legacy-v0` / `legacy-unknown`; версия модели задним числом не выдумывается.
- Старые auto matches маркируются `unverified`; ссылки на удалённые профили — `stale-profile`.
- VAD/STT не повторяются без подтверждённого gap. Первый backfill — identity matching по существующим embeddings.

## Контракты

### Versioned diarization

`diarization_runs` хранит `runId`, generation, range, mode, status (`building | ready | active | superseded | failed`), runtime fingerprint, `embeddingSpaceId`, coverage/errors, source job и timestamps.

Каждый `diarizations` документ хранит `runId`, `generation`, `embeddingSpaceId`, `lifecycleStatus`. Новое поколение строится рядом со старым. Activation сначала делает новый диапазон active, затем supersede старое перекрытие, поэтому Timeline не остаётся пустым. Partial activation сохраняет неперекрытую часть старого run active.

Операции resource `speaker-segments`:

- `create-run` / bounded `diarization(mode=build_generation)`;
- `compare-run`;
- `activate-run` (включая rollback на retained superseded run);
- `preview-purge`;
- `purge-superseded` с точной строкой подтверждения.

Active/building run удалить нельзя. Raw audio, chunks, VAD, STT и transcripts purge не затрагивает.

### Profiles, calibration и identity

Профиль хранит `embeddingSpaceId`, `revision`, `enrollmentProvenance`. `profileReenrollment` пересобирает Sky из всех сохранённых samples в одном runtime embedding space и атомарно повышает revision.

Validated calibration требует:

- отдельные calibration и validation recordings;
- не менее 100 labels, включая 40 Sky и 40 not-Sky;
- positive threshold с precision не ниже 98%;
- negative threshold строго ниже positive;
- явное решение о совместимости `legacy-unknown`.

`speakerIdentity` получает run/profile revision/calibration/range/limit/cursor. Для каждого eligible segment сохраняется `matched | rejected | uncertain`, score, thresholds, profile revision, embedding space, matcher/calibration/run provenance и timestamp. Cross-space matching запрещён. Manual projection сильнее автоматики. `matched_speaker` остаётся compatibility projection только для `matched`.

### Manual annotations и similarity

`speaker_annotations` хранит original audio, interval, source segment/run, profile либо excluded profiles, author и timestamps. Аннотация переносится на новые границы по overlap. UI не пишет identity напрямую в Mongo.

Similarity возвращает top-N только внутри одного `embeddingSpaceId`. Scope ручного применения: segment или тот же anonymous speaker в записи. Массовое применение требует явного действия пользователя.

## Operator workflow

1. Запустить локальный diarizator в общей сети Mycelia: `docker compose --profile diarization up -d --build diarizator`; проверить `/health` и fingerprint. `scripts/start-diarizator.sh` остаётся совместимой обёрткой над этой командой.
2. На `/settings/voice-identity` выполнить `Re-enroll Sky from saved samples`.
3. Собрать и проверить pilot 7–14 дней: Sky, not-Sky, mixed/borderline.
4. Сохранить validated calibration. До выполнения server-side gates full backfill заблокирован.
5. На `/audio/pipeline` выполнить `Classify existing` для pilot range.
6. Проверить uncertain queue, random auto-Sky и auto-not-Sky; исправления делать manual annotations.
7. Запустить idempotent full identity backfill диапазонами. После каждого диапазона проверять coverage, errors и distribution.
8. Если legacy validation не проходит — `Re-diarize range`, затем `Compare`, `Activate`.
9. Retain superseded generation до отдельного backup/restore check. Затем `Preview purge`, точное подтверждение и ручной purge.

## Что выполняется параллельно

- Reliability backend и health/playback frontend.
- Versioned run backend и UI на фиксированных schemas/fixtures.
- Identity worker/tests и Timeline/Transcript/review UI.
- Pilot processing и operator dashboard.
- После calibration исторические range jobs и UI QA.

Не распараллеливается причинная цепочка: `re-enroll Sky → calibration → thresholds → full identity backfill`.

## Timeline / Transcript

- Timeline speaker track: точные интервалы на близком масштабе; pixel buckets Sky/other/uncertain на дальнем.
- Click открывает segment detail с audio, `This is me`, `Not me`, `Other profile`, `Clear`.
- Transcript показывает все перекрывающиеся voice segments; фильтры state, profile и confidence.
- «С кем» — известные profiles и стабильные anonymous speaker labels в той же записи/окне. Физическая геолокация остаётся отдельным time join.

## Acceptance

- Migration не меняет массивы legacy embeddings и маркирует provenance unknown.
- Cross-space matching блокируется понятной ошибкой.
- Каждый eligible segment получает одно terminal tri-state решение; cursor continuation не повторяет unmatched.
- Manual annotations переживают backfill и re-diarization projection.
- Failed build не меняет active data; activation resume-safe и никогда не оставляет Timeline без active generation.
- Purge preview соответствует target run; active/building purge запрещён.
- Similarity не смешивает embedding spaces.
- Full backfill требует validated ≥98% auto-Sky precision calibration.
- Timeline и Transcript используют один active-segment resource и видят одинаковые manual overrides.

## Timeline реализации

| Этап | Результат |
|---|---|
| 1 | Health diarizator, profile-id attach, bounded jobs, stale-claim reaper, single playback |
| 2 | Legacy migration, runtime fingerprints, versioned runs, safe activation/purge |
| 3 | Tri-state identity, annotations, similarity, calibration gates, Sky re-enrollment |
| 4 | Audio Pipeline controls, review queue, Timeline/Transcript projections |
| 5 | Docker/migration verification, pilot calibration, historical backfill |

Код этапов 1–4 реализован. Этап 5 выполняется операторски на реальных данных: модель нельзя честно откалибровать или разрешить full backfill без размеченного validation set.
