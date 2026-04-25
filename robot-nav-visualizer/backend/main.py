from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import json, asyncio

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.websocket("/ws/plan")
async def plan(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            raw  = await ws.receive_text()
            data = json.loads(raw)

            grid  = data["grid"]
            start = tuple(data["start"])
            goal  = tuple(data["goal"])
            algo  = data.get("algo", "astar")

            # Import lazily so missing files give a clear error
            if algo == "astar":
                from planners.astar import astar as planner
            elif algo == "rrt":
                from planners.rrt import rrt as planner
            elif algo == "rrt_star":
                from planners.rrt_star import rrt_star as planner
            else:
                await ws.send_text(json.dumps({"type": "error", "data": f"Unknown algo: {algo}"}))
                continue

            # ── Key fix: await each send individually so the client
            #    receives messages as they are yielded, not all at once.
            async for event in planner(grid, start, goal):
                await ws.send_text(json.dumps(event))
                # yield control back to event loop so FastAPI can flush
                await asyncio.sleep(0)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await ws.send_text(json.dumps({"type": "error", "data": str(e)}))
        except Exception:
            pass