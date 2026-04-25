# backend/planners/rrt.py
import random, math

async def rrt(grid, start, goal, max_iter=3000, step=2.5, goal_thresh=2.0):
    ROWS, COLS = len(grid), len(grid[0])
    nodes = [start]
    parent = [-1]

    def nearest(q):
        return min(range(len(nodes)), key=lambda i: math.dist(nodes[i], q))

    def steer(n, q):
        ang = math.atan2(q[0]-n[0], q[1]-n[1])
        nr = n[0] + math.sin(ang)*step
        nc = n[1] + math.cos(ang)*step
        return (max(0, min(ROWS-1, nr)), max(0, min(COLS-1, nc)))

    for _ in range(max_iter):
        q = (random.uniform(0,ROWS), random.uniform(0,COLS)) \
            if random.random() > 0.1 else goal
        nidx = nearest(q)
        new = steer(nodes[nidx], q)
        if grid[int(new[0])][int(new[1])]: continue

        idx = len(nodes)
        nodes.append(new)
        parent.append(nidx)
        yield {"type": "edge", "data": [nodes[nidx], new]}

        if math.dist(new, goal) < goal_thresh:
            # backtrack path
            path, cur = [], idx
            while cur >= 0:
                path.append([round(nodes[cur][0]), round(nodes[cur][1])])
                cur = parent[cur]
            yield {"type": "path", "data": list(reversed(path))}
            return

    yield {"type": "path", "data": []}  # no path found