# Diarization and Voice Identity Runbook

Операторская инструкция для полного speaker pipeline Mycelia: запуск сервиса
диаризации на Mac или NVIDIA-сервере, настройка маршрутов, заполнение истории,
создание voice profiles, калибровка Sky и identity backfill.

Низкоуровневое API и устройство image описаны в
[`diarizator/README.md`](../diarizator/README.md).

## Как устроен pipeline

```text
audio
  -> VAD: где есть речь
  -> STT: что сказано
  -> diarization: интервалы спикеров + anonymous labels + embeddings
  -> enrollment: эталонный embedding известного профиля
  -> calibration: проверенные thresholds для профиля и embedding space
  -> speakerIdentity: identified / unknown / uncertain
  -> Timeline и Transcript
```

- Diarization отвечает «когда меняется говорящий», но сама по себе не знает его
  имя.
- `speakerIdentity` сравнивает уже сохранённые embeddings. Он не перезапускает
  VAD, STT или diarization.
- Ручная annotation имеет приоритет над automatic identity.
- Timeline и Transcript — проекции активных segments, а не источник истины.
- Для новых backfill используется `speakerIdentity`, не legacy
  `speakerMatching`.

## Правильный порядок запуска

1. Запустить Mycelia и применить migrations.
2. Запустить локальный CPU diarizator или GPU-сервис на сервере.
3. Добавить route в Mycelia и получить статус **Running**.
4. Дождаться automatic `Diarize missing` или запустить bounded campaign вручную.
5. Создать/обновить профиль Sky и выполнить re-enrollment.
6. Разметить разнообразные Sky/not-Sky segments.
7. Провести calibration на отдельных recordings.
8. Запустить `Classify existing` сначала на 24 часа.
9. Проверить результаты, затем расширить pilot до 7 дней.
10. Запускать исторический identity backfill диапазонами.
11. Re-diarization делать только для несовместимого или отсутствующего покрытия.
12. Новую generation сначала сравнить, затем активировать; старую сохранить для
    rollback.

Не запускайте full identity backfill до calibration. Не запускайте purge как
часть обычной обработки.

## 1. Запуск Mycelia

### Режимы runtime

Для стабильной unattended работы в корневом `.env`:

```dotenv
APP_MODE=prod
```

Для разработки с live reload:

```dotenv
APP_MODE=dev
```

После изменения режима или `.env` пересоздайте application services:

```bash
docker compose up -d --build --force-recreate frontend backend python-worker
docker compose restart nginx
docker compose ps
curl -fkSs https://localhost:4433/readiness
```

В dev ожидаются `"mode":"dev"` и `"reload":"watch"`. Изменения исходников
перезагружаются автоматически; изменения `.env`, Compose, Dockerfile и
dependencies требуют recreate. Не перезапускайте MongoDB и Redis ради reload
кода.

### Migrations

```bash
docker compose exec backend deno run -A server.ts migrate-status
docker compose exec backend deno run -A server.ts migrate-up
```

Voice pipeline использует `diarization_runs`, `diarization_campaigns`,
`speaker_annotations`, `speaker_calibrations` и observability/review indexes.

## 2. Hugging Face models

Аккаунт токена должен принять условия обеих моделей:

- `pyannote/speaker-diarization-community-1`;
- `pyannote/wespeaker-voxceleb-resnet34-LM`.

Токен передаётся напрямую в model loader. `huggingface-cli login` внутри
контейнера не требуется. Не коммитьте `.env` и не выводите токен в логах.

## 3. Локальный Mac: CPU diarizator

Для основного Compose положите настройки в **корневой** `.env`:

```dotenv
HF_TOKEN=hf_replace_me
DIARIZATION_SERVER_URL=http://diarizator:8085
```

Запуск:

```bash
docker compose --profile diarization up -d --build diarizator
docker compose --profile diarization logs -f diarizator
```

Дождитесь `Models ready ... device=cpu`, затем:

```bash
docker compose --profile diarization ps diarizator
curl -fsS http://localhost:8085/health | jq
```

Ответ должен содержать `status=ok`, `ready=true`, `device=cpu`, fingerprint и
`embeddingSpaceId`.

