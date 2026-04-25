# backend/planners/astar.py
import heapq, math

async def astar(grid, start, goal):
    ROWS, COLS = len(grid), len(grid[0])
    dirs = [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]

    dist = [[math.inf]*COLS for _ in range(ROWS)]
    prev = [[None]*COLS for _ in range(ROWS)]
    dist[start[0]][start[1]] = 0

    def h(r, c): return abs(r-goal[0]) + abs(c-goal[1])

    heap = [(h(*start), 0, start)]
    while heap:
        f, g, (r, c) = heapq.heappop(heap)
        if g > dist[r][c]: continue
        yield {"type": "explore", "data": [r, c]}   # stream each explored node

        if (r, c) == goal: break
        for dr, dc in dirs:
            nr, nc = r+dr, c+dc
            if 0<=nr<ROWS and 0<=nc<COLS and not grid[nr][nc]:
                cost = 1.414 if abs(dr)+abs(dc)==2 else 1
                ng = g + cost
                if ng < dist[nr][nc]:
                    dist[nr][nc] = ng
                    prev[nr][nc] = (r, c)
                    heapq.heappush(heap, (ng+h(nr,nc), ng, (nr,nc)))

    # Reconstruct and stream path
    path, cur = [], goal
    while cur:
        path.append(cur)
        cur = prev[cur[0]][cur[1]]
    path.reverse()
    yield {"type": "path", "data": path}