# Graphiti: Ambiguous Entity Resolution

## Problem Statement

When an episode mentions an entity name that matches **multiple existing nodes** in the graph, Graphiti always forces a merge — the LLM picks one candidate even when the match is genuinely ambiguous. There is no "I'm not sure, keep it separate" path.

**Example:**

```
Episode 1: "Alice (engineer) fixed the antenna. Alice (astronomer) named the stars."
  → Graph creates: Alice-engineer (aaa), Alice-astronomer (bbb)

Episode 2: "Alice met Sarah at the coffee shop."
  → Desired: Sarah ←met→ Alice (new node ddd) —MAYBE_IS→ aaa, bbb
  → Actual:  Sarah ←met→ Alice-engineer (aaa)  ← LLM guessed
```

The second episode's "Alice" is genuinely ambiguous — a human couldn't tell which Alice either. But Graphiti always resolves to exactly one existing node.

### Desired Behavior

| Scenario | Candidates in graph | Action |
|---|---|---|
| No candidates | 0 matches | Create new node |
| Clear match | 1 strong match | Merge with existing |
| **Ambiguous** | **2+ similar matches** | **Keep as new node, create MAYBE_IS edges to each candidate** |

## How the Current Pipeline Works

The resolution pipeline lives in two files:

### Stage 1: Deterministic — `dedup_helpers.py:_resolve_with_similarity()`

For each extracted node:

1. **Exact name match** (normalized lowercase): looks up `indexes.normalized_existing[name]`
   - 1 match → **merge** (resolved)
   - \>1 matches → **send to LLM** (unresolved) ← _this is where ambiguity is punted_
   - 0 matches → continue to fuzzy

2. **Entropy filter**: short/repetitive names (e.g. "Alice" — 5 chars, 1 token) skip fuzzy entirely → **send to LLM**

3. **Fuzzy match** (MinHash + Jaccard ≥ 0.9): finds near-identical names
   - Match found → **merge**
   - No match → **send to LLM**

### Stage 2: LLM — `node_operations.py:_resolve_with_llm()`

All unresolved nodes go here. The LLM sees:
- Extracted nodes (with names, types)
- All candidate nodes from the graph (with attributes, summaries)
- Current episode content
- Previous episodes

The LLM **must** return a `duplicate_idx` for each entity — either an index into the existing candidates, or `-1` for "no duplicate." The prompt says:

> _"Do NOT mark entities as duplicates if they are related but distinct, or have similar names but refer to separate instances."_

But in practice, when the episode says just "Alice" and the graph has "Alice (engineer)" and "Alice (astronomer)", the LLM almost always picks one rather than returning `-1`. There's no mechanism for it to express "I found candidates but I'm not confident."

### Stage 3: Fallback — `node_operations.py:resolve_extracted_nodes()`

Any nodes still unresolved after the LLM pass are kept as new:

```python
for idx, node in enumerate(extracted_nodes):
    if state.resolved_nodes[idx] is None:
        state.resolved_nodes[idx] = node
        state.uuid_map[node.uuid] = node.uuid
```

## Solution: Soft Identity Edges (MAYBE_IS)

Instead of choosing between "merge" and "keep separate with no connection," create the new node AND connect it to every candidate via weighted `MAYBE_IS` edges. The ambiguity is encoded directly in the graph.

### What the Graph Looks Like

```
Episode 1 creates:
  Alice (engineer)  [aaa]
  Alice (astronomer) [bbb]

Episode 2 ("Alice met Sarah") creates:

  Alice [ddd]  ——MAYBE_IS {p: 0.5}——→  Alice (engineer) [aaa]
  Alice [ddd]  ——MAYBE_IS {p: 0.5}——→  Alice (astronomer) [bbb]
  Alice [ddd]  ←——met——→  Sarah [ccc]
```

The new "Alice" is its own node with its own edges. The `MAYBE_IS` edges say: "this entity might be the same real-world entity as that one."

### Edge Schema

```python
class MaybeIsEdge:
    source_node_uuid: str    # the ambiguous new node
    target_node_uuid: str    # an existing candidate
    probability: float       # confidence (0.0–1.0), sum over candidates ≤ 1.0
    group_id: str
    created_at: datetime
    episode_uuid: str        # which episode created this ambiguity
    resolved: bool = False   # set to True when resolved later
```

### Computing Probabilities

Several options depending on available infrastructure:

**Option 1: Uniform (simplest)**
`p = 1.0 / num_candidates` — no confidence signal, just enumerates possibilities.

**Option 2: Embedding similarity**
Compute cosine similarity between the extracted node's name embedding and each candidate's name embedding. Normalize to sum to 1.0.

```python
import numpy as np

def compute_candidate_probabilities(
    extracted_embedding: list[float],
    candidate_embeddings: list[list[float]],
) -> list[float]:
    sims = [
        np.dot(extracted_embedding, c) /
        (np.linalg.norm(extracted_embedding) * np.linalg.norm(c))
        for c in candidate_embeddings
    ]
    # softmax
    exp_sims = [math.exp(s) for s in sims]
    total = sum(exp_sims)
    return [e / total for e in exp_sims]
```

