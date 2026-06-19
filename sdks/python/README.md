# InsForge Python SDK

Official Python client for [InsForge](https://insforge.com) — Backend-as-a-Service platform.

## Installation

```bash
pip install insforge
```

For realtime WebSocket support:

```bash
pip install "insforge[realtime]"
```

## Quick Start

```python
from insforge import create_client

client = create_client(
    base_url="https://your-app.region.insforge.app",
    anon_key="your-anon-key",
)
```

## Authentication

```python
# Sign up
result = client.auth.sign_up(email="user@example.com", password="pass123", name="John")
if result.get("require_email_verification"):
    print("Check your email for a verification code")

# Sign in
result = client.auth.sign_in_with_password(email="user@example.com", password="pass123")
user = result["user"]
print(f"Welcome {user['email']}")

# Sign out
client.auth.sign_out()

# Get current session
session_data = client.auth.get_current_session()
if session_data["session"]:
    print("Logged in as:", session_data["session"]["user"]["email"])

# Update profile
client.auth.set_profile({"name": "New Name", "bio": "Developer"})

# Reset password
client.auth.send_reset_password_email(email="user@example.com")
```

## Database

```python
# Select all
result = client.database.from_("posts").select().execute()
posts = result["data"]

# Select with filters
result = (
    client.database.from_("posts")
    .select("id, title, content")
    .eq("status", "published")
    .order("created_at", ascending=False)
    .limit(10)
    .execute()
)

# Insert
result = (
    client.database.from_("posts")
    .insert({"title": "Hello World", "content": "My first post!"})
    .execute()
)

# Update
result = (
    client.database.from_("posts")
    .update({"title": "Updated Title"})
    .eq("id", post_id)
    .execute()
)

# Delete
client.database.from_("posts").delete().eq("id", post_id).execute()

# RPC (stored function)
result = client.database.rpc("get_user_stats", {"user_id": "123"}).execute()
```

## Storage

```python
# Upload a file
with open("photo.jpg", "rb") as f:
    result = client.storage.from_("images").upload("users/avatar.jpg", f, "image/jpeg")
    url = result["url"]

# Upload with auto-generated key
result = client.storage.from_("uploads").upload_auto(file_bytes, "image/png")

# Download
result = client.storage.from_("images").download("users/avatar.jpg")
file_bytes = result["data"]

# Delete
client.storage.from_("images").remove("users/avatar.jpg")

# List objects
result = client.storage.from_("images").list(prefix="users/", limit=50)
objects = result["data"]
```

## AI

```python
# Chat completion
response = client.ai.chat.completions.create(
    model="anthropic/claude-3.5-haiku",
    messages=[{"role": "user", "content": "What is the capital of France?"}],
)
print(response["choices"][0]["message"]["content"])

# Streaming
stream = client.ai.chat.completions.create(
    model="openai/gpt-4",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True,
)
for chunk in stream:
    content = chunk["choices"][0].get("delta", {}).get("content", "")
    print(content, end="", flush=True)

# Image generation
response = client.ai.images.generate(
    model="google/gemini-3-pro-image-preview",
    prompt="A serene mountain landscape at sunset",
    size="1024x1024",
)
base64_image = response["data"][0]["b64_json"]

# Embeddings
response = client.ai.embeddings.create(
    model="openai/text-embedding-3-small",
    input="Hello world",
)
vector = response["data"][0]["embedding"]
```

## Functions

```python
# Invoke a serverless function
result = client.functions.invoke("hello-world", body={"name": "World"})
print(result["data"])

# GET request
result = client.functions.invoke("get-stats", method="GET")
```

## Realtime

```python
# Requires: pip install "insforge[realtime]"

client.realtime.connect()

# Subscribe to a channel
response = client.realtime.subscribe("chat:room-1")
if response["ok"]:
    print("Subscribed!")

# Listen for events
def handle_message(payload):
    print(f"New message: {payload['text']}")

client.realtime.on("new_message", handle_message)

# Publish
client.realtime.publish("chat:room-1", "new_message", {"text": "Hello!", "sender": "Alice"})

# Unsubscribe
client.realtime.unsubscribe("chat:room-1")

# Disconnect
client.realtime.disconnect()
```

## Error Handling

```python
from insforge.http import InsForgeError

try:
    result = client.auth.sign_in_with_password(email="bad@example.com", password="wrong")
except InsForgeError as e:
    print(e.status_code)   # 401
    print(e.error_code)    # 'INVALID_CREDENTIALS'
    print(e.message)       # 'Invalid email or password'
    print(e.next_actions)  # 'Check your email and password'
```

## Requirements

- Python 3.8+
- `requests >= 2.28`
- `python-socketio[client] >= 5.0` (optional, for realtime)

## License

Apache 2.0