Автоматическое live/retroactive-сопоставление допускается только при точном
совпадении `embeddingSpaceId` сегмента и voice profile. Маршрут или сегмент без
точного provenance пропускается. Новые `matched_speaker` сохраняют
использованные `profile_revision` и `embedding_space_id`; старым совпадениям эти
значения ретроспективно не приписываются, потому что это не доказывает исходную
revision. Такие совпадения являются лишь некалиброванными кандидатами.
Проверенной идентификацией считается совместимое решение `speakerIdentity`,
созданное по валидной calibration; ручные назначения спикеров остаются
авторитетными.

На Apple Silicon Docker не даёт этому CUDA/PyTorch сервису Apple GPU.
Используйте CPU image и выделите Docker Desktop минимум 10 GB, лучше 12 GB RAM.

Standalone-вариант для разработки:

```bash
cd diarizator
docker compose -p mycelia-diarization-local --profile cpu up -d --build
```

Этот Compose читает `diarizator/.env`. Основной Compose читает корневой `.env`.
Для обычного локального запуска предпочтителен основной профиль: внутри сети
Mycelia доступен стабильный адрес `http://diarizator:8085`.

## 4. Сервер с RTX 4090

### Preflight

```bash
nvidia-smi
docker compose version
docker run --rm --gpus all nvidia/cuda:12.6.3-base-ubuntu24.04 nvidia-smi
```

На сервере создайте `diarizator/.env`:

```dotenv
HF_TOKEN=hf_replace_me
COMPUTE_MODE=gpu
PYTORCH_CUDA_VERSION=cu126
SPEAKER_SERVICE_HOST=0.0.0.0
SPEAKER_SERVICE_PORT=8085
AUDIO_BACKEND=soundfile
DIARIZATION_MODEL=pyannote/speaker-diarization-community-1
```

### Сборка из checkout на сервере

```bash
cd /path/to/mycelia/diarizator
docker compose -p mycelia-diarization --profile gpu up -d --build diarization-service-gpu
docker compose -p mycelia-diarization --profile gpu logs -f diarization-service-gpu
```

Проверка GPU внутри контейнера:

```bash
docker compose -p mycelia-diarization --profile gpu exec diarization-service-gpu \
  uv run --no-sync --extra cu126 --no-dev python -c \
  'import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))'
```

Ожидаются `True` и название доступного NVIDIA GPU.

### Сборка amd64 image на ARM Mac

Используйте этот вариант, если сервер/Portainer не может стабильно собирать
image или обращаться к registry:

```bash
docker buildx build \
  --platform linux/amd64 \
  --build-arg PYTORCH_CUDA_VERSION=cu126 \
  -t mycelia-diarization:cu126 \
  --load ./diarizator

docker image inspect mycelia-diarization:cu126 \
  --format 'os={{.Os}} arch={{.Architecture}}'

docker run --rm --platform linux/amd64 \
  mycelia-diarization:cu126 \
  uv run --no-sync --extra cu126 --no-dev python -c \
  'import simple_speaker_recognition.core; print("import ok")'
```

Ожидаемая архитектура — `linux/amd64`. Отсутствие CUDA на Mac нормально; GPU
проверяется на сервере.

Перенос image:

```bash
docker save mycelia-diarization:cu126 | gzip > /tmp/mycelia-diarization.tar.gz
rsync -ah --partial --info=progress2 \
  /tmp/mycelia-diarization.tar.gz SERVER:/tmp/
ssh SERVER 'gzip -dc /tmp/mycelia-diarization.tar.gz | sudo docker load'
```

Для Portainer используйте image `mycelia-diarization:cu126`, persistent volume
`/models`, NVIDIA reservation и команду без runtime dependency sync:

```yaml
services:
  diarization:
    image: mycelia-diarization:cu126
    command: [
      uv,
      run,
      --no-sync,
      --extra,
      cu126,
      --no-dev,
      simple-speaker-service,
    ]
    environment:
      HF_TOKEN: ${HF_TOKEN}
      HF_HOME: /models
      COMPUTE_MODE: gpu
      PYTORCH_CUDA_VERSION: cu126
      AUDIO_BACKEND: soundfile
      SPEAKER_SERVICE_HOST: 0.0.0.0
      SPEAKER_SERVICE_PORT: 8085
    volumes:
      - diarization-models:/models
    ports:
      - "8085:8085"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    restart: unless-stopped

volumes:
  diarization-models:
```

Порт 8085 не имеет application authentication. Оставляйте его за
Tailscale/VPN/firewall или authenticated reverse proxy, а не в публичном
интернете.

### Проверка реального inference