**Option 3: Logprob scoring**
Score each "this entity IS candidate X" hypothesis by negative log-likelihood, convert NLL scores to probabilities via softmax. Most principled but requires logprobs API support.

**Option 4: LLM-estimated confidence**
Ask the LLM to rate confidence per candidate. Fragile — LLMs tend to pick a "best guess" even when instructed not to.

### Detecting Ambiguity

Two intervention points needed to catch all cases:

**1. Multiple exact name matches** — `dedup_helpers.py:_resolve_with_similarity()` line 220

Currently sends to LLM. Change to: keep as new, record candidates.

```python
# Current:
if len(existing_matches) > 1:
    state.unresolved_indices.append(idx)
    continue

# Proposed:
if len(existing_matches) > 1:
    state.resolved_nodes[idx] = node
    state.uuid_map[node.uuid] = node.uuid
    state.ambiguous_candidates[node.uuid] = existing_matches
    continue
```

**2. Similar but not identical names** — `node_operations.py:_resolve_with_llm()` line 472

The extracted node is "Alice", but candidates are "Alice (engineer)" and "Alice (astronomer)". Exact match won't fire. After the LLM picks one, check substring ambiguity and override:

```python
if duplicate_idx == -1:
    resolved_node = extracted_node
elif 0 <= duplicate_idx < len(indexes.existing_nodes):
    resolved_node = indexes.existing_nodes[duplicate_idx]
    # Check for ambiguity: multiple candidates with similar names?
    similar = _find_similar_candidates(extracted_node.name, indexes.existing_nodes)
    if len(similar) > 1:
        resolved_node = extracted_node  # override: keep as new
        state.ambiguous_candidates[extracted_node.uuid] = similar
```

Where `_find_similar_candidates` uses substring containment:

```python
def _find_similar_candidates(
    extracted_name: str,
    existing_nodes: list[EntityNode],
) -> list[EntityNode]:
    """Find existing nodes whose names contain the extracted name or vice versa."""
    extracted_norm = extracted_name.lower().strip()
    similar = []
    for candidate in existing_nodes:
        candidate_norm = candidate.name.lower().strip()
        if (extracted_norm in candidate_norm
                or candidate_norm in extracted_norm
                or extracted_norm == candidate_norm):
            similar.append(candidate)
    return similar
```

### Integration in `add_episode`

After nodes are saved, create `MAYBE_IS` edges for ambiguous resolutions:

```python
# After add_nodes_and_edges_bulk, create MAYBE_IS edges
for node_uuid, candidates in ambiguous_candidates.items():
    probabilities = compute_candidate_probabilities(...)
    for candidate, prob in zip(candidates, probabilities):
        maybe_is_edge = MaybeIsEdge(
            source_node_uuid=node_uuid,
            target_node_uuid=candidate.uuid,
            probability=prob,
            group_id=group_id,
            episode_uuid=episode.uuid,
        )
        await maybe_is_edge.save(driver)
```

### Deferred Resolution

When a later episode provides disambiguating context, resolve the ambiguity:

```
Episode 3: "Alice the engineer met Sarah again to review the blueprints."

Resolution:
  1. Extract "Alice the engineer" → matches Alice (engineer) [aaa] clearly
  2. Search for MAYBE_IS edges pointing to [aaa]
  3. Find Alice [ddd] —MAYBE_IS→ [aaa]
  4. Merge [ddd] into [aaa]:
     - Re-point all edges from [ddd] to [aaa]
     - Delete [ddd] and its MAYBE_IS edges
     - The "met Sarah" edge now connects directly to Alice (engineer)
```

This can be automated or manual:

**Automated**: after each `add_episode`, check if any newly resolved nodes are targets of existing `MAYBE_IS` edges. If a `MAYBE_IS` target gets a clear match from a new episode, trigger the merge.

**Manual/query-based**: surface unresolved `MAYBE_IS` edges via search so a human can resolve them.

### Querying with MAYBE_IS

The `MAYBE_IS` edges enable richer queries:

```cypher
// "Who might Alice be?"
MATCH (a:Entity {name: "Alice"})-[r:MAYBE_IS]->(candidate)
RETURN candidate.name, r.probability
ORDER BY r.probability DESC

// "Find all unresolved identities"
MATCH (a:Entity)-[r:MAYBE_IS {resolved: false}]->(b:Entity)
RETURN a.name, b.name, r.probability, r.episode_uuid

// "What do we know about anyone Alice might be?"
MATCH (a:Entity {name: "Alice"})-[:MAYBE_IS]->(candidate)-[r]->(other)
RETURN candidate.name, type(r), other.name
```

### Files to Modify

| File | Change |
|---|---|
| New edge type (e.g., `edges.py` or custom) | Define `MaybeIsEdge` schema |
| `utils/maintenance/dedup_helpers.py` | Return ambiguous candidates instead of deferring to LLM |
| `utils/maintenance/node_operations.py` | Propagate ambiguous candidates from resolution state; add `_find_similar_candidates` |
| `graphiti.py:add_episode()` | Create `MAYBE_IS` edges after saving nodes |
| (optional) `graphiti.py` | Add `resolve_ambiguous()` method for deferred resolution |
