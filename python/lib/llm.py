#%%
from langchain_openai import ChatOpenAI

from .config import get_url
from .api import session, ensure_authorized
import httpx


#%%
def auth_callback(request: httpx.Request) -> httpx.Request:
    ensure_authorized()
    request.headers.update({"Authorization": f"Bearer {session.access_token}"})
    return request

http_client = httpx.Client(auth=auth_callback)
http_async_client = httpx.AsyncClient(auth=auth_callback)


class ChatMycelia(ChatOpenAI):
    def __init__(self, *args, **kwargs):
        kwargs['api_key'] = 'dummy-api-key'
        kwargs['base_url'] = get_url("llm")
        kwargs['http_client'] = http_client
        kwargs['http_async_client'] = http_async_client
        super().__init__(*args, **kwargs)


def get_llm(model) -> ChatMycelia:
    return ChatMycelia(model=model)


small_llm = get_llm('small')
medium_llm = get_llm('medium')
large_llm = get_llm('large')