`/health=200` недостаточно: container может быть жив, а decoding/inference —
сломаны. Проверьте короткий WAV с речью:

```bash
curl -fsS http://SERVER_PRIVATE_IP:8085/health | jq

curl -fsS -X POST http://SERVER_PRIVATE_IP:8085/embed \
  -F file=@sample.wav | jq '{dimension, duration}'

curl -fsS -X POST http://SERVER_PRIVATE_IP:8085/diarize \
  -F file=@sample.wav | jq \
  '{segments: (.segments | length), speakers: .summary.num_speakers}'
```

`/health` должен показать `ready=true` и CUDA device, `/embed` — dimension 256,
`/diarize` — ненулевое число segments.

## 5. Routing в Mycelia

Откройте:

- `https://localhost:4433/settings/diarization` — настройка routes;
- `https://localhost:4433/jobs` — health, priorities, workers и jobs.

Для remote route:

1. Нажмите **Add server**.
2. Укажите понятное имя, например `gpu-diarization`.
3. Укажите private base URL, например `http://100.x.x.x:8085`.
4. Включите route.
5. Поставьте preferred route наименьший числовой priority.
6. Сохраните, нажмите **Refresh health**.
7. Перед запуском campaign получите **Running**.

Новый job выбирает первый healthy enabled route по числовому priority и
сохраняет snapshot route. Изменение priority не переносит уже запущенный job.

Environment route берётся из корневого `.env`:

```dotenv
DIARIZATION_SERVER_URL=http://REMOTE_PRIVATE_IP:8085
```

После изменения пересоздайте оба consumer:

```bash
docker compose up -d --force-recreate backend python-worker
docker compose restart nginx
curl -fkSs https://localhost:4433/readiness
```

Дополнительные routes можно хранить в UI config. Environment route при этом
можно отключить, не меняя `.env`.

Выключение route сразу запрещает назначать на него новые jobs. Если на route уже
идёт batch, текущий HTTP request может закончиться, но перед следующей sequence
worker перечитает config и остановит batch без нового внешнего запроса. Сам
контейнер или remote server route-toggle не останавливает.

## 6. Diarization campaigns

### Automatic mode

Worker реагирует на speech chunk, когда:

- `vad.has_speech=true`;
- отсутствует `diarized_at`;
- chunk не занят и не помечен `needs_attention`.

Для новых данных создаётся live campaign конкретной записи. Watchdog каждые 300
секунд возобновляет разорванную historical missing-chain. Обычно continuation
создаётся сразу через `hasMore`, не по watchdog.

В **Jobs → Diarization** есть два независимых переключателя:

- worker enabled/paused управляет всей очередью diarization;
- live trigger управляет только созданием jobs при переходе `vad.has_speech` в
  `true`.

Если live-обработка сейчас не нужна, выключите live trigger. Historical watchdog
и ручные campaigns при этом остаются доступны. Чтобы временно запретить все
внешние diarization-вызовы, выключите routes: текущий request может закончиться,
но batch остановится перед следующим. Для полного прекращения запуска и
исполнения jobs поставьте worker на pause.

По умолчанию job обрабатывает 4 speech sequences; одна sequence содержит до 6
chunks на inference request. Diarization concurrency — 1. На **Jobs** worker
должен быть enabled. Его toggle управляет новыми jobs, но не remote process.

### Manual `Diarize missing`

На **Jobs** нажмите play у diarization worker. Доступны 24 часа, 7/14/30 дней,
custom range и batch size.

`Diarize missing`:

- ищет только speech chunks без diarization;
- не пересчитывает готовые segments;
- работает resumable и idempotent;
- является стандартным способом заполнения backlog.

Не создавайте overlapping campaigns. Если диалог находит существующую — откройте
её progress.

Campaign объединяет continuation jobs и показывает fixed range,
processed/total/pending chunks, batch, sequences, segments, route, rate, ETA и
structured errors. `Counting` и ранний `Estimating` нормальны; ETA становится
полезнее после двух успешных batches.

В **Audio Pipeline → Speaker diarization** показывается live snapshot текущей
глобальной `missing` campaign: processed/total/pending chunks, ETA, sequences,
segments, BullMQ queue и текущие enabled/healthy slots. Блок обновляется каждые
5 секунд, пока tab видим, и не запускает exact corpus scans. Количество routes и
slots читается из Settings, поэтому оно меняется автоматически.

