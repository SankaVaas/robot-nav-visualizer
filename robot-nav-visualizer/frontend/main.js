import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const ROWS = 20, COLS = 30, CELL = 1.0;
const WS_URL = 'ws://localhost:8000/ws/plan';

// ─── State ────────────────────────────────────────────────────────────────────
let grid = makeGrid();
let startPos = [10, 1];
let goalPos  = [10, COLS - 2];
let algo = 'astar';
let view = '3d';
let ws = null;
let running = false;
let t0 = 0;

// 3D scene objects
let scene, camera, renderer, controls;
let cellMeshes = [];   // [r][c] → THREE.Mesh
let edgeLines  = [];   // accumulated RRT edge lines
let pathMesh   = null;
let startMesh  = null, goalMesh = null;

// 2D canvas state
let painting = false, paintVal = 1, dragging = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeGrid() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function setStats({ explored, length, cost, time, status } = {}) {
  if (explored !== undefined) document.getElementById('s-explored').textContent = explored;
  if (length   !== undefined) document.getElementById('s-length').textContent   = length;
  if (cost     !== undefined) document.getElementById('s-cost').textContent     = (cost !== null && cost !== '—' && typeof cost === 'number') ? cost.toFixed(1) : '—';
  if (time     !== undefined) document.getElementById('s-time').textContent     = time;
  if (status   !== undefined) document.getElementById('s-status').textContent   = status;
}

function resetStats() {
  setStats({ explored: '—', length: '—', cost: '—', time: '—', status: 'Ready' });
}

// ─── 3D Scene ─────────────────────────────────────────────────────────────────
function init3D() {
  const container = document.getElementById('view-container');
  const canvas    = document.getElementById('three-canvas');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);
  scene.fog = new THREE.Fog(0x111111, 40, 80);

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 200);
  camera.position.set(COLS * 0.5, 18, ROWS * 1.4);
  camera.lookAt(COLS * 0.5, 0, ROWS * 0.5);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(COLS * 0.5, 0, ROWS * 0.5);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(COLS * 0.5, 25, ROWS * 0.5);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  scene.add(dir);
  scene.add(new THREE.HemisphereLight(0x334455, 0x221100, 0.3));

  // Ground plane
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(COLS + 4, ROWS + 4),
    new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(COLS * 0.5 - 0.5, -0.05, ROWS * 0.5 - 0.5);
  ground.receiveShadow = true;
  scene.add(ground);

  build3DGrid();
  addMarkers();
  animate3D();

  document.getElementById('loading').style.display = 'none';

  window.addEventListener('resize', () => {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
}

function animate3D() {
  requestAnimationFrame(animate3D);
  controls.update();
  renderer.render(scene, camera);
}

// ─── 3D Grid ──────────────────────────────────────────────────────────────────
function makeMat(color) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.85,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0,
  });
}

function build3DGrid() {
  cellMeshes.forEach(row => row.forEach(m => { if (m) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); } }));
  cellMeshes = [];

  for (let r = 0; r < ROWS; r++) {
    cellMeshes[r] = [];
    for (let c = 0; c < COLS; c++) {
      const isObs = grid[r][c];
      const h     = isObs ? 1.6 : 0.12;
      const geo   = new THREE.BoxGeometry(CELL * 0.9, h, CELL * 0.9);
      const mat   = makeMat(isObs ? 0x3a3836 : 0x1e1e1c);
      const mesh  = new THREE.Mesh(geo, mat);
      mesh.position.set(c, h / 2, r);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      cellMeshes[r][c] = mesh;
    }
  }
}

function refreshCell(r, c) {
  const mesh = cellMeshes[r]?.[c];
  if (!mesh) return;
  const isObs = grid[r][c];
  const h     = isObs ? 1.6 : 0.12;
  mesh.geometry.dispose();
  mesh.geometry = new THREE.BoxGeometry(CELL * 0.9, h, CELL * 0.9);
  mesh.position.y = h / 2;
  mesh.material.color.set(isObs ? 0x3a3836 : 0x1e1e1c);
  mesh.material.emissive?.set(0x000000);
}

// ─── Start / Goal markers ─────────────────────────────────────────────────────
function addMarkers() {
  [startMesh, goalMesh].forEach(m => { if (m) scene.remove(m); });

  const mkMarker = (color) => {
    const geo = new THREE.CylinderGeometry(0.35, 0.45, 1.4, 8);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.5 });
    const m   = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    scene.add(m);
    return m;
  };
  startMesh = mkMarker(0x1D9E75);
  goalMesh  = mkMarker(0xD85A30);
  positionMarkers();
}

