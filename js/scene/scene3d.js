// 3D scene: sea, islands, sky, lighting, orbit camera. "Readable realism":
// conditions must be legible (wind strength from the water, trim from the
// sails) at iPad-friendly frame rates — no expensive reflections.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { llToWorld, dirToVec, clamp, NM_M } from '../util/geo.js';

const SKY = 0xbfd8e8;
const SEA_DEEP = new THREE.Color(0x12526e);
const SEA_LIGHT = new THREE.Color(0x2e7d9e);

export class Scene3D {
  constructor(canvas, world) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 4000, 26000);

    this.camera = new THREE.PerspectiveCamera(55, 1, 1, 60000);
    this.camera.position.set(20, 9, 30);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 9;
    this.controls.maxDistance = 1200;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.enablePan = false;

    // lighting: tropical sun from the NE, soft sky fill
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
    sun.position.set(2000, 3000, -1500);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xcfe5f2, 0x3a5f6e, 0.9));
    this.sunDir = sun.position.clone().normalize();

    this._buildSea();
    this._buildIslands(world);
    this._buildLabels(world);
    this._buildNav();
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _buildSea() {
    const geo = new THREE.PlaneGeometry(9000, 9000, 140, 140);
    geo.rotateX(-Math.PI / 2);
    this.seaUniforms = {
      uTime: { value: 0 },
      uWaveAmp: { value: 0.4 },
      uWindTo: { value: new THREE.Vector2(0, 1) },
      uWhitecap: { value: 0 },
      uSunDir: { value: this.sunDir },
      uDeep: { value: SEA_DEEP },
      uLight: { value: SEA_LIGHT },
      uFogColor: { value: new THREE.Color(SKY) },
      uCamPos: { value: new THREE.Vector3() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.seaUniforms,
      vertexShader: SEA_VERT,
      fragmentShader: SEA_FRAG,
    });
    this.sea = new THREE.Mesh(geo, mat);
    this.sea.frustumCulled = false;
    this.scene.add(this.sea);

    // distant flat sea so the horizon never shows an edge
    const far = new THREE.Mesh(
      new THREE.CircleGeometry(55000, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: SEA_DEEP, fog: true })
    );
    far.position.y = -3.2; // below the deepest wave trough or it pokes through
    this.scene.add(far);
  }

  _buildIslands(world) {
    const landMat = new THREE.MeshLambertMaterial({ color: 0x6f8f5a });
    const sandMat = new THREE.MeshLambertMaterial({ color: 0xd9cba0 });
    const group = new THREE.Group();

    for (const poly of world.landPolys) {
      const shape = new THREE.Shape();
      poly.pts.forEach((p, i) => {
        // Shape XY: x = east, y = north(-z); extrude +Z becomes +Y after rotateX
        if (i === 0) shape.moveTo(p.x, -p.z); else shape.lineTo(p.x, -p.z);
      });
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 7, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, poly.kind === 'mainland' ? sandMat : landMat);
      mesh.position.y = -0.5;
      group.add(mesh);
      // sandy skirt at the waterline for readability
      const edge = new THREE.Mesh(geo.clone(), sandMat);
      edge.scale.y = 0.3;
      edge.position.y = -0.4;
      group.add(edge);
    }

    // hills/peaks: smooth cones at hand-tagged summits (data/chart-detail.json)
    const hillMat = new THREE.MeshLambertMaterial({ color: 0x5e7f4e });
    for (const pk of world.detail.peaks) {
      const w = llToWorld(pk.lon, pk.lat);
      const geo = new THREE.ConeGeometry(pk.radiusM, pk.heightM, 24, 6);
      // round the silhouette: pull mid vertices outward (dome-ish)
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const t = (y / pk.heightM) + 0.5; // 0 base → 1 tip
        const bulge = 1 + 0.45 * Math.sin(t * Math.PI);
        pos.setX(i, pos.getX(i) * bulge);
        pos.setZ(i, pos.getZ(i) * bulge);
      }
      geo.computeVertexNormals();
      const cone = new THREE.Mesh(geo, hillMat);
      cone.position.set(w.x, pk.heightM / 2 - 2, w.z);
      group.add(cone);
    }
    this.scene.add(group);
  }

  // Chart-style annotations for the aerial view: anchorage and place-name
  // sprites at constant screen size, hidden in the normal 3D view.
  _buildLabels(world) {
    this.labels = new THREE.Group();
    this.labels.visible = false;

    // shallow-water tint, same role as the chart's reef/shoal patches
    const shallowMat = new THREE.MeshBasicMaterial({
      color: 0x86d8d4, transparent: true, opacity: 0.3,
      depthTest: false, side: THREE.DoubleSide,
    });
    for (const reef of world.reefPolys) {
      const shape = new THREE.Shape();
      reef.pts.forEach((p, i) => i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z));
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), shallowMat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 2.5; // above the wave tops; depthTest off keeps it visible
      m.renderOrder = 5;
      this.labels.add(m);
    }
    for (const s of world.shoals) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(s.radiusM, 32), shallowMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(s.x, 2.5, s.z);
      m.renderOrder = 5;
      this.labels.add(m);
    }

    for (const a of world.anchorages) {
      this.labels.add(textSprite('⚓ ' + a.name, a.x, a.z, { color: '#ffd27d' }));
    }
    for (const l of world.detail.labels) {
      const w = llToWorld(l.lon, l.lat);
      this.labels.add(textSprite(l.name, w.x, w.z, { color: '#e8f2fa', size: 22 + (l.size ?? 12) }));
    }
    this.destSprite = null; // built lazily, follows state.destination

    // chart-style boat marker: constant-size triangle, rotates with heading
    const cv = document.createElement('canvas');
    cv.width = cv.height = 48;
    const ctx = cv.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(24, 3); ctx.lineTo(40, 44); ctx.lineTo(24, 36); ctx.lineTo(8, 44);
    ctx.closePath();
    ctx.fillStyle = '#ffcf4d';
    ctx.strokeStyle = '#1d2c3a'; ctx.lineWidth = 3;
    ctx.fill(); ctx.stroke();
    this.boatMark = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(cv),
      sizeAttenuation: false, depthTest: false, transparent: true,
    }));
    this.boatMark.scale.set(0.04, 0.04, 1);
    this.boatMark.renderOrder = 11;
    this.labels.add(this.boatMark);

    // wind reference arrow (points downwind, the way the breeze blows), so the
    // aerial view has an unambiguous wind direction even though it's north-up
    this.windArrow = makeFlatArrow(0x3fa9ff);
    this.labels.add(this.windArrow);
    this.windLabel = textSprite('WIND', 0, 0, { color: '#bfe4ff', size: 22 });
    this.labels.add(this.windLabel);

    this.scene.add(this.labels);
  }

  // Navigation overlays drawn on the water, visible in both views: the past
  // track (pink), the heading line (red dashed, where the bow points) and the
  // course-over-ground projection (white band, where the boat is actually
  // going — leeway + current included). Updated per frame via updateNav().
  _buildNav() {
    this.nav = new THREE.Group();

    this.MAXTRACK = 2000;
    this.trackGeo = new THREE.BufferGeometry();
    this.trackGeo.setAttribute('position',
      new THREE.Float32BufferAttribute(new Float32Array(this.MAXTRACK * 3), 3));
    this.trackLine = new THREE.Line(this.trackGeo,
      new THREE.LineBasicMaterial({ color: 0xff5fa8, depthTest: false, transparent: true }));
    this.trackLine.frustumCulled = false;
    this.trackLine.renderOrder = 6;
    this.nav.add(this.trackLine);

    this.courseBand = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.26,
        depthTest: false, side: THREE.DoubleSide,
      }));
    this.courseBand.renderOrder = 6;
    this.nav.add(this.courseBand);

    this.headingGeo = new THREE.BufferGeometry();
    this.headingGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    this.headingLine = new THREE.Line(this.headingGeo,
      new THREE.LineDashedMaterial({
        color: 0xff2a2a, dashSize: 26, gapSize: 18,
        depthTest: false, transparent: true,
      }));
    this.headingLine.frustumCulled = false;
    this.headingLine.renderOrder = 7;
    this.nav.add(this.headingLine);

    this.scene.add(this.nav);
  }

  updateNav(boat, track) {
    // past track
    const n = Math.min(track.length, this.MAXTRACK);
    const tp = this.trackGeo.attributes.position;
    for (let i = 0; i < n; i++) tp.setXYZ(i, track[i].x, 0.8, track[i].z);
    this.trackGeo.setDrawRange(0, n);
    tp.needsUpdate = true;

    // heading line (bow direction)
    const hv = dirToVec(boat.headingDeg);
    const hp = this.headingGeo.attributes.position;
    hp.setXYZ(0, boat.x, 1.0, boat.z);
    hp.setXYZ(1, boat.x + hv.x * 700, 1.0, boat.z + hv.z * 700);
    hp.needsUpdate = true;
    this.headingLine.computeLineDistances();

    // COG band: 6-minute projection over ground, same convention as the chart
    const len = clamp(boat.sogKn * NM_M / 10, 160, 1400);
    const cv = dirToVec(boat.cogDeg);
    this.courseBand.visible = boat.sogKn > 0.3;
    this.courseBand.position.set(boat.x + cv.x * len / 2, 0.9, boat.z + cv.z * len / 2);
    this.courseBand.rotation.y = (90 - boat.cogDeg) * Math.PI / 180;
    this.courseBand.scale.set(len, 1, 34);
  }

  // Destination marker in the aerial view; cheap no-op unless it changed.
  setDestination(dest) {
    if ((dest?.name ?? null) === this._destName) return;
    this._destName = dest?.name ?? null;
    if (this.destSprite) { this.labels.remove(this.destSprite); this.destSprite = null; }
    if (dest) {
      this.destSprite = textSprite('◎ ' + dest.name, dest.x, dest.z,
        { color: '#7dd87d', size: 34 });
      this.labels.add(this.destSprite);
    }
  }

  // Per-frame: t sim seconds; windKn/windFromDeg/chop drive the sea state.
  update(dt, t, boatPos, windKn, windFromDeg, chop) {
    // sea follows the boat on a snapped grid so the shader stays in world space
    this.sea.position.x = Math.round(boatPos.x / 50) * 50;
    this.sea.position.z = Math.round(boatPos.z / 50) * 50;

    const u = this.seaUniforms;
    u.uTime.value = t;
    // wave amplitude grows with wind; chop (wind-against-tide) steepens it
    u.uWaveAmp.value = 0.12 + Math.pow(windKn / 25, 1.5) * 1.5 + chop * 0.5;
    const toRad = (windFromDeg + 180) * Math.PI / 180;
    u.uWindTo.value.set(Math.sin(toRad), -Math.cos(toRad));
    // whitecaps appear above ~12 kn, plentiful by 25; chop boosts locally
    u.uWhitecap.value = Math.max(0, (windKn - 12) / 18) + chop * 0.6;
    u.uCamPos.value.copy(this.camera.position);

    if (this.labels.visible) {
      this.boatMark.position.set(boatPos.x, 4, boatPos.z);
      // screen-up is north (minus the user's map rotation); heading is CW
      this.boatMark.material.rotation =
        this.controls.getAzimuthalAngle() - boatPos.headingDeg * Math.PI / 180;
      // wind arrow follows the boat, pointing downwind
      const downwind = windFromDeg + 180;
      this.windArrow.position.set(boatPos.x, 1.1, boatPos.z);
      this.windArrow.rotation.y = (90 - downwind) * Math.PI / 180;
      const dv = dirToVec(downwind);
      this.windLabel.position.set(boatPos.x + dv.x * 330, 7, boatPos.z + dv.z * 330);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // keep the orbit centred on the boat while preserving the user's view angle
  follow(p) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.set(p.x, 2, p.z);
    this.camera.position.copy(this.controls.target).add(offset);
  }

  // Top-down aerial view: clamp the orbit to straight down (tiny epsilon so
  // OrbitControls keeps a stable azimuth); pinch/scroll still zooms, drag
  // rotates the map. Shows chart-style labels, allows zooming much further
  // out (fog pushed back so land stays visible). Toggling off restores the
  // saved perspective view.
  setTopDown(on) {
    this.labels.visible = on;
    const t = this.controls.target;
    if (on) {
      this._savedOffset = this.camera.position.clone().sub(t);
      this.controls.maxPolarAngle = 0.001;
      this.controls.minAzimuthAngle = 0; // lock north-up, like the chart
      this.controls.maxAzimuthAngle = 0;
      this.controls.maxDistance = 4500; // sea plane is ±4.5 km around the boat
      this.scene.fog.near = 30000; this.scene.fog.far = 80000;
      const d = 2500;
      this.camera.position.set(t.x, t.y + d, t.z + d * 0.001);
    } else {
      this.controls.maxPolarAngle = Math.PI * 0.49;
      this.controls.minAzimuthAngle = -Infinity;
      this.controls.maxAzimuthAngle = Infinity;
      this.controls.maxDistance = 1200;
      this.scene.fog.near = 4000; this.scene.fog.far = 26000;
      if (this._savedOffset) this.camera.position.copy(t).add(this._savedOffset);
    }
  }
}