Кнопка **Jobs → External services & routing → First 8 on** включает diarization
routes по порядку списка в пределах общего лимита 8 slots. Routes, которые не
помещаются в лимит, остаются выключенными; карточка показывает фактическое
количество enabled/total. Этот же максимум применяется к provider capacity и
BullMQ worker concurrency.

`Rolling speed (≤5 min)` объединяет активные и недавно завершённые tasks в одном
общем временном окне. Завершённые `diarization_campaign_rate_samples` обрезаются
по границе окна; активная task добавляет оценку chunks только за ту часть окна,
в которой она работала. Сумма делится на общую длительность окна, поэтому
ротация bounded continuation jobs не обнуляет скорость, а паузы честно её
уменьшают. ETA обновляется вместе с live snapshot каждые 5 секунд. Пока нет ни
live progress, ни samples, UI явно показывает `legacy single-lane estimate`, а
не выдаёт rate одного worker за общий throughput.

В активном job остаётся только bounded работа конкретного процесса. **This
batch** показывает sequences относительно верхнего лимита job и обработанные им
chunks, а **This worker** — end-to-end скорость этого job на закреплённом route.
После завершения эта итоговая worker speed сохраняется в result и остаётся
видимой в Jobs и Job Details; для старых jobs без сохранённого rate UI выводит
оценку по обработанным chunks и длительности job.

Отмена одного job не удаляет уже записанные segments. Но `hasMore`-chain или
watchdog могут продолжить ту же campaign: cancel job не означает stop campaign.
Для короткого теста выберите непересекающийся bounded range и дождитесь
свободного worker slot. Если нужно остановить всю обработку, поставьте worker на
pause; уже сохранённые результаты останутся целыми.

Ошибка одной sequence не отменяет успешные. `Will retry automatically` не
требует ручного действия. `Action required` означает исчерпанный retry budget:
исправьте причину и повторите только проблемную sequence.

## 7. Versioned re-diarization

`Re-diarize range` — не то же самое, что `Diarize missing`. Используйте его
только если:

- отсутствует корректное coverage;
- legacy embedding space несовместим с профилем;
- меняется diarization/embedding model или preprocessing;
- нужно сравнить поколения.

Он строит данные рядом со старыми и не меняет Timeline до activation:

```text
building -> ready -> active -> superseded
                    |             |
                    +-- rollback -+

building/interrupted -> failed
```

Порядок:

1. Выбрать bounded range в **Settings → Voice Identity → Operations &
   generations**.
2. Нажать **Re-diarize range**.
3. Дождаться generation campaign или разобрать errors.
4. Для `interrupted` resume допустим только при idempotent writes; иначе **Mark
   failed** и новая чистая generation.
5. Нажать **Compare**, проверить coverage, segments/minute, errors, fingerprint,
   embedding space и identity distribution.
6. После QA нажать **Activate**.
7. Сохранить superseded generation для rollback.

Нельзя purge `building` или `active` run. Перед первым purge сделайте Mongo
backup и проверьте restore. Затем **Preview purge**, сверка точного run/count и
ручное подтверждение. Raw audio, VAD, STT и transcripts purge не затрагивает.

## 8. Voice profiles и enrollment

Откройте `https://localhost:4433/settings/voice-profiles`.

В UI есть два связанных, но намеренно разных типа данных:

- **speaker label / annotation** отвечает «кто говорил в этом интервале» и сразу
  имеет приоритет на Timeline и в Transcript;
- **saved voice sample** — сохранённое чистое аудио, из которого enrollment
  строит embedding профиля для автоматического поиска похожего голоса.

Один и тот же Timeline-интервал можно сначала назначить профилю как label, а
затем сохранить как voice sample, но не каждая разметка годится для enrollment.
Короткие обрывки, overlap, шум и мычание можно размечать для Timeline, но не
следует добавлять в эталонный набор профиля.

Для Sky:

1. Создайте или выберите primary profile (`My Voice`).
2. Запишите/загрузите несколько чистых samples.
3. Прикрепите samples к Sky и проверьте карточки внутри профиля.
4. В **Review & calibration** нажмите **Re-enroll Sky from saved samples**.
5. Проследите `profileReenrollment` job на **Jobs**.
6. Проверьте новую revision и текущий `embeddingSpaceId`.

Лучше несколько разных 10–30-секундных samples, чем один длинный: разные
комнаты, микрофоны и манера речи. Избегайте второго говорящего, музыки и
overlap.