function positionMarkers() {
  if (startMesh) startMesh.position.set(startPos[1], 0.7, startPos[0]);
  if (goalMesh)  goalMesh.position.set(goalPos[1],   0.7, goalPos[0]);
}

// ─── Path rendering ───────────────────────────────────────────────────────────
function drawPath3D(pathCells) {
  if (pathMesh) { scene.remove(pathMesh); pathMesh = null; }
  if (!pathCells || pathCells.length < 2) return;

  const pts = pathCells.map(([r, c]) => new THREE.Vector3(c, 0.4, r));
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo   = new THREE.TubeGeometry(curve, pts.length * 5, 0.15, 8, false);
  const mat   = new THREE.MeshStandardMaterial({
    color: 0x7F77DD, emissive: 0x3C3489, emissiveIntensity: 0.5, roughness: 0.4
  });
  pathMesh = new THREE.Mesh(geo, mat);
  scene.add(pathMesh);
}

// ─── Explored cell highlight ──────────────────────────────────────────────────
let exploredCount = 0;
function highlightExplored(r, c) {
  const mesh = cellMeshes[r]?.[c];
  if (!mesh || grid[r][c]) return;
  mesh.material.color.set(0x185FA5);
  mesh.material.emissive.set(0x0c2a50);
  mesh.material.emissiveIntensity = 0.3;
  exploredCount++;
  document.getElementById('s-explored').textContent = exploredCount;
}

// ─── RRT edges ────────────────────────────────────────────────────────────────
function addEdge(a, b, color = 0x378ADD) {
  const pts = [
    new THREE.Vector3(a[1], 0.25, a[0]),
    new THREE.Vector3(b[1], 0.25, b[0]),
  ];
  const geo  = new THREE.BufferGeometry().setFromPoints(pts);
  const mat  = new THREE.LineBasicMaterial({ color, opacity: 0.45, transparent: true });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  edgeLines.push(line);
}

function clearEdges() {
  edgeLines.forEach(l => scene.remove(l));
  edgeLines = [];
}

// ─── Animation cancel token ───────────────────────────────────────────────────
let animGeneration = 0;   // increment to cancel any in-flight animateExplored

// ─── Clear visual state ───────────────────────────────────────────────────────
function clearVisuals() {
  animGeneration++;        // invalidates any running animateExplored loop
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const mesh = cellMeshes[r]?.[c];
      if (!mesh) continue;
      mesh.material.color.set(grid[r][c] ? 0x3a3836 : 0x1e1e1c);
      mesh.material.emissive.set(0x000000);
      mesh.material.emissiveIntensity = 0;
    }
  }
  if (pathMesh) { scene.remove(pathMesh); pathMesh = null; }
  clearEdges();
  exploredCount = 0;
}

// ─── WebSocket planning ───────────────────────────────────────────────────────
function runAlgo() {
  if (running) return;
  clearVisuals();
  resetStats();
  t0 = performance.now();
  exploredCount = 0;

  // Try to connect; fall back to local immediately if it fails
  let wsConnected = false;

  if (ws) { try { ws.close(); } catch(_) {} ws = null; }

  setStats({ status: 'Connecting…' });

  // Attempt WS connection with a short timeout
  const connectTimeout = setTimeout(() => {
    if (!wsConnected) {
      if (ws) { try { ws.close(); } catch(_) {} ws = null; }
      running = false;
      setStats({ status: 'No backend — local mode' });
      runLocalFallback();
    }
  }, 8000);

  try {
    ws = new WebSocket(WS_URL);
  } catch(_) {
    clearTimeout(connectTimeout);
    setStats({ status: 'No backend — local mode' });
    runLocalFallback();
    return;
  }

  ws.onopen = () => {
    wsConnected = true;
    clearTimeout(connectTimeout);
    running = true;
    setStats({ status: 'Running…' });
    ws.send(JSON.stringify({ grid, start: startPos, goal: goalPos, algo }));
  };

  ws.onerror = () => {
    clearTimeout(connectTimeout);
    if (!wsConnected) {
      running = false;
      setStats({ status: 'No backend — local mode' });
      runLocalFallback();
    }
  };

  ws.onclose = () => {
    if (wsConnected) running = false;
  };

  ws.onmessage = ({ data }) => {
    const ev = JSON.parse(data);
    handleEvent(ev);
  };
}

