"""Unit tests for the Database module."""
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
async def test_select_all(client):
    respx.get(f"{BASE_URL}/api/database/records/users").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "name": "Alice"}])
    )
    result = await client.database.from_("users").select("*").execute()
    assert result["error"] is None
    assert result["data"][0]["name"] == "Alice"


@respx.mock
@pytest.mark.asyncio
async def test_select_with_filter(client):
    route = respx.get(f"{BASE_URL}/api/database/records/users").mock(
        return_value=httpx.Response(200, json=[{"id": 2, "name": "Bob"}])
    )
    result = await client.database.from_("users").select("id,name").eq("id", 2).execute()
    assert result["error"] is None
    assert result["data"][0]["id"] == 2


@respx.mock
@pytest.mark.asyncio
async def test_insert(client):
    respx.post(f"{BASE_URL}/api/database/records/users").mock(
        return_value=httpx.Response(201, json=[{"id": 3, "name": "Carol"}])
    )
    result = await client.database.from_("users").insert([{"name": "Carol"}])
    assert result["error"] is None
    assert result["data"][0]["name"] == "Carol"


@respx.mock
@pytest.mark.asyncio
async def test_rpc(client):
    respx.post(f"{BASE_URL}/api/database/rpc").mock(
        return_value=httpx.Response(200, json={"result": 42})
    )
    result = await client.database.rpc("my_func", {"x": 1})
    assert result["error"] is None
    assert result["data"]["result"] == 42