### Sample из Timeline

1. На Timeline выберите 3–120 секунд с одним спикером; лучше 10–30 секунд.
2. Нажмите **Voice sample**.
3. Выберите существующий профиль или **New speaker** и введите имя.
4. Нажмите **Save and rebuild profile** либо **Create speaker and save sample**.
5. Проследите enrollment job.

Source interval сохраняется вместе с sample. Другие профили добавляются тем же
способом, но каждому нужна своя calibration в совместимом embedding space.

Сохранение audio и постановка enrollment job — два отдельных подтверждаемых
шага. Если все diarizator slots заняты, UI явно показывает, что sample уже
сохранён и привязан к профилю, и предлагает **Retry profile update** без
повторной загрузки или дубликата. После закрытия диалога тот же rebuild можно
поставить через **Profiles & samples → Rebuild**; он использует все сохранённые
samples этого профиля.

Профиль без sample можно создать через **Voice Profiles → Add Profile → Create
profile only**. Он уже доступен для ручных назначений, но automatic matching
начинается только после добавления чистого sample и успешного enrollment.

## 9. Review и calibration Sky

Откройте `https://localhost:4433/settings/voice-identity`.

Review queue содержит активные unclassified/uncertain segments:

- **This is me** — positive Sky annotation;
- **Not me** — Sky явно исключён;
- **Assign profile** — сегмент сразу назначается существующему другому спикеру;
- последний назначенный профиль остаётся выбранным для следующего segment, а
  недавно использованные профили поднимаются вверх общего списка;
- **New speaker** — создаёт другой профиль из embedding выбранного сегмента или
  безопасной группы и сразу назначает ему разметку; такой seed не считается
  сохранённым voice sample;
- undo удаляет последнее ручное решение;
- **Skip** сохраняется как отдельное review-решение и оставляет segment вне
  training/calibration;
- autoplay и shortcuts двигают очередь;
- playback всегда координируется как один активный clip; видимый playhead и
  elapsed time сбрасываются при переходе к следующему segment;
- review session, небольшое окно из 5/10/20 segments и текущая позиция
  сохраняются на backend, поэтому работу можно продолжить позже;
- default 10-item window автоматически сменяется следующим после разметки всех
  элементов; toggle **Rolling** разрешает оставить переход ручным;
- завершение неполной session безопасно: уже сохранённые labels учитываются
  сразу, а unanswered segments могут попасть в следующую session;
- compact list показывает все элементы текущего небольшого окна;
- **Edit** доступен и для speaker label, и для Skip: старую метку можно заменить
  другим профилем или шумом;
- **Reviewed history** показывает последние решения из всех сохранённых окон и
  сессий. `Listen / edit` повторно открывает audio, а Timeline даёт временной
  контекст;
- соседние короткие segments одного anonymous speaker можно объединить в
  playback group и разметить одним подтверждённым batch.

Не размечайте как Sky всё, где слышен хотя бы фрагмент вашего голоса:

- чистая одноголосая речь Sky → **This is me**;
- чистая речь другого человека → **Not me**;
- обрывок короче секунды, мычание без достаточного голосового материала,
  clipping, шум или непонятный кусок → **Skip**;
- одновременная речь двух людей/overlap → **Skip**, если нельзя уверенно
  выделить один голос;
- batch-label применяйте только когда каждый segment группы действительно имеет
  одну и ту же метку.

Минимальный набор:

- 40 Sky;
- 40 not-Sky;
- 100 labels всего;
- несколько recordings;
- разные комнаты/микрофоны и разные люди, но достаточно чистая одноголосая речь.

Не используйте 100 соседних коротких segments одной записи как validation.
Делите по source recording: calibration recordings выбирают thresholds, другие
validation recordings проверяют переносимость.

При создании review session выберите очередь:

- **Uncertain + unclassified** — основная разметка для обучения calibration;
- **Audit automatic matches** — проверка прежних auto-match кандидатов для
  выбранного профиля. Этот режим полезен после смены calibration и для поиска
  false positives.

Затем выберите источник и сначала нажмите **Preview source**:

- **All matching recordings** — весь совместимый диапазон;
- **Selected recordings** — сначала показывает найденные recordings, затем
  позволяет отфильтровать и отметить нужные;
- **Current Timeline range** — на Timeline выделите точный интервал и нажмите
  **Review voices**;
- **Specific diarization generation** — только одна активная generation в том же
  embedding space.