function handleEvent(ev) {
  if (ev.type === 'explore') {
    highlightExplored(ev.data[0], ev.data[1]);
  } else if (ev.type === 'edge') {
    addEdge(ev.data[0], ev.data[1]);
  } else if (ev.type === 'rewire') {
    // flash rewired edges amber
    ev.data.forEach(idx => {
      const m = cellMeshes[Math.round(idx)]?.[0];
    });
  } else if (ev.type === 'path') {
    drawPath3D(ev.data);
    const elapsed = Math.round(performance.now() - t0);
    const len = ev.data.length;
    setStats({
      length: len > 1 ? len : 'No path',
      cost:   ev.cost ?? null,
      time:   elapsed,
      status: ev.final ? (len > 1 ? 'Done ✓' : 'No path found') : 'Improving…'
    });
    if (ev.final) running = false;
  }
}

// ─── Local fallback (runs in-browser when no backend) ─────────────────────────
function runLocalFallback() {
  running = true;
  exploredCount = 0;
  t0 = performance.now();

  if (algo === 'astar') {
    const { explored, path } = localAstar();
    animateExplored(explored, path);
  } else {
    const { edges, path } = localRRT(algo === 'rrt_star');
    edges.forEach(([a, b]) => addEdge(a, b));
    drawPath3D(path);
    running = false;
    setStats({
      explored: edges.length,
      length: path.length > 1 ? path.length : 'No path',
      cost: null,
      time: Math.round(performance.now() - t0),
      status: path.length > 1 ? 'Done ✓ (local)' : 'No path (local)'
    });
  }
}

function animateExplored(explored, path) {
  const myGen = animGeneration;   // capture at start — if clearVisuals() runs, myGen !== animGeneration
  const skip  = Math.max(1, Math.floor(explored.length / 150));
  let frame = 0;

  function step() {
    if (animGeneration !== myGen) return;   // cancelled — bail silently
    for (let i = 0; i < skip && frame < explored.length; i++, frame++) {
      highlightExplored(explored[frame][0], explored[frame][1]);
    }
    if (frame < explored.length) {
      setTimeout(step, 10);
    } else {
      if (animGeneration !== myGen) return;
      drawPath3D(path);
      running = false;
      setStats({
        explored: explored.length,
        length: path.length > 1 ? path.length : 'No path',
        cost: null,
        time: Math.round(performance.now() - t0),
        status: path.length > 1 ? 'Done ✓ (local)' : 'No path (local)'
      });
    }
  }
  step();
}

function localAstar() {
  const INF = Infinity;
  const dist = Array.from({ length: ROWS }, () => Array(COLS).fill(INF));
  const prev = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const [sr, sc] = startPos, [gr, gc] = goalPos;
  dist[sr][sc] = 0;
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
  const h = (r, c) => Math.abs(r - gr) + Math.abs(c - gc);
  const open = [[h(sr, sc), 0, sr, sc]];
  const explored = [];

  while (open.length) {
    open.sort((a, b) => a[0] - b[0]);
    const [, g, r, c] = open.shift();
    if (g > dist[r][c]) continue;
    explored.push([r, c]);
    if (r === gr && c === gc) break;
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || grid[nr][nc]) continue;
      const ng = g + (Math.abs(dr) + Math.abs(dc) > 1 ? 1.414 : 1);
      if (ng < dist[nr][nc]) {
        dist[nr][nc] = ng; prev[nr][nc] = [r, c];
        open.push([ng + h(nr, nc), ng, nr, nc]);
      }
    }
  }

  const path = []; let cur = [gr, gc];
  while (cur) { path.unshift(cur); cur = prev[cur[0]][cur[1]]; }
  return { explored, path: dist[gr][gc] < INF ? path : [] };
}