// Billboard text at constant screen size (sizeAttenuation: false), drawn on
// top of the scene — same role as the chart's labels, but in the 3D world.
function textSprite(text, x, z, { color = '#fff', size = 26 } = {}) {
  const pad = 8;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const font = `600 ${size}px system-ui, sans-serif`;
  ctx.font = font;
  cv.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  cv.height = size + pad * 2;
  ctx.font = font; // canvas resize resets state
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(12, 28, 42, 0.55)';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = color;
  ctx.fillText(text, pad, cv.height / 2);
  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv),
    sizeAttenuation: false, depthTest: false, transparent: true,
  });
  const sp = new THREE.Sprite(mat);
  const h = 0.045; // fraction of viewport height
  sp.scale.set(h * cv.width / cv.height, h, 1);
  sp.center.set(0.5, -0.5); // float the text above the point it marks
  sp.position.set(x, 4, z);
  sp.renderOrder = 10;
  return sp;
}

// Flat filled arrow lying in the XZ plane, pointing +x (rotate via .rotation.y
// to a compass bearing with (90 - deg)°). Used for the wind indicator.
function makeFlatArrow(color, len = 280, w = 64) {
  const shaft = w * 0.4, hlen = len * 0.34;
  const s = new THREE.Shape();
  s.moveTo(0, -shaft / 2);
  s.lineTo(len - hlen, -shaft / 2);
  s.lineTo(len - hlen, -w / 2);
  s.lineTo(len, 0);
  s.lineTo(len - hlen, w / 2);
  s.lineTo(len - hlen, shaft / 2);
  s.lineTo(0, shaft / 2);
  s.closePath();
  const geo = new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2); // into XZ, points +x
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.85,
    depthTest: false, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 7;
  return m;
}