Preview показывает число подходящих segments и recordings, причины исключения
коротких/дублирующихся фрагментов и до пяти проигрываемых примеров. Создание
session использует именно зафиксированный preview scope: изменения периода,
recordings, run или embedding space требуют нового preview. Эти фильтры также
применяются ко всем следующим rolling-окнам, а не только к первому.

Рекомендуемый режим **Clear speech · ≥1s · deduplicate** исключает из новой
очереди sub-second fragments и почти полностью перекрывающиеся интервалы одной
записи/run. Из группы overlap-дубликатов сохраняется самый полный интервал, а UI
показывает число скрытых вариантов. **All fragments · diagnostic** оставляет
сырой legacy output для отладки. Старые сохранённые окна не переписываются:
используйте фильтр **Shorter than 1 second**, bulk Skip только для оставшихся
неразмеченных фрагментов и индивидуальный Edit для уже сохранённых ответов.

Каждое окно берёт примеры по кругу из разных source recordings, прежде чем
повторять ту же запись. Не создавайте новую сессию только ради смены окна:
оставшиеся кандидаты сохраняются в session buffer, а rolling-переход загружает
следующие 5/10/20 без потери позиции.

Рекомендуемая цель auto-Sky precision — 98%. Precision важнее recall:
сомнительные случаи должны остаться `uncertain`. Для проверки workflow можно
явно сохранить provisional calibration с целью 95% или 90%, но она разрешает
только bounded pilot длительностью не более 24 часов и не открывает full
historical backfill.

### Calibration wizard

UI позволяет выбрать требуемую precision: 98% для production, готовые 95%/90%
для provisional pilot или custom значение 90–100% с шагом 0,5%. Это policy
precision, а не сырой cosine threshold и не подмена результата: backend:

1. Берёт latest manual annotation каждого segment.
2. Исключает embeddings из несовместимого space.
3. Считает cosine scores против текущей revision профиля.
4. Делит source recordings на непересекающиеся **Fit** и **Check** sets.
5. Подбирает positive threshold и, когда Fit data это подтверждает, conservative
   negative threshold.
6. Измеряет precision/coverage на ранее не виденном Check audio.
7. Разрешает сохранение только при минимум 40 Sky, 40 not-Sky, 100 совместимых
   labels и Check precision не ниже выбранной цели.

Для production raw cosine thresholds всегда автоматически вычисляет сервер; UI
не принимает вручную заданные production-пороги. Единственное исключение — явный
provisional pilot: сначала сервер всё равно вычисляет recommendation, а оператор
может только **повысить** positive threshold относительно неё и никогда не может
его понизить. Если безопасный negative threshold не найден, calibration получает
`negativeDecisionMode=uncertain_only`: auto not-Sky отключается, а все scores
ниже positive Sky threshold остаются `uncertain` для ручной проверки. UI
показывает **Auto not-Sky off · remains uncertain** вместо технического sentinel
`-1`. Это conservative Sky-first mode, а не failed calibration. Manual not-Sky
labels при этом сохраняются.

Для provisional pilot доступен **Advanced · stricter automatic Sky matching**.
Он позволяет только повысить positive cosine threshold относительно server
recommendation с шагом `0.005`; понизить порог UI и backend не разрешают.
Повышение обычно уменьшает число auto-Sky matches, coverage и recall, но может
улучшить precision. Preview сохраняет исходную рекомендацию отдельно, помечает
эффективный порог как `positiveThresholdSource=operator_stricter` и
пересчитывает Check metrics. **Use server recommendation** удаляет override.
Смена precision target или Fit/Check split также автоматически его сбрасывает.

Для production target ≥98% override недоступен: выбирать порог после просмотра
Check metrics означало бы подгонять модель по validation data. Operator-stricter
override поэтому остаётся только явно provisional evidence и не открывает full
backfill.

Для цели ниже 98% UI требует отдельное подтверждение риска, calibration получает
policy `pilot`, а Python worker независимо проверяет наличие start/end и
диапазон не более 24 часов. Поэтому прямой технический запуск job не обходит
ограничение.

Review работает как непрерывный stream. Внутренний buffer 5/10/20 нужен только
для preloading; с включённым **Continuous** следующий buffer загружается
автоматически, без отдельной кнопки завершения batch. Stream progress показывает
ответы в текущем сохранённом stream, а calibration progress объединяет пригодные
labels из всех streams. Завершённый stream не теряет ответы: **Continue
reviewing** создаёт следующий, а старые ответы остаются доступны в Reviewed
history.

