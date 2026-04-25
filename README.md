# Robot Navigation Visualizer

An interactive 3D/2D visualizer for classical robot path planning algorithms, built with a Python FastAPI backend and a Three.js frontend. Watch A\*, RRT, and RRT\* search in real time — see how each algorithm explores space, builds a tree, and finds a path from start to goal.

<!-- Replace the line below with your actual GIF after uploading it to the repo -->
![Demo: A* vs RRT vs RRT* path planning](results\demo.gif)

---

## What this is

Path planning is one of the foundational problems in robotics and AI: given a map, a start position, and a goal, find a collision-free route. This project implements three of the most important algorithms in the field and visualises their internals — not just the final path, but the entire search process, streamed live from the backend to the browser via WebSocket.

This is not a library wrapper. Every algorithm is implemented from scratch in Python, chosen deliberately so the code is readable alongside the theory.

---

## Algorithms

### A\* (A-Star)

A\* is a **heuristic-guided graph search** algorithm. It maintains a priority queue of nodes ordered by `f(n) = g(n) + h(n)`, where `g(n)` is the true cost from start to node `n`, and `h(n)` is a heuristic estimate of the remaining cost to the goal (Manhattan distance in this implementation).

**Why it matters:** A\* is *complete* (always finds a path if one exists) and *optimal* (finds the shortest path) when the heuristic is admissible — meaning it never overestimates the true cost. It is the backbone of navigation in everything from game AI to autonomous vehicles.

**What you see in the visualizer:** The blue cells expanding outward are nodes being popped from the priority queue. Notice how the exploration front is shaped by the heuristic — it reaches toward the goal rather than expanding uniformly in all directions like Dijkstra's algorithm would.

**Complexity:** Time and space `O(b^d)` in the worst case, where `b` is the branching factor and `d` is the depth of the solution.

---

### RRT (Rapidly-exploring Random Tree)

RRT is a **sampling-based motion planner**. Instead of searching a grid, it grows a tree by randomly sampling the configuration space, finding the nearest existing node, and extending toward the sample by a fixed step size. It repeats until a sample lands close enough to the goal.

**Why it matters:** Grid-based search becomes intractable in high-dimensional spaces (a robot arm with 6 joints has a 6D configuration space). RRT works in any number of dimensions and naturally handles complex, non-convex obstacle geometries. It is used in surgical robotics, drone flight planning, and manipulator arm control.

**What you see in the visualizer:** The blue lines are the growing tree — notice how it explores the space rapidly and somewhat randomly. The tree is *probabilistically complete*: given enough iterations, it will find a path if one exists, but it gives no guarantee of path quality.

**Limitation:** RRT paths are jagged and suboptimal. The path length depends on the step size and random seed, not on the true shortest route.

---

### RRT\* (RRT-Star)

RRT\* extends RRT with two additional steps on every iteration that together guarantee **asymptotic optimality** — as the number of samples approaches infinity, the path cost converges to the true optimum.

**Step 1 — Best parent selection:** When adding a new node, instead of connecting it to its nearest neighbour, RRT\* checks all nodes within a rewire radius and picks whichever gives the lowest cumulative cost from the start.

**Step 2 — Rewiring:** After adding the new node, RRT\* checks whether any nearby node would be cheaper to reach *through* the new node than through its current parent. If so, it reparents that node. This propagates cost improvements backward through the tree.

**Why it matters:** RRT\* is the algorithm of choice when path quality matters — warehouse robots, minimally invasive surgical tools, and autonomous car lane-change planners all require near-optimal paths, not just any path. It was introduced by Karaman and Frazzoli (2011) and is one of the most cited papers in motion planning.

**What you see in the visualizer:** The tree looks similar to RRT at first, but watch the path update and shorten as the algorithm continues to run — you are watching asymptotic optimality in action. The final path is noticeably smoother and shorter than vanilla RRT.

**Trade-off:** RRT\* is slower per iteration than RRT due to the near-neighbour search. The rewire radius is typically set to `O(log(n)/n)^(1/d)` for theoretical guarantees, where `n` is the number of nodes and `d` is the dimensionality.

---

## Algorithm comparison

| Property | A\* | RRT | RRT\* |
|---|---|---|---|
| Complete | Yes | Probabilistically | Probabilistically |
| Optimal | Yes (admissible heuristic) | No | Asymptotically |
| Works in high dimensions | No | Yes | Yes |
| Handles continuous space | No | Yes | Yes |
| Path quality | Optimal on grid | Poor | Converges to optimal |
| Speed | Fast on small grids | Fast | Slower (rewiring) |
| Best used for | Grid maps, game AI, GPS routing | High-DoF robots, quick feasibility | Surgical robots, autonomous vehicles |

---

## Real-world applications

