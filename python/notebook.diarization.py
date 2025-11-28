#%%
from lib.resources import call_resource
from bson import ObjectId
from datetime import datetime, timedelta

from pytz import UTC

start = datetime.fromtimestamp(1744669200, tz=UTC)
end = start + timedelta(seconds=25)


diarizations = call_resource('tech.mycelia.mongo', {
    "action": "find",
    "collection": "diarizations",
    "query": {
        # "original_id": ObjectId('67fdf46123a11a7258153474'),
        "start": {"$gte": start },
    },
    "options": {
        "sort": {"start": 1},
        "limit": 1000,
    },
})

diarizations
# %%

import pandas as pd
import numpy as np
df = pd.DataFrame(diarizations)

# Convert embeddings to numpy arrays, handling None/missing values
df['voice_emb'] = df['voice_emb'].apply(lambda x: np.array(x) if x is not None else None)

# Filter out rows with missing embeddings
df = df[df['voice_emb'].notna()].copy()

# Calculate duration for each segment in seconds
df['duration'] = (df['end'] - df['start']).dt.total_seconds()

df['start_rel'] = (df['start'] - start).dt.total_seconds()
df['end_rel'] = (df['end'] - start).dt.total_seconds()

#%%

import matplotlib.pyplot as plt
from sklearn.decomposition import PCA

# Project embeddings to 1D for plotting
pca = PCA(n_components=1)
voice_embeddings = np.stack(df['voice_emb'].values)
embedded_1d = pca.fit_transform(voice_embeddings)
df['embedding_1d'] = embedded_1d.flatten()


fig, ax = plt.subplots(figsize=(12, 3))


for _, row in df.iterrows():
    x = [row['start_rel'], row['end_rel']]
    y = [row['embedding_1d']] * 2 if 'embedding_1d' in row else [0, 0]
    ax.plot(x, y, linewidth=6)

ax.set_xlabel('Time')
ax.set_ylabel('Speaker')
# ax.set_xlim(0, 25)
ax.set_title('Diarization Segments Timeline')
plt.tight_layout()
plt.show()


# %%

len(diarizations)
# %%
# %%




TIGORS_DIARIZATION_IDS = [
    ObjectId('67fed55d7ce486f7496d2d81'),
    ObjectId('67fec685f64cc2a88352056d'),
]


tigors_diarizations = [
    diarization for diarization in diarizations if diarization['_id'] in TIGORS_DIARIZATION_IDS
]

tigor_average_embedding = np.mean([diarization['voice_emb'] for diarization in tigors_diarizations], axis=0)

# %%

from scipy.spatial.distance import cosine


# Compute cosine distance to reference embedding
df['embedding_dist'] = df['voice_emb'].apply(lambda emb: cosine(emb, tigor_average_embedding) if emb is not None else 0.0)

fig, ax = plt.subplots(figsize=(12, 3))

for _, row in df.iterrows():
    x = [row['start_rel'], row['end_rel']]
    y = [row['embedding_dist']] * 2 if 'embedding_dist' in row else [0, 0]
    ax.plot(x, y, linewidth=6)

ax.set_xlabel('Time')
ax.set_ylabel('Embedding Distance to Tigor Average')
ax.set_title('Diarization Segments - Distance to d')
ax.set_xlim(0, 25)
plt.tight_layout()

plt.show()

# %%
n = -4
duration = (diarizations[n]['end'] - diarizations[n]['start']).total_seconds()
print(duration)
!uv run play.py {int(diarizations[n]['start'].timestamp())} {int(diarizations[n]['end'].timestamp())}
# %%

# %%

diarizations[n]['_id']
# %%

diarizations[n]['voice_emb']
# %%

# %%

for d in tigors_diarizations:
    print(cosine(d['voice_emb'], tigor_average_embedding))
# %%