function localRRT(star = false) {
  const [sr, sc] = startPos, [gr, gc] = goalPos;
  const nodes = [[sr, sc]], parent = [-1], cost = [0];
  const edges = [], MAX = 3000, STEP = 2.5, GTHR = 2.0, RR = 4.0;

  const d = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1]);

  for (let i = 0; i < MAX; i++) {
    const q = Math.random() < 0.1
      ? [gr, gc]
      : [Math.random() * ROWS, Math.random() * COLS];

    let ni = 0, bd = Infinity;
    nodes.forEach((n, k) => { const dd = d(n, q); if (dd < bd) { bd = dd; ni = k; } });

    const ang = Math.atan2(q[0]-nodes[ni][0], q[1]-nodes[ni][1]);
    const nr  = Math.max(0, Math.min(ROWS-1, nodes[ni][0] + Math.sin(ang)*STEP));
    const nc  = Math.max(0, Math.min(COLS-1, nodes[ni][1] + Math.cos(ang)*STEP));
    if (grid[Math.round(nr)]?.[Math.round(nc)]) continue;

    const newNode = [nr, nc];
    let bestParent = ni, bestCost = cost[ni] + d(nodes[ni], newNode);

    if (star) {
      nodes.forEach((n, k) => {
        const c2 = cost[k] + d(n, newNode);
        if (d(n, newNode) < RR && c2 < bestCost && !grid[Math.round(n[0])]?.[Math.round(n[1])]) {
          bestCost = c2; bestParent = k;
        }
      });
    }

    const idx = nodes.length;
    nodes.push(newNode); parent.push(bestParent); cost.push(bestCost);
    edges.push([
      [Math.round(nodes[bestParent][0]), Math.round(nodes[bestParent][1])],
      [Math.round(nr), Math.round(nc)]
    ]);

    if (star) {
      nodes.forEach((n, k) => {
        const c2 = bestCost + d(newNode, n);
        if (d(newNode, n) < RR && c2 < cost[k]) { parent[k] = idx; cost[k] = c2; }
      });
    }

    if (d(newNode, [gr, gc]) < GTHR) {
      const path = []; let cur = idx;
      while (cur >= 0) { path.push([Math.round(nodes[cur][0]), Math.round(nodes[cur][1])]); cur = parent[cur]; }
      return { edges, path: path.reverse() };
    }
  }
  return { edges, path: [] };
}

// ─── 2D Canvas view ───────────────────────────────────────────────────────────
const C2 = document.getElementById('canvas-2d');
const ctx = C2.getContext('2d');
const CELL2 = 24;

function resize2D() {
  C2.width  = COLS * CELL2;
  C2.height = ROWS * CELL2;
  C2.style.width  = C2.width  + 'px';
  C2.style.height = C2.height + 'px';
}

let explored2D = [], path2D = [], edges2D = [];

function draw2D() {
  ctx.clearRect(0, 0, C2.width, C2.height);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ctx.fillStyle = grid[r][c] ? '#3a3836' : '#1e1e1c';
      ctx.fillRect(c*CELL2, r*CELL2, CELL2, CELL2);
      ctx.strokeStyle = '#2a2a28'; ctx.lineWidth = 0.5;
      ctx.strokeRect(c*CELL2+0.5, r*CELL2+0.5, CELL2-1, CELL2-1);
    }
  }
  explored2D.forEach(([r,c]) => {
    ctx.fillStyle = 'rgba(55,138,221,0.28)';
    ctx.fillRect(c*CELL2+1, r*CELL2+1, CELL2-2, CELL2-2);
  });
  edges2D.forEach(([a,b]) => {
    ctx.strokeStyle = 'rgba(55,138,221,0.4)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a[1]*CELL2 + CELL2/2, a[0]*CELL2 + CELL2/2);
    ctx.lineTo(b[1]*CELL2 + CELL2/2, b[0]*CELL2 + CELL2/2);
    ctx.stroke();
  });
  if (path2D.length > 1) {
    ctx.strokeStyle = '#7F77DD'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.beginPath();
    path2D.forEach(([r,c],i) => {
      const x = c*CELL2+CELL2/2, y = r*CELL2+CELL2/2;
      i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    });
    ctx.stroke();
  }
  // Markers
  [[startPos, '#1D9E75','S'],[goalPos,'#D85A30','G']].forEach(([[r,c],col,lbl]) => {
    const x = c*CELL2+CELL2/2, y = r*CELL2+CELL2/2;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, CELL2/2-1, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(lbl, x, y);
  });
}

function cellAt2D(e) {
  const rect = C2.getBoundingClientRect();
  return [Math.floor((e.clientY-rect.top)/CELL2), Math.floor((e.clientX-rect.left)/CELL2)];
}

C2.addEventListener('mousedown', e => {
  const [r,c] = cellAt2D(e);
  if (r===startPos[0]&&c===startPos[1]) { dragging='start'; return; }
  if (r===goalPos[0] &&c===goalPos[1])  { dragging='goal';  return; }
  painting = true; paintVal = grid[r][c] ? 0 : 1;
  grid[r][c] = paintVal;
  explored2D = []; path2D = []; edges2D = [];
  resetStats(); draw2D();
});
C2.addEventListener('mousemove', e => {
  const [r,c] = cellAt2D(e);
  if (r<0||r>=ROWS||c<0||c>=COLS) return;
  if (dragging) {
    if (dragging==='start') startPos=[r,c]; else goalPos=[r,c];
    explored2D=[]; path2D=[]; edges2D=[];
    resetStats(); draw2D(); return;
  }
  if (painting && !(r===startPos[0]&&c===startPos[1]) && !(r===goalPos[0]&&c===goalPos[1])) {
    grid[r][c] = paintVal; draw2D();
  }
});
C2.addEventListener('mouseup',   () => { painting=false; dragging=null; });
C2.addEventListener('mouseleave',() => { painting=false; dragging=null; });

// ─── View switching ───────────────────────────────────────────────────────────
function switchView(v) {
  view = v;
  document.getElementById('three-canvas').style.display = v === '3d' ? 'block' : 'none';
  C2.style.display = v === '2d' ? 'block' : 'none';
  if (v === '2d') { resize2D(); draw2D(); }
  document.querySelectorAll('#view-seg button').forEach(b => {
    b.classList.toggle('active', b.dataset.view === v);
  });
  document.getElementById('hint').textContent = v === '3d'
    ? 'Click grid cells to toggle obstacles · Drag S or G markers to reposition · Orbit: drag · Zoom: scroll'
    : 'Click cells to toggle obstacles · Drag S or G to move · Switch to 3D for the full view';
}

// ─── Controls ─────────────────────────────────────────────────────────────────
document.getElementById('algo-seg').addEventListener('click', e => {
  if (!e.target.dataset.algo) return;
  algo = e.target.dataset.algo;
  document.querySelectorAll('#algo-seg button').forEach(b => b.classList.toggle('active', b.dataset.algo===algo));
  clearVisuals(); if (view==='2d') { explored2D=[]; path2D=[]; edges2D=[]; draw2D(); }
  resetStats();
});

document.getElementById('view-seg').addEventListener('click', e => {
  if (e.target.dataset.view) switchView(e.target.dataset.view);
});

document.getElementById('run-btn').addEventListener('click', () => {
  if (view === '2d') runLocal2D(); else runAlgo();
});

document.getElementById('clear-btn').addEventListener('click', () => {
  clearVisuals(); explored2D=[]; path2D=[]; edges2D=[];
  if (view==='2d') draw2D();
  resetStats();
});

document.getElementById('reset-btn').addEventListener('click', () => {
  grid = makeGrid(); startPos=[10,1]; goalPos=[10,COLS-2];
  clearVisuals(); build3DGrid(); addMarkers();
  explored2D=[]; path2D=[]; edges2D=[];
  if (view==='2d') draw2D();
  resetStats();
});

document.getElementById('random-btn').addEventListener('click', () => {
  grid = makeGrid();
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
    const nearStart = Math.hypot(r-startPos[0],c-startPos[1]) < 2.5;
    const nearGoal  = Math.hypot(r-goalPos[0], c-goalPos[1])  < 2.5;
    if (!nearStart && !nearGoal && Math.random() < 0.27) grid[r][c]=1;
  }
  clearVisuals(); build3DGrid(); addMarkers();
  explored2D=[]; path2D=[]; edges2D=[];
  if (view==='2d') draw2D();
  resetStats();
});

// ─── 2D local run (no WebSocket needed) ──────────────────────────────────────
function runLocal2D() {
  explored2D=[]; path2D=[]; edges2D=[];
  draw2D(); resetStats();
  setStats({ status: 'Running…' });
  const t = performance.now();

  if (algo === 'astar') {
    const { explored, path } = localAstar();
    let frame = 0;
    const skip = Math.max(1, Math.floor(explored.length/120));
    function step() {
      for (let i=0;i<skip&&frame<explored.length;i++) explored2D.push(explored[frame++]);
      draw2D();
      if (frame<explored.length) { setTimeout(step,8); return; }
      path2D = path; draw2D();
      setStats({ explored:explored.length, length:path.length>1?path.length:'No path', cost:null, time:Math.round(performance.now()-t), status:path.length>1?'Done ✓':'No path found' });
    }
    step();
  } else {
    const { edges, path } = localRRT(algo==='rrt_star');
    edges2D = edges; path2D = path; draw2D();
    setStats({ explored:edges.length, length:path.length>1?path.length:'No path', cost:null, time:Math.round(performance.now()-t), status:path.length>1?'Done ✓':'No path found' });
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
init3D();
switchView('3d');