**Autonomous vehicles** — A\* and its variants are used for route planning on road networks. RRT\* is used for local motion planning in cluttered environments where the car must navigate around dynamic obstacles.

**Robotic arms** — Industrial and surgical robot arms operate in high-dimensional joint space where grid search is infeasible. RRT and RRT\* plan collision-free joint trajectories in milliseconds.

**Drone flight planning** — UAVs use sampling-based planners to navigate 3D obstacle fields (buildings, trees) where the configuration space is 6D (position + orientation).

**Warehouse automation** — Systems like Amazon Robotics use variants of A\* for coordinating hundreds of mobile robots on warehouse floor grids.

**Video game AI** — A\* is the standard algorithm for NPC navigation in virtually every commercial game engine (Unity, Unreal).

**Protein folding and molecular docking** — RRT has been applied to conformational planning in computational biology, where the "robot" is a molecule navigating an energy landscape.

---

## Architecture

```
robot-nav-visualizer/
├── backend/
│   ├── main.py                 # FastAPI app, WebSocket endpoint
│   └── planners/
│       ├── __init__.py
│       ├── astar.py            # A* as async generator — streams explored nodes
│       ├── rrt.py              # RRT as async generator — streams tree edges
│       └── rrt_star.py         # RRT* with rewiring — streams path improvements
└── frontend/
    ├── index.html              # Import map for Three.js (no bundler needed)
    └── main.js                 # Three.js 3D scene + 2D canvas + WebSocket client
```

The backend uses Python **async generators** — each algorithm `yield`s events (explored nodes, tree edges, path updates) one at a time. The FastAPI WebSocket handler `await`s each send individually with `asyncio.sleep(0)` between sends, which flushes each message to the client immediately rather than buffering the entire result. This is what makes the animation stream smoothly rather than appearing all at once.

The frontend handles two rendering modes: a **Three.js 3D scene** with OrbitControls, shadow-casting obstacle pillars, and a glowing tube path; and a **2D canvas fallback** that runs all three algorithms locally in the browser with no backend required.

---

## Getting started

**Requirements:** Python 3.10+, no GPU needed.

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/robot-nav-visualizer
cd robot-nav-visualizer

# Backend
cd backend
pip install fastapi uvicorn websockets
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npx serve .
# Open http://localhost:3000
```

The frontend works without the backend — algorithms run locally in the browser. Connect the backend for server-side planning with streamed animation.

---

## Testing the WebSocket API

Use [Postman](https://www.postman.com/) (create a **WebSocket** request, not HTTP) or `wscat`:

```bash
npm install -g wscat
wscat -c ws://localhost:8000/ws/plan
```

Then send:

```json
{
  "grid": [[0,0,0,0,0],[0,1,1,0,0],[0,0,0,0,0],[0,0,1,1,0],[0,0,0,0,0]],
  "start": [0, 0],
  "goal": [4, 4],
  "algo": "astar"
}
```

You will receive a stream of `{"type": "explore", "data": [r, c]}` events followed by a final `{"type": "path", "data": [[r,c], ...], "final": true}`.

---

## Controls

| Control | Action |
|---|---|
| Click cell (2D) | Toggle obstacle |
| Drag S / G (2D) | Move start or goal |
| Orbit drag (3D) | Rotate camera |
| Scroll (3D) | Zoom |
| Random obstacles | Generate a random map |
| Clear path | Reset visualisation, keep obstacles |
| Reset map | Clear everything |

---

## Background and motivation

This project was built as part of preparation for an MSc in AI, Cognitive Sciences and Robotics. Path planning sits at the intersection of classical AI (heuristic search), robotics (motion planning), and cognitive science (spatial reasoning and navigation) — making it an ideal topic for demonstrating cross-domain understanding.

The implementation prioritises **readability over performance**: each planner is a self-contained Python file of under 80 lines, written to be read alongside the corresponding theory. The visualizer is designed to make the *difference* between algorithms immediately visible — why RRT\* produces a better path than RRT, and why A\* explores in a directed front rather than uniformly.

---

## References

- Hart, P., Nilsson, N., Raphael, B. (1968). *A Formal Basis for the Heuristic Determination of Minimum Cost Paths.* IEEE Transactions on Systems Science and Cybernetics.
- LaValle, S. M. (1998). *Rapidly-Exploring Random Trees: A New Tool for Path Planning.* Technical Report, Iowa State University.
- Karaman, S., Frazzoli, E. (2011). *Sampling-based Algorithms for Optimal Motion Planning.* International Journal of Robotics Research, 30(7).
- LaValle, S. M. (2006). *Planning Algorithms.* Cambridge University Press. (freely available at [planning.cs.uiuc.edu](http://planning.cs.uiuc.edu))

---

## License

MIT