const SEA_VERT = /* glsl */`
uniform float uTime;
uniform float uWaveAmp;
uniform vec2 uWindTo;
varying vec3 vWorld;
varying float vCrest;

// 4 directional gerstner-ish sine waves, aligned around the wind direction
float wave(vec2 p, vec2 dir, float len, float speed, float t) {
  return sin(dot(p, dir) * (6.28318 / len) + t * speed);
}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p = wp.xz;
  vec2 w = normalize(uWindTo);
  vec2 w2 = normalize(w + vec2(-w.y, w.x) * 0.45);
  vec2 w3 = normalize(w + vec2(w.y, -w.x) * 0.45);
  float h = 0.0;
  h += 0.50 * wave(p, w,  34.0, 2.1, uTime);
  h += 0.26 * wave(p, w2, 19.0, 2.9, uTime);
  h += 0.18 * wave(p, w3, 11.0, 3.6, uTime);
  h += 0.10 * wave(p, w2, 5.5, 4.8, uTime);
  h *= uWaveAmp;
  vCrest = h / max(uWaveAmp, 0.001);
  wp.y += h;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SEA_FRAG = /* glsl */`
uniform vec3 uDeep;
uniform vec3 uLight;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform vec3 uCamPos;
uniform float uWhitecap;
uniform float uTime;
varying vec3 vWorld;
varying float vCrest;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