Карточки recordings показывают дату/время и label mix без raw ObjectId. Роли
теперь называются по результату: **Learn** выбирает threshold, **Independent
check** измеряет его на других recordings, **Not used** исключает recording
только из текущего расчёта и не удаляет labels. **Review saved labels**
открывает history, отфильтрованную по этой записи. Если Check содержит только
Sky или только not-Sky, добавьте другой класс из другой записи.

Смена роли recording пересчитывает preview автоматически. **Refresh result**
повторяет server calculation с последними saved labels и показывает фактическую
independent accuracy, false Sky matches и coverage. Это не сохраняет calibration
и не запускает classification. Кнопка сохранения остаётся disabled, пока
blockers не устранены; при сохранении backend повторно вычисляет метрики.

Сохранённая calibration считается рабочей только с
`contractVersion=server-computed-v1`, server provenance, текущими profile
revision/embedding space, непересекающимися Fit/Check recordings и реально
измеренной Check precision не ниже выбранной цели. Calibration с целью 98% и
выше получает policy `full`; явно подтверждённая цель 90–97% — policy `pilot` и
`maxRangeHours=24`. Более старые client-asserted records показываются как
`stale` и не разблокируют pilot. Старые automatic identity решения не удаляются,
но отдельно считаются как `stale decisions`; Timeline и Transcript показывают их
как unclassified до новой совместимой классификации.

## 10. Identity pilot и backfill

После актуального Sky profile и validated calibration откройте
`https://localhost:4433/jobs?type=speakerIdentity` и нажмите play у worker.
Launcher сам подставляет primary Sky, текущую profile revision, server-validated
calibration и совместимую active generation; оператор выбирает 24 часа, 7/14
дней или custom range. Для provisional calibration варианты больше 24 часов
disabled, а custom range проверяется повторно worker. Raw `profileId`, `runId`,
revision, calibration ID, cursor и campaign ID вручную вводить не нужно. Те же
ссылки доступны из Review & calibration, Operations & generations, Audio
Pipeline и Job Details.

Порядок rollout:

1. **24 hours → Classify existing**.
2. Проверить случайные `identified`, `unknown` и все `uncertain`.
3. Исправить ошибки manual annotations.
4. Расширить до **7 days**.
5. Ещё раз проверить distribution и false positives.
6. Запускать историю bounded ranges.

Состояния:

- `identified` — выше positive threshold;
- `unknown` — ниже conservative negative threshold только при
  `negativeDecisionMode=calibrated`;
- `uncertain` — между thresholds, либо любой score ниже positive threshold при
  безопасном Sky-first режиме `negativeDecisionMode=uncertain_only`;
- `unclassified` — identity worker ещё не оценивал segment.
- `stale decisions` — исторический automatic result с отсутствующей или
  несовместимой текущей server calibration; это не подтверждённый результат.

Показанный similarity score — не вероятность и не процент готовности. Только
calibrated thresholds превращают score в identity decision.

Cross-space matching блокируется. Если `legacy-unknown` не проходит validation,
используйте rolling versioned re-diarization, а не принудительный match.

`Classify existing` создаёт identity campaign. В Operations & generations,
Review & calibration, Jobs и Job Details отображаются общий processed/total,
текущий batch, Sky, not-Sky, uncertain, incompatible, rate и ETA. Continuation
сохраняет тот же `campaignId`, поэтому прогресс не возвращается к нулю между
jobs. После каждого batch Timeline speaker-layer обновляется автоматически.

После pilot:

1. Откройте все `uncertain` и случайную выборку Sky/not-Sky.
2. Исправьте ошибки manual annotation; автоматический backfill их не
   перезаписывает.
3. Если false-positive rate приемлем, расширьте период.
4. Если precision ниже production-цели, добавьте разнообразные записи и
   пересчитайте calibration. Для диагностики можно выбрать 95%/90% provisional
   pilot; после него проверьте false positives и вернитесь к 98% перед
   расширением истории. Production raw cosine threshold задаёт сервер; только в
   provisional pilot его можно явно повысить, но не понизить.
5. Histogram/Timeline отдельным job пересчитывать не нужно: speaker track читает
   active diarization segments и сбрасывает frontend cache после identity batch.

## 11. Проверка на Timeline и Transcript

Timeline содержит независимые слои:

- **Diarization coverage** — speech diarized/missing/processing/error/building;
- **Speaker Identity** — Sky/unknown/uncertain/unclassified.

Нет coverage — нужна diarization. Coverage есть, но segment `unclassified` —
нужен identity calibration/backfill.

На близком масштабе клик по segment открывает аудио, transcript context,
campaign/job и manual actions. Transcript показывает все пересекающиеся voice
segments. Точная speaker-by-word attribution не заявляется, поскольку word
timestamps отсутствуют.

## Verification checklist

Перед заявлением «diarization работает»:

- [ ] Mycelia `/readiness` отвечает 200.
- [ ] Bind mounts указывают на нужный checkout, runtime mode ожидаемый.
- [ ] Diarizator container запущен.
- [ ] `/health`: `ready=true`, ожидаемый device, fingerprint и embedding space.
- [ ] `/embed` возвращает dimension 256.
- [ ] `/diarize` возвращает segments на реальном speech audio.
- [ ] Settings → Diarization показывает нужный именованный route как Running.
- [ ] Worker enabled, campaign сохраняет route/range/progress/errors.
- [ ] Timeline coverage изменяется после успешных batches.

Перед заявлением «speaker identity работает»:

- [ ] Profile имеет samples, актуальные revision и embedding space.
- [ ] Calibration/validation используют разные recordings.
- [ ] Есть минимум 100 labels, включая 40 Sky и 40 not-Sky.
- [ ] Backend calibration preview показывает вычисленные thresholds и выбранную
      precision на отдельном validation audio.
- [ ] Если preview показывает `Auto not-Sky off`, проверено, что calibration
      сохраняет `negativeDecisionMode=uncertain_only`, а worker оставляет
      остальные голоса uncertain.
- [ ] Positive threshold override не ниже server recommendation, сбрасывается
      при смене target/split и используется только в provisional pilot.
- [ ] Для full backfill сохранена policy `full` с целью ≥98%; sub-98% policy
      используется только для ≤24-hour pilot.
- [ ] 24-hour pilot прошёл ручной QA.
- [ ] Identity campaign дошла до `completed`, а incompatible/remaining понятны.
- [ ] Timeline и Transcript показывают одинаковые overrides/states.

## Troubleshooting

### Hugging Face 401/403

- Токен должен лежать в `.env`, который читает конкретный Compose project.
- Аккаунт токена должен принять условия обеих models.
- После изменения token пересоздайте diarizator.

```bash
docker compose --profile diarization up -d --force-recreate diarizator
```

### `torchcodec is not available`

Это inference failure, даже если `/health` отвечает 200. Используйте repository
image/runtime, `AUDIO_BACKEND=soundfile` и проверяйте `/embed` плюс `/diarize`.
Не устанавливайте случайный latest TorchCodec: ABI должен совпадать с
Torch/CUDA.

### Job выбрал не тот server

- Меньший priority предпочтительнее.
- Выбирается только healthy enabled route.
- Route snapshot создаётся при enqueue.
- Измените priority, сохраните, обновите health и создайте новый job.

### Большие gaps между jobs

- Проверьте worker toggle и pause state.
- Default concurrency равен 1.
- Смотрите campaign, а не отдельные continuation jobs.
- Проверьте GPU request duration, provider downtime и retry delay.
- Проверьте `needs_attention` и потерянный `hasMore` continuation.
- Watchdog 300 секунд — recovery; здоровая chain продолжается сразу.

### Generation бесконечно `building`

Проверьте campaign/current job. Generation без active/waiting job после stale
threshold должна считаться `interrupted`. Не активируйте и не purge её. Resume
только при idempotent writes, иначе mark failed и новая generation.

### `Classify existing` disabled

Нужны одновременно active diarization run, primary profile, совпадающая profile
revision, validated calibration и совместимые embedding spaces. Закончите
prerequisite в Voice Profiles/Voice Identity; не обходите gate правкой MongoDB.

## Безопасная остановка

Только local optional diarizator:

```bash
docker compose --profile diarization stop diarizator
```

Standalone local:

```bash
cd diarizator
docker compose -p mycelia-diarization-local --profile cpu down
```

Standalone GPU:

```bash
cd diarizator
docker compose -p mycelia-diarization --profile gpu down
```

Остановка inference service не удаляет данные, но active jobs могут упасть или
ждать recovery. Remote process и Mycelia worker toggle управляются отдельно.
