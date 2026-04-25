# backend/main.py
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import json, asyncio
from planners.astar import astar
from planners.rrt import rrt
from planners.rrt_star import rrt_star

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"])

@app.websocket("/ws/plan")
async def plan(ws: WebSocket):
    await ws.accept()
    while True:
        data = json.loads(await ws.receive_text())
        grid   = data["grid"]        # 2D list, 1=obstacle
        start  = tuple(data["start"])
        goal   = tuple(data["goal"])
        algo   = data["algo"]        # "astar" | "rrt" | "rrt_star"

        planner = {"astar": astar, "rrt": rrt, "rrt_star": rrt_star}[algo]

        async for event in planner(grid, start, goal):
            # event = {"type": "explore"|"edge"|"path", "data": [...]}
            await ws.send_text(json.dumps(event))
            await asyncio.sleep(0)   # yield to event loop for streaming