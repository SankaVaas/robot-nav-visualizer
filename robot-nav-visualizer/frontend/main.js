// frontend/main.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CELL = 1;
let scene, camera, renderer, controls;
let cellMeshes = [];       // [row][col] → mesh
let pathLine = null;
let ws = null;

export function initScene(container) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);

  camera = new THREE.PerspectiveCamera(50, container.clientWidth/container.clientHeight, 0.1, 500);
  camera.position.set(15, 20, 25);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  // Ambient + directional light
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(10, 20, 10);
  scene.add(dir);

  animate();
}

export function buildGrid(grid) {
  // Clear old meshes
  cellMeshes.forEach(row => row.forEach(m => scene.remove(m)));
  cellMeshes = [];

  const ROWS = grid.length, COLS = grid[0].length;
  for (let r = 0; r < ROWS; r++) {
    cellMeshes[r] = [];
    for (let c = 0; c < COLS; c++) {
      const isObs = grid[r][c];
      const geo = new THREE.BoxGeometry(CELL*0.92, isObs ? 1.5 : 0.1, CELL*0.92);
      const mat = new THREE.MeshStandardMaterial({
        color: isObs ? 0x444441 : 0x2a2a28,
        roughness: 0.8,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(c*CELL, isObs ? 0.75 : 0.05, r*CELL);
      scene.add(mesh);
      cellMeshes[r][c] = mesh;
    }
  }
}

export function highlightExplored(r, c) {
  const m = cellMeshes[r]?.[c];
  if (m) m.material.color.setHex(0x185FA5);   // blue
}

export function drawPath(pathCells) {
  if (pathLine) scene.remove(pathLine);
  if (!pathCells.length) return;

  const points = pathCells.map(([r,c]) => new THREE.Vector3(c*CELL, 0.3, r*CELL));
  const curve  = new THREE.CatmullRomCurve3(points);
  const geo    = new THREE.TubeGeometry(curve, points.length*4, 0.12, 8, false);
  const mat    = new THREE.MeshStandardMaterial({ color: 0x7F77DD, emissive: 0x3C3489, emissiveIntensity: 0.4 });
  pathLine = new THREE.Mesh(geo, mat);
  scene.add(pathLine);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// WebSocket connection to FastAPI
export function connectAndPlan(grid, start, goal, algo, onStats) {
  if (ws) ws.close();
  ws = new WebSocket('ws://localhost:8000/ws/plan');
  const t0 = performance.now();
  let explored = 0;

  ws.onopen = () => {
    ws.send(JSON.stringify({ grid, start, goal, algo }));
  };

  ws.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.type === 'explore') {
      highlightExplored(...event.data);
      explored++;
      onStats({ explored });
    } else if (event.type === 'edge') {
      // draw RRT edge as thin line
      const [a, b] = event.data;
      const pts = [new THREE.Vector3(a[1], 0.2, a[0]), new THREE.Vector3(b[1], 0.2, b[0])];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x378ADD, opacity: 0.4, transparent: true })));
    } else if (event.type === 'path') {
      drawPath(event.data);
      onStats({ explored, length: event.data.length, time: Math.round(performance.now()-t0) });
    }
  };
}