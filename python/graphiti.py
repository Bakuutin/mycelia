#%%
import os
from graphiti_core import Graphiti
from graphiti_core.driver.falkordb_driver import FalkorDriver
from graphiti_core.cross_encoder.gemini_reranker_client import GeminiRerankerClient
from dotenv import load_dotenv
load_dotenv('../.env', override=True)

FALKORDB_PASSWORD = os.getenv("FALKORDB_PASSWORD")


# Create a FalkorDB driver with custom database name
driver = FalkorDriver(
    host="localhost",
    port=6380,
    # username="falkor_user",  # Optional
    # password=FALKORDB_PASSWORD,  # Optional
    database="test"  # Custom database name
)


from openai import AsyncOpenAI
from graphiti_core import Graphiti
from graphiti_core.llm_client.openai_client import OpenAIClient
from graphiti_core.llm_client.config import LLMConfig
from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig


oai_like_client =AsyncOpenAI(api_key=os.getenv("LLM_API_KEY"), base_url=os.getenv("LLM_BASE_URL"))

# Initialize Azure OpenAI client using the standard OpenAI client
# with Azure's v1 API endpoint
llm_client = OpenAIClient(
    config=LLMConfig(model='google/gemini-2.5-flash-lite'),
    client=oai_like_client,
)

embedder = OpenAIEmbedder(
    config=OpenAIEmbedderConfig(embedding_model='sentence-transformers/all-minilm-l12-v2'),
    client=oai_like_client,
)

reranker = GeminiRerankerClient(
    config=LLMConfig(model='google/gemini-2.5-flash-lite'),
    client=oai_like_client,
)


graphiti = Graphiti(
    graph_driver=driver,
    llm_client=llm_client,
    embedder=embedder,
    cross_encoder=reranker,
)

# %%
from datetime import datetime
from graphiti_core.nodes import EpisodeType

text = """
Alice arrived late to the observatory, smelling faintly of solder and rain. This Alice fixed things: broken clocks, bent antennae, the kind of problems that apologized once you applied enough pressure in the right direction. She signed the logbook Alice in block letters, then climbed the stairs to the dome, already arguing with herself about whether the fault was thermal drift or human laziness.
Alice was already there. This Alice wore gloves she never needed and spoke as if every sentence were being quoted somewhere important. She had signed the same logbook Alice in careful cursive an hour earlier and was busy naming stars after mistakes she’d made and survived. When the first Alice said, “You’re in my workspace,” the second Alice replied, calmly, “No, I’m in my model of it.”
They worked through the night without resolving the naming problem. At dawn, the telescope finally aligned, the data finally made sense, and the logbook contained two identical names describing two incompatible versions of the same success. Anyone reading it later would assume a clerical error. Both Alices knew better, and neither bothered correcting the record.
"""

result = await graphiti.add_episode(
    name="Two Alices",
    episode_body=text,
    source_description="test data",
    reference_time=datetime.now(),
    source=EpisodeType.message,
)

print(f"Created episode: {result.episode.uuid}")
print(f"Extracted {len(result.nodes)} entities and {len(result.edges)} relationships")# %%

#%%


await graphiti.add_episode(
    name="Alice and Sarah",
    episode_body="Alice met with Sarah at the coffee shop to discuss the project.",
    source_description="test data",
    reference_time=datetime.now(),
    source=EpisodeType.text,
)

# %%


await graphiti.search(
    query="Who met with Sarah?",
)
# %%

# await graphiti.driver.execute_query(
#     "MATCH (n) DETACH DELETE n",
#     routing_='w'  # 'w' for write operation
# )

#%%


# %%

