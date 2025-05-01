import asyncio
import websockets
import json
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request
import uvicorn

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

clients = {}

def build_ws_url():
    return f"wss://richup.io/socket.io/?EIO=4&transport=websocket&t={int(time.time() * 1000)}"

def get_json_body(message):
    return json.loads(str(message).split(",", 1)[1])

def join_room_payload(code):
    return '42/api/game,' + json.dumps(["enter-room", {"roomId": code}])

async def ws_send(ws, tag, message):
    await ws.send(message)

async def ws_recv(ws, tag):
    message = await ws.recv()
    return message

async def respond_to_ping(msg, ws, tag):
    if msg == "2":
        await ws_send(ws, tag, "3")
        return True
    return False

# ========= Room Monitor ==========
class RoomMonitor:
    def __init__(self, room_id):
        self.room_id = room_id
        self.ws_url = build_ws_url()

    async def notify_clients(self, message):
        try:
            payload = get_json_body(message)
            if not isinstance(payload, list) or len(payload) < 2:
                return

            event_type = payload[0]
            for client_ws, types in clients.items():
                await client_ws.send_json({"room": self.room_id, "message": message, "eventType": event_type})
        except Exception:
            pass  # Ignore malformed messages

    async def connect(self):
        async with websockets.connect(self.ws_url) as ws:
            await ws_recv(ws, f"room-{self.room_id}")
            await ws_send(ws, f"room-{self.room_id}", "40/api/game,")
            await asyncio.sleep(0.2)

            await ws_send(ws, f"room-{self.room_id}", join_room_payload(self.room_id))

            while True:
                msg = await ws_recv(ws, f"room-{self.room_id}")
                if await respond_to_ping(msg, ws, f"room-{self.room_id}"): continue
                await self.notify_clients(msg)

# ====== Get Lobby Rooms ========
async def get_lobby_room_ids():
    ws_url = build_ws_url()
    async with websockets.connect(ws_url) as ws:
        await ws_recv(ws, "lobby")
        await ws_send(ws, "lobby", "40/api/lobby,")
        await ws_send(ws, "lobby", "1")

        while True:
            msg = await ws_recv(ws, "lobby")
            if await respond_to_ping(msg, ws, "lobby"):
                continue
            if msg.startswith("42/api/lobby,[\"lobby-rooms-list\""):
                rooms = get_json_body(msg)[1]["rooms"]
                return [room["id"] for room in rooms]

# ========== FastAPI Web Routes ==========
@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    try:
        init_data = await websocket.receive_text()
        init_json = json.loads(init_data)
        message_types = init_json.get("messageTypes", [])

        clients[websocket] = message_types

        while True:
            await websocket.receive_text()  # No-op for now

    except WebSocketDisconnect:
        clients.pop(websocket, None)

# ========== Background Runner ==========
@app.on_event("startup")
async def start_monitors():
    room_ids = await get_lobby_room_ids()
    for room_id in room_ids:
        monitor = RoomMonitor(room_id)
        asyncio.create_task(monitor.connect())

if __name__ == "__main__":
    port = 8000
    print(f"connect at http://localhost:{port}/")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
