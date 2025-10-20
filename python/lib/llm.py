#%%
from langchain_openai import ChatOpenAI


from lib.config import env

#%%


def get_llm(model) -> ChatOpenAI:
    return ChatOpenAI(
        model=model,
        api_key=env("LLM_API_KEY"),
        base_url=env("LLM_BASE_URL"),
    )


small_llm = get_llm('anthropic/claude-haiku-4.5')
large_llm = get_llm('anthropic/claude-sonnet-4.5')