void main() {
  vec3 view = normalize(uCamPos - vWorld);
  // cheap normal from crest gradient: fake with constant up + crest tilt
  vec3 n = normalize(vec3(dFdx(vWorld.y) * -6.0, 1.0, dFdy(vWorld.y) * -6.0));

  float fres = pow(1.0 - max(dot(view, n), 0.0), 2.0);
  vec3 col = mix(uDeep, uLight, 0.35 + 0.3 * vCrest);
  col = mix(col, uFogColor * 0.95, fres * 0.55);

  // sun glitter
  vec3 r = reflect(-uSunDir, n);
  float spec = pow(max(dot(r, view), 0.0), 90.0);
  col += vec3(1.0, 0.95, 0.8) * spec * 0.9;

  // whitecaps: noise breaks on crests as wind rises
  float cap = noise(vWorld.xz * 0.35 + uTime * 0.35);
  cap = smoothstep(1.25 - clamp(uWhitecap, 0.0, 1.2) * 0.55, 1.35, cap + vCrest * 0.55);
  col = mix(col, vec3(0.93, 0.96, 0.97), cap * 0.85);

  float fogF = smoothstep(4000.0, 26000.0, length(uCamPos - vWorld));
  col = mix(col, uFogColor, fogF);
  gl_FragColor = vec4(col, 1.0);
}
`;
