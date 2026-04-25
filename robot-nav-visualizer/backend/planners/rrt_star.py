# backend/planners/rrt_star.py
import random, math

async def rrt_star(grid, start, goal, max_iter=4000, step=2.5, goal_thresh=2.0, rewire_radius=4.0):
    ROWS, COLS = len(grid), len(grid[0])
    nodes = [start]
    parent = [-1]
    cost = [0.0]

    def dist(a, b):
        return math.hypot(a[0]-b[0], a[1]-b[1])

    def nearest(q):
        return min(range(len(nodes)), key=lambda i: dist(nodes[i], q))

    def near(q, radius):
        return [i for i, n in enumerate(nodes) if dist(n, q) <= radius]

    def steer(n, q):
        d = dist(n, q)
        if d < step:
            return q
        ang = math.atan2(q[0]-n[0], q[1]-n[1])
        nr = n[0] + math.sin(ang) * step
        nc = n[1] + math.cos(ang) * step
        return (max(0.0, min(ROWS-1.0, nr)), max(0.0, min(COLS-1.0, nc)))

    def collision_free(a, b, samples=8):
        for i in range(samples+1):
            t = i / samples
            r = int(a[0] + t*(b[0]-a[0]))
            c = int(a[1] + t*(b[1]-a[1]))
            if not (0 <= r < ROWS and 0 <= c < COLS): return False
            if grid[r][c]: return False
        return True

    best_goal_idx = -1
    best_goal_cost = math.inf

    for iteration in range(max_iter):
        # Sample: bias toward goal 10% of the time
        if random.random() < 0.10:
            q = (float(goal[0]), float(goal[1]))
        else:
            q = (random.uniform(0, ROWS), random.uniform(0, COLS))

        nidx = nearest(q)
        new = steer(nodes[nidx], q)

        if not collision_free(nodes[nidx], new):
            continue

        # Find nearby nodes for rewiring
        near_indices = near(new, rewire_radius)

        # Choose best parent from near nodes (core RRT* improvement over RRT)
        best_parent = nidx
        best_cost_to_new = cost[nidx] + dist(nodes[nidx], new)
        for i in near_indices:
            c_through_i = cost[i] + dist(nodes[i], new)
            if c_through_i < best_cost_to_new and collision_free(nodes[i], new):
                best_parent = i
                best_cost_to_new = c_through_i

        # Add new node
        new_idx = len(nodes)
        nodes.append(new)
        parent.append(best_parent)
        cost.append(best_cost_to_new)

        yield {"type": "edge", "data": [
            [round(nodes[best_parent][0]), round(nodes[best_parent][1])],
            [round(new[0]), round(new[1])]
        ]}

        # Rewire nearby nodes through new node if cheaper (core RRT* improvement)
        rewired = []
        for i in near_indices:
            c_through_new = best_cost_to_new + dist(new, nodes[i])
            if c_through_new < cost[i] and collision_free(new, nodes[i]):
                parent[i] = new_idx
                cost[i] = c_through_new
                rewired.append(i)

        if rewired:
            yield {"type": "rewire", "data": rewired}

        # Check if we reached goal — keep improving if a cheaper path exists
        d_to_goal = dist(new, goal)
        if d_to_goal < goal_thresh:
            total_cost = best_cost_to_new + d_to_goal
            if total_cost < best_goal_cost:
                best_goal_cost = total_cost
                best_goal_idx = new_idx
                # Stream the improved path immediately so the frontend can show it updating
                path = _reconstruct(nodes, parent, best_goal_idx, goal)
                yield {"type": "path", "data": path, "cost": round(best_cost_to_new, 2), "final": False}

    # Final best path
    if best_goal_idx >= 0:
        path = _reconstruct(nodes, parent, best_goal_idx, goal)
        yield {"type": "path", "data": path, "cost": round(best_goal_cost, 2), "final": True}
    else:
        yield {"type": "path", "data": [], "cost": None, "final": True}


def _reconstruct(nodes, parent, goal_idx, goal):
    path = [[round(float(goal[0])), round(float(goal[1]))]]
    cur = goal_idx
    while cur >= 0:
        path.append([round(nodes[cur][0]), round(nodes[cur][1])])
        cur = parent[cur]
    path.reverse()
    return path