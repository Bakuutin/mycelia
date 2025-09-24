# Upward Summarization – Downward Refinement

*A bi-directional pipeline for consolidating chaotic conversational data into stable, queryable knowledge.*

---

## Why

Raw transcripts are too noisy for meaningful recall. We want a system that:

* Surfaces the **most important events** at any time scale (hour → day → week → month → year).
* Learns **who matters** (people), **what matters** (projects/themes), and **why** (goals/emotions/decisions).
* Builds a **knowledge graph (KG)** linking utterances ↔ topics ↔ people ↔ projects ↔ time.
* Iteratively improves low-level annotations using high-level context.

---

## Core Idea

1. **Upward Summarization (Bottom → Top)**: extract topics + summaries from granular windows (e.g., 5–60 minutes), aggregate up to daily/weekly/monthly/annual layers, infer biography (people, projects, roles).
2. **Downward Refinement (Top → Bottom)**: use the inferred high-level context to re-interpret and enrich low-level segments (better topic labels, entity disambiguation, importance scores, links to people/projects).

This forms a consolidation loop: **raw → structure → context → refined structure**.

---

## User Outcomes

* Zoomable narrative: **hour → day → week → month → year**.
* Query the KG: “show all interactions related to *Project X* with *Person Y* in *June* with *high importance*”.
* Trustworthy provenance: every bullet can be traced to source segments.

---

## High-Level Architecture

```
raw_transcripts ──▶ segmentation(5m) ──▶ topic-extraction ──▶ hourly summary
                                        │
                                        └────────▶ histogram_5min(topics)

hourly/day/week summaries ─▶ biography inference (people, projects, roles)
                                 │
                                 ▼
                           context store (KG)
                                 │
                                 ▼
refinement jobs ◀─────────── downward prompts + entity linking
      │
      └──▶ refined_5min (topics*, participants*, project*, importance*, links)
```

---

## Data Model (Mongo-flavored)

```json
// 5-minute bucket of atomic observations
{
  "_id": "hist5m:2025-09-24T10:05Z",
  "start": "2025-09-24T10:05:00Z",
  "end": "2025-09-24T10:09:59Z",
  "topics": ["call with lawyer", "timeline UI bug"],
  "segments": [
    {"t0": "2025-09-24T10:05:21Z", "t1": "2025-09-24T10:06:05Z", "text": "..."}
  ],
  "refined": {
    "participants": ["person:alice"],
    "projects": ["proj:mycelia"],
    "importance": 76,
    "topic_clusters": ["tc:law-ops"],
    "links": ["seg:..."],
    "version": 2
  }
}
```

```json
// Summary document (day/week/month/year)
{
  "_id": "summary:day:2025-09-24",
  "level": "day",
  "start": "2025-09-24T00:00:00Z",
  "end": "2025-09-24T23:59:59Z",
  "bullets": [
    {"name": "Legal review scheduled", "importance": 88, "participants": ["alice"], "projects": ["mycelia"], "why": "deadline risk mitigated"},
    {"name": "Timeline renderer stabilized", "importance": 71, "projects": ["timeline-ui"]}
  ],
  "sources": ["hist5m:...", "hist5m:..."],
  "version": 1
}
```

```json
// Knowledge Graph nodes (people, projects, topics)
{
  "_id": "kg:person:alice",
  "type": "person",
  "name": "Alice Example",
  "aliases": ["A."],
  "embedding": "...",
  "stats": {"interactions": 42, "avg_importance": 63}
}
```

```json
{
  "_id": "kg:project:mycelia",
  "type": "project",
  "name": "Mycelia",
  "status": "active",
  "owners": ["person:tigor"],
  "themes": ["privacy", "data-lake", "summarization"],
  "embedding": "..."
}
```

```json
// KG edges (typed relations)
{
  "_id": "edge:participated",
  "src": "kg:person:alice",
  "dst": "hist5m:2025-09-24T10:05Z",
  "type": "participated_in",
  "weight": 0.9,
  "evidence": ["seg:..."],
  "time": "2025-09-24T10:05:00Z"
}
```

---

## Upward Summarization (Bottom → Top)

1. **Segmentation**: chunk transcripts into 5–60m windows; filter known noise.
2. **Topic Extraction (summary-unaware)**: prompt LLM to list 0–10 concise topics per chunk (strict JSON).
3. **Embedding + Clustering**: compute sentence embeddings for topics; cluster by cosine similarity; produce stable **topic\_cluster** IDs.
4. **Hourly Summaries**: map-reduce over clusters within the hour → 3–7 bullets.
5. **Daily/Weekly Aggregation**: aggregate bullets/cluster stats upward; keep **traceability** to source buckets.
6. **Biography Inference**: from aggregated data infer **people**, **projects**, **roles**, **long-run themes**; materialize to KG.

**Signals captured upward:** frequency, duration, emotional intensity, novelty, multi-speaker involvement.

---

## Downward Refinement (Top → Bottom)

Use the learned context (KG) to re-annotate atomic buckets.

**Refinement goals**

* Disambiguate entities (which Alice? which project?).
* Attach participants/projects to each bucket.
* Re-score importance with personal + contextual weights.
* Link segments to KG nodes and summary bullets (provenance).

**Refinement prompt sketch**

```text
Given:
- person/project knowledge graph (short JSON snippets),
- this 5-minute bucket’s segments,
- previously extracted raw topics,
Return: refined labels {participants[], projects[], importance 0–100, canonical_topic_ids[]}, and short justification.
```

**Importance scoring** (example linear model)

```
Score =  w_f*frequency + w_d*duration + w_e*emotion + w_n*novelty
       + w_p*personal_salience + w_q*query_relevance
```

Store component scores for auditing and later learning.

---

## Knowledge Graph Construction

* **Nodes**: Person, Project, TopicCluster, SummaryBullet, TimeBucket (hist5m), Organization, Place (optional).
* **Edges**: participated\_in, about\_project, mentions\_topic, summarizes, refines, sibling\_of (temporal adjacency), collaborated\_with.
* **Embeddings**: store per node and optionally per edge (text contexts, names, aliases).
* **Canonicalization**: entity resolution via clustering + LLM name normalization.
* **Versioning**: immutable nodes with `version`; edges carry `evidence` pointers to source segments.

**Queries**

* *People-centric*: “rank people by total importance in September”.
* *Project-centric*: “timeline of Mycelia-related events with >70 importance”.
* *Topic-centric*: “emergent themes with rising importance week-over-week”.

---

## Pipelines & Orchestration

* **Queues**: `ingest`, `extract_topics`, `cluster_topics`, `summarize_hour/day/week`, `infer_biography`, `refine_5m`.
* **Workers**: stateless; idempotent jobs (dedupe by `(phase, time_range, version)`).
* **Triggers**: cron (e.g., nightly consolidation), on-demand (user re-summarize), backfill (new model version).

---

## Prompts (canonical examples)

**Topic extraction (summary-unaware)**

```text
Input: transcripts(≤N tokens) for a 5–60m window.
Output: ["Concise topic 1", ...] // max 10, strict JSON.
Ignore filler, greetings, thanks, random noises.
```

**Hour summary (importance-focused)**

```json
{
  "summary_bullets": ["Most important thing 1", "..."],
  "top_topics": [{"name": "X", "importance": 0-100, "participants": "...", "description": "..."}]
}
```

**Refinement with KG**

```json
{
  "participants": ["person:alice"],
  "projects": ["proj:mycelia"],
  "importance": 0-100,
  "canonical_topic_ids": ["tc:law-ops"],
  "why": "Short justification"
}
```

---

## Scoring & Learning

* Start with manual weights; log component scores.
* Collect explicit feedback (⭐/⬆️/⬇️) to learn personalized weights.
* Periodically retrain: pairwise ranking loss on user feedback.

---

## Evaluation

* **Precision of entity linking** (people/projects): manual spot-check, F1.
* **Summary usefulness**: user A/B on comprehension time and recall accuracy.
* **Drill-down fidelity**: every bullet must link to concrete segments.
* **Latency & cost**: tokens/job, jobs/day.

---

## Privacy & Security

* Local-first processing where possible; redact PII in logs.
* Role-based access for KG nodes/edges (private people vs public projects).
* Immutable audit trail of provenance (who/what generated which summary).

## Roadmap

1. **MVP Upward**: 5m topics → hour bullets → day summary with provenance.
2. **KG v1**: people + projects + topic clusters; simple cosine clustering.
3. **Downward v1**: entity linking + importance scoring in 5m buckets.
4. **Personalization**: feedback loops, learned weights.
5. **Scale-out**: weekly/monthly/yearly rollups; query UI over KG.
6. **Advanced**: novelty/rise detection; cross-day episode reconstruction; multi-speaker diarization integration.

