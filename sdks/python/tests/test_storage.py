"""Unit tests for the Storage module."""
import pytest
import httpx
import respx

from insforge import create_client

BASE_URL = "http://localhost:7130"


@pytest.fixture
def client():
    return create_client(base_url=BASE_URL, anon_key="test-key")


@respx.mock
@pytest.mark.asyncio
async def test_get_public_url(client):
    url = client.storage.from_("avatars").get_public_url("user.png")
    assert url == f"{BASE_URL}/api/storage/buckets/avatars/objects/user.png"


@respx.mock
@pytest.mark.asyncio
async def test_list_objects(client):
    respx.get(f"{BASE_URL}/api/storage/buckets/avatars/objects").mock(
        return_value=httpx.Response(200, json={"objects": [{"key": "a.png"}]})
    )
    result = await client.storage.from_("avatars").list()
    assert result["error"] is None
    assert result["data"]["objects"][0]["key"] == "a.png"


@respx.mock
@pytest.mark.asyncio
async def test_remove_object(client):
    respx.delete(f"{BASE_URL}/api/storage/buckets/avatars/objects/a.png").mock(
        return_value=httpx.Response(200, json={"message": "deleted"})
    )
    result = await client.storage.from_("avatars").remove("a.png")
    assert result["error"] is None
