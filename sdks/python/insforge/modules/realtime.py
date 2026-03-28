"""Realtime module - WebSocket pub/sub via Socket.IO protocol."""
from __future__ import annotations

import asyncio
import json
from typing import Any, Callable

from insforge.lib.http_client import HttpClient


class Realtime:
    """
    Real-time pub/sub client using Socket.IO over WebSocket.

    Limitations vs. JS SDK: this is a lightweight implementation that speaks
    the Socket.IO v4 wire protocol directly without an external library.
    For production use with complex needs, consider the `python-socketio` package.
    """

    EIO_OPEN = "0"
    EIO_MESSAGE = "4"
    SIO_CONNECT = "0"
    SIO_EVENT = "2"
    SIO_ACK = "3"

    def __init__(self, http: HttpClient) -> None:
        self._http = http
        self._ws: Any = None
        self._subscribed: set[str] = set()
        self._listeners: dict[str, list[Callable[..., Any]]] = {}
        self._connected = False
        self._sid: str | None = None
        self._ack_id = 0
        self._pending_acks: dict[int, asyncio.Future] = {}
        self._recv_task: asyncio.Task | None = None

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def socket_id(self) -> str | None:
        return self._sid

    @property
    def connection_state(self) -> str:
        if self._connected:
            return "connected"
        if self._ws is not None:
            return "connecting"
        return "disconnected"

    def get_subscribed_channels(self) -> list[str]:
        return list(self._subscribed)

    async def connect(self) -> None:
        """Open a WebSocket connection to the realtime server."""
        import websockets

        base = self._http._base_url
        ws_base = base.replace("https://", "wss://").replace("http://", "ws://")
        token = self._http._access_token or self._http._anon_key or ""

        url = f"{ws_base}/socket.io/?EIO=4&transport=websocket"

        self._ws = await websockets.connect(url, open_timeout=10)
        self._connected = True
        # Socket.IO handshake: receive EIO OPEN
        await self._ws.recv()
        # Start background receive loop
        self._recv_task = asyncio.create_task(self._recv_loop())
        # Send Socket.IO CONNECT with auth payload
        auth = json.dumps({"token": token}) if token else ""
        await self._ws.send(f"{self.EIO_MESSAGE}{self.SIO_CONNECT}{auth}")

    async def disconnect(self) -> None:
        """Close the WebSocket connection."""
        self._connected = False
        if self._recv_task:
            self._recv_task.cancel()
        if self._ws:
            await self._ws.close()
        self._subscribed.clear()

    async def subscribe(self, channel: str) -> dict[str, Any]:
        """Subscribe to a channel."""
        if not self._connected:
            await self.connect()

        ack_id = self._next_ack()
        future: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending_acks[ack_id] = future

        payload = json.dumps(["realtime:subscribe", {"channel": channel}])
        await self._ws.send(f"{self.EIO_MESSAGE}{self.SIO_EVENT}{ack_id}{payload}")

        try:
            result = await asyncio.wait_for(future, timeout=10.0)
        except asyncio.TimeoutError:
            return {"ok": False, "channel": channel, "error": {"code": "TIMEOUT", "message": "Subscribe timed out"}}

        if result.get("ok"):
            self._subscribed.add(channel)
        return result

    async def unsubscribe(self, channel: str) -> None:
        """Unsubscribe from a channel."""
        if not self._connected:
            return
        payload = json.dumps(["realtime:unsubscribe", {"channel": channel}])
        await self._ws.send(f"{self.EIO_MESSAGE}{self.SIO_EVENT}{payload}")
        self._subscribed.discard(channel)

    async def publish(self, channel: str, event: str, payload: Any) -> None:
        """Publish a message to a channel."""
        if not self._connected:
            await self.connect()
        data = json.dumps(["realtime:publish", {"channel": channel, "event": event, "payload": payload}])
        await self._ws.send(f"{self.EIO_MESSAGE}{self.SIO_EVENT}{data}")

    def on(self, event: str, callback: Callable[..., Any]) -> None:
        """Register a listener for the given event."""
        self._listeners.setdefault(event, []).append(callback)

    def off(self, event: str, callback: Callable[..., Any]) -> None:
        """Remove a listener for the given event."""
        if event in self._listeners:
            self._listeners[event] = [c for c in self._listeners[event] if c is not callback]

    def once(self, event: str, callback: Callable[..., Any]) -> None:
        """Register a one-time listener for the given event."""
        def _wrapper(*args: Any, **kwargs: Any) -> None:
            callback(*args, **kwargs)
            self.off(event, _wrapper)
        self.on(event, _wrapper)

    def _next_ack(self) -> int:
        self._ack_id += 1
        return self._ack_id

    async def _emit(self, event: str, *args: Any) -> None:
        for cb in self._listeners.get(event, []):
            if asyncio.iscoroutinefunction(cb):
                await cb(*args)
            else:
                cb(*args)

    async def _recv_loop(self) -> None:
        try:
            async for raw in self._ws:
                await self._handle_message(raw)
        except Exception:
            self._connected = False
            await self._emit("disconnect", "transport close")

    async def _handle_message(self, raw: str) -> None:
        if not raw:
            return
        eio_type = raw[0]
        if eio_type != self.EIO_MESSAGE:
            return
        sio_part = raw[1:]
        if not sio_part:
            return
        sio_type = sio_part[0]
        rest = sio_part[1:]

        if sio_type == self.SIO_CONNECT:
            try:
                info = json.loads(rest)
                self._sid = info.get("sid")
            except Exception:
                pass
            await self._emit("connect")
        elif sio_type == self.SIO_EVENT:
            # Parse optional ack ID then JSON array
            ack_id, data_str = self._parse_ack_and_data(rest)
            try:
                arr = json.loads(data_str)
            except Exception:
                return
            if isinstance(arr, list) and arr:
                event_name = arr[0]
                event_data = arr[1] if len(arr) > 1 else None
                await self._emit(event_name, event_data)
        elif sio_type == self.SIO_ACK:
            ack_id, data_str = self._parse_ack_and_data(rest)
            if ack_id in self._pending_acks:
                try:
                    result = json.loads(data_str)
                    if isinstance(result, list) and result:
                        result = result[0]
                except Exception:
                    result = {}
                self._pending_acks.pop(ack_id).set_result(result)

    @staticmethod
    def _parse_ack_and_data(s: str) -> tuple[int, str]:
        i = 0
        while i < len(s) and s[i].isdigit():
            i += 1
        ack_id = int(s[:i]) if i > 0 else -1
        return ack_id, s[i:]
