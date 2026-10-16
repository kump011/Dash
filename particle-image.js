/* =========================================================================
   PARTICLE IMAGE EFFECT — glass-particle reconstruction of a photo (Trio section).

   Thousands of tiny translucent glass fragments float in 3D space, then swirl
   in and merge, piece by piece, into the exact photograph.

   How it stays cheap: every particle is ONE point in a single BufferGeometry.
   All motion (float → gather → merge) is computed on the GPU in the vertex
   shader from a few uniforms, and the glass look (facet shape, Fresnel rim,
   specular glints, thin-film iridescence, sparkle stars) is drawn per-pixel in
   the fragment shader. The CPU only updates 5 uniforms per frame — no
   per-particle JavaScript, no per-particle meshes, no post-processing passes.

   Public API is unchanged: ParticleImageEffect.run({ canvas, imageUrl,
   particleCount, onStageChange }) / .run._stop() / .pickParticleCount().
   ========================================================================= */
window.ParticleImageEffect = (function () {
  if (typeof THREE === 'undefined') {
    return { run: () => Promise.resolve(false), pickParticleCount: () => 0 };
  }

  const coarsePointer = matchMedia('(pointer: coarse)').matches;
  const fewCores = (navigator.hardwareConcurrency || 8) <= 4;
  const lowMemory = (navigator.deviceMemory || 8) <= 4;
  const LOW_POWER = coarsePointer && (fewCores || lowMemory);

  // Desktop: ~13k (the page asks for x1.4 -> ~18k glass fragments). Phones/low-end: fewer, so it stays smooth.
  function pickParticleCount() {
    if (LOW_POWER) return 5500;
    if (coarsePointer) return 8500;
    return 13000;
  }

  /* ---------------- timeline (seconds) ---------------- */
  const FLOAT_TIME = 1.2;     // 1) particles float separately, rotating + shimmering
  const GATHER_TIME = 3.1;    // 2+3) swirl in and merge (staggered per particle inside the shader)
  const SETTLE_HOLD = 0.15;   // tiny beat before 'settled' so the last fragments lock in
  const SWEEP_TIME = 1.7;     // 4) glass shimmer travelling across the finished photo

  function glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  // Samples the image onto a small offscreen canvas so roughly `count` cells come out,
  // each cell centred on its own pixel; skips near-transparent pixels.
  function sampleImage(img, count) {
    const aspect = img.naturalWidth / img.naturalHeight || 1;
    const cols = Math.max(4, Math.round(Math.sqrt(count * aspect)));
    const rows = Math.max(4, Math.round(count / cols));
    const c = document.createElement('canvas');
    c.width = cols; c.height = rows;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, cols, rows);
    let data;
    try { data = ctx.getImageData(0, 0, cols, rows).data; }
    catch (e) { return { points: [], aspect, cols, rows }; } // e.g. blocked by CORS on some hosts
    const points = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = (y * cols + x) * 4;
        if (data[idx + 3] < 40) continue;
        points.push({
          x: (x + 0.5) / cols - 0.5,
          y: -((y + 0.5) / rows - 0.5),
          r: data[idx] / 255, g: data[idx + 1] / 255, b: data[idx + 2] / 255,
        });
      }
    }
    return { points, aspect, cols, rows };
  }

  /* ---------------- shaders ---------------- */
  const GLASS_VERT = `
    attribute vec3 aTarget;
    attribute vec3 aScatter;
    attribute vec3 aColor;
    attribute vec4 aRand;          // x: size/rotation seed, y: phase, z: gather delay, w: shape + sparkle seed
    uniform float uTime;
    uniform float uProgress;       // 0 = floating, 1 = fully merged into the photo
    uniform float uScale;          // pixels per world unit at depth 1 (for point size)
    uniform float uCell;           // world size of one photo cell
    uniform vec2  uPlane;          // photo plane size in world units
    uniform float uSweep;          // 0..1 position of the shimmer band (0 = off)
    varying vec3  vColor;
    varying vec4  vRand;
    varying float vMerge;
    varying float vSweep;
    varying float vAng;
    varying vec2  vTilt;

    vec3 rotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }

    void main() {
      float delay = aRand.z;
      float e = clamp(uProgress * 1.35 - delay * 0.35, 0.0, 1.0);   // each particle merges in its own window
      float ee = e * e * e * (e * (e * 6.0 - 15.0) + 10.0);          // smootherstep: gentle start, soft landing

      // floating: slow 3D drift around its scatter position
      vec3 drift = vec3(sin(uTime * 0.45 + aRand.y * 40.0),
                        cos(uTime * 0.37 + aRand.x * 40.0),
                        sin(uTime * 0.29 + aRand.z * 40.0) * 0.6) * 0.28;
      vec3 fp = aScatter + drift;

      // gathering: the whole cloud swirls around the photo centre while it tightens onto its pixel
      float swirl = (1.0 - ee) * (2.4 + aRand.x * 2.2);
      vec3 pos = mix(rotZ(fp, swirl), aTarget, ee);

      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * mv;

      // size: mostly tiny fragments, a few larger ones, all easing to exactly one photo cell
      float sizeR = fract(aRand.x * 7.31 + aRand.y * 3.17);
      float floatSize = uCell * (0.45 + 2.7 * sizeR * sizeR * sizeR);
      float worldSize = mix(floatSize, uCell * 1.2, ee);
      gl_PointSize = clamp(worldSize * uScale / -mv.z, 1.0, 120.0);

      vColor = aColor;
      vRand = aRand;
      vMerge = ee;
      vAng = (aRand.x * 6.2831853 + uTime * (aRand.y - 0.5) * 2.6) * (1.0 - ee);   // tumbles, then aligns to 0
      vTilt = vec2(sin(uTime * 0.9 + aRand.y * 30.0), cos(uTime * 0.7 + aRand.z * 30.0)) * 0.9 * (1.0 - ee);

      // glass shimmer band travelling diagonally across the finished photo
      float s = dot(aTarget.xy / uPlane, vec2(0.86, 0.5));
      float band = exp(-pow((s - (uSweep * 2.0 - 1.0)) * 5.0, 2.0));
      vSweep = band * step(0.001, uSweep) * ee;
    }
  `;

  const GLASS_FRAG = `
    uniform float uTime;
    uniform float uFade;
    varying vec3  vColor;
    varying vec4  vRand;
    varying float vMerge;
    varying float vSweep;
    varying float vAng;
    varying vec2  vTilt;

    float sdBox(vec2 p, float b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
    float sdHex(vec2 p, float r) { p = abs(p); return max(dot(p, vec2(0.866025, 0.5)), p.y) - r; }
    float sdTri(vec2 p, float r) {
      const float k = 1.7320508;
      p.x = abs(p.x) - r; p.y = p.y + r / k;
      if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
      p.x -= clamp(p.x, -2.0 * r, 0.0);
      return -length(p) * sign(p.y);
    }

    void main() {
      vec2 q = gl_PointCoord * 2.0 - 1.0;
      q.y = -q.y;
      float ca = cos(vAng), sa = sin(vAng);
      vec2 p = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);

      // ---- crystal fragment silhouette (hexagon / triangle / diamond), squaring up as it merges ----
      float k = vRand.w;
      float shard;
      if (k < 0.34)      shard = sdHex(p, 0.82);
      else if (k < 0.67) shard = sdTri(p * 1.15, 0.7) / 1.15;
      else               shard = sdBox(vec2(p.x + p.y, p.x - p.y) * 0.7071, 0.62);
      float merge = smoothstep(0.55, 0.95, vMerge);
      float d = mix(shard, sdBox(p, 0.98), merge);
      float inside = 1.0 - smoothstep(-0.05, 0.05, d);

      // ---- faux glass normal (bulged + per-fragment tilt), Fresnel, speculars, iridescence ----
      float z = sqrt(max(0.0, 1.0 - dot(p, p) * 0.8));
      vec3 n = normalize(vec3(p * 0.9 + vTilt * 0.6, z));
      float ndv = clamp(n.z, 0.0, 1.0);
      float fres = pow(1.0 - ndv, 2.5);
      vec3 h1 = normalize(normalize(vec3(-0.5, 0.7, 0.8)) + vec3(0.0, 0.0, 1.0));
      vec3 h2 = normalize(normalize(vec3(0.6, -0.4, 0.7)) + vec3(0.0, 0.0, 1.0));
      float spec = pow(max(dot(n, h1), 0.0), 48.0) + 0.6 * pow(max(dot(n, h2), 0.0), 64.0);
      float edge = smoothstep(-0.32, -0.02, d);

      // pastel thin-film iridescence: only ever drifts between lavender, pink and icy blue, with a pearly white lift
      float fa = fres * 5.0 + vRand.y * 6.2831853 + uTime * 0.3;
      vec3 film = mix(mix(vec3(0.74, 0.64, 1.0), vec3(1.0, 0.70, 0.88), 0.5 + 0.5 * sin(fa)),
                      vec3(0.66, 0.86, 1.0), 0.5 + 0.5 * sin(fa * 1.7 + 2.0));
      film = mix(film, vec3(1.0, 0.97, 1.0), 0.3);
      vec3 tint = mix(vec3(0.78, 0.68, 1.0), vec3(1.0, 0.74, 0.88), vRand.y);   // lavender <-> pastel pink
      tint = mix(tint, vec3(0.70, 0.88, 1.0), step(0.66, vRand.x));             // some icy blue

      float glassAmt = 1.0 - merge * 0.88;                                       // glass look relaxes into the photo
      vec3 glass = tint * 0.35 + film * 0.35 * (fres + edge * 0.6);
      vec3 col = mix(vColor, mix(glass, vColor, 0.55), glassAmt);
      vec3 glow = (vec3(1.0, 0.96, 1.0) * spec * 1.1 + film * edge * 0.45 + tint * fres * 0.3) * glassAmt;
      glow += vSweep * (0.2 + spec * 0.5) * vec3(1.0, 0.95, 1.0);              // shimmer pass

      float bodyA = clamp(0.22 + fres * 0.55 + edge * 0.4 + spec * 0.6, 0.0, 0.9);
      float tileA = mix(bodyA, 0.97, merge) * inside;

      // ---- a few fragments are tiny twinkling stars while floating ----
      float starMix = step(0.965, k) * (1.0 - smoothstep(0.35, 0.6, vMerge));
      float cross = exp(-abs(q.x) * 14.0) * exp(-abs(q.y) * 2.2) + exp(-abs(q.y) * 14.0) * exp(-abs(q.x) * 2.2);
      float tw = 0.5 + 0.5 * sin(uTime * 3.0 + vRand.y * 60.0);
      float starV = (exp(-dot(q, q) * 10.0) + cross * 0.9) * (0.4 + 0.6 * tw);

      // premultiplied output: rgb carries glow additively, alpha carries the translucent body
      vec3 rgb = col * tileA + glow * inside;
      float a = tileA;
      rgb = mix(rgb, vec3(1.0, 0.97, 1.0) * starV, starMix);
      a = mix(a, clamp(starV * 0.6, 0.0, 1.0), starMix);
      rgb *= uFade; a *= uFade;
      if (a < 0.004 && max(rgb.r, max(rgb.g, rgb.b)) < 0.004) discard;
      gl_FragColor = vec4(rgb, a);
    }
  `;

  const DUST_VERT = `
    attribute vec3 aBase;
    attribute vec3 aRand;
    uniform float uTime;
    uniform float uPx;
    varying float vTw;
    varying vec3  vCol;
    void main() {
      vec3 p = aBase;
      p.y += mod(uTime * (0.05 + aRand.x * 0.12) + aRand.y * 10.0, 6.0) - 3.0;       // slow rise, wrapped
      p.x += sin(uTime * 0.4 + aRand.z * 30.0) * 0.25;
      p.z += cos(uTime * 0.3 + aRand.y * 30.0) * 0.2;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = (2.0 + aRand.x * 5.0) * uPx;
      vTw = 0.5 + 0.5 * sin(uTime * (1.5 + aRand.y * 2.0) + aRand.z * 50.0);
      vCol = mix(vec3(0.82, 0.74, 1.0), mix(vec3(1.0, 0.8, 0.92), vec3(0.76, 0.92, 1.0), step(0.5, aRand.z)), step(0.33, aRand.y));
    }
  `;
  const DUST_FRAG = `
    uniform float uFade;
    varying float vTw;
    varying vec3  vCol;
    void main() {
      vec2 q = gl_PointCoord * 2.0 - 1.0;
      float core = exp(-dot(q, q) * 7.0);
      float cross = (exp(-abs(q.x) * 16.0) * exp(-abs(q.y) * 3.0) + exp(-abs(q.y) * 16.0) * exp(-abs(q.x) * 3.0)) * 0.5;
      float v = (core + cross) * (0.25 + 0.75 * vTw) * uFade;
      gl_FragColor = vec4(vCol * v, v);
    }
  `;

  /**
   * @param {HTMLCanvasElement} canvas - dedicated canvas to render into
   * @param {string} imageUrl - image to reconstruct out of glass particles
   * @param {number} [particleCount] - defaults to a device-appropriate count
   * @param {(stage:'converge'|'settled')=>void} [onStageChange]
   * @returns {Promise<boolean>} resolves true once the sequence has started
   */
  let runToken = 0;
  function run({ canvas, imageUrl, particleCount, onStageChange }) {
    const token = ++runToken;
    return new Promise((resolve) => {
      if (!canvas || !imageUrl) return resolve(false);
      const img = new Image();
      img.onload = () => {
        if (token !== runToken) return resolve(false);   // a newer run (Replay) or a stop replaced this one
        try { build(img); } catch (e) { resolve(false); }
      };
      img.onerror = () => resolve(false);
      img.src = imageUrl;

      function build(img) {
        const count = Math.min(particleCount || pickParticleCount(), 22000);
        const { points, aspect, cols } = sampleImage(img, count);
        const n = points.length;
        if (!n) return resolve(false);

        const width = canvas.clientWidth || innerWidth;
        const height = canvas.clientHeight || innerHeight;
        const dpr = Math.min(devicePixelRatio || 1, LOW_POWER ? 1 : 1.6);

        let renderer;
        try {
          renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: 'high-performance' });
        } catch (e) { return resolve(false); }
        renderer.setPixelRatio(dpr);
        renderer.setSize(width, height, false);
        renderer.setClearColor(0x060a16, 1);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
        camera.position.set(0, 0, 9);

        // photo plane: fills the canvas exactly, so the reconstructed photo lines up with the real <img>
        const vFOV = (camera.fov * Math.PI) / 180;
        const viewHeight = 2 * Math.tan(vFOV / 2) * camera.position.z;
        const viewWidth = viewHeight * (width / height);
        const planeHeight = Math.min(viewHeight, viewWidth / aspect);
        const planeWidth = planeHeight * aspect;
        const cell = planeWidth / cols;

        /* ---- per-particle attributes (filled once; the GPU does all the animating) ---- */
        const targets = new Float32Array(n * 3);
        const scatter = new Float32Array(n * 3);
        const colors = new Float32Array(n * 3);
        const rand = new Float32Array(n * 4);
        const g3 = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;   // soft, bell-shaped spread
        for (let i = 0; i < n; i++) {
          const p = points[i], ix = i * 3, rx = i * 4;
          targets[ix] = p.x * planeWidth;
          targets[ix + 1] = p.y * planeHeight;
          targets[ix + 2] = 0;
          colors[ix] = p.r; colors[ix + 1] = p.g; colors[ix + 2] = p.b;
          scatter[ix] = g3() * viewWidth * 0.85;
          scatter[ix + 1] = g3() * viewHeight * 0.85;
          scatter[ix + 2] = -4 + Math.random() * 6.5;                // depth: perspective makes near ones bigger
          rand[rx] = Math.random();
          rand[rx + 1] = Math.random();
          rand[rx + 2] = Math.random();
          rand[rx + 3] = Math.random();
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); // unused, required by Points
        geo.setAttribute('aTarget', new THREE.BufferAttribute(targets, 3));
        geo.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3));
        geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);   // never frustum-culled

        const scaleOf = () => (height * dpr) / (2 * Math.tan(vFOV / 2));
        const glassUniforms = {
          uTime: { value: 0 }, uProgress: { value: 0 }, uScale: { value: scaleOf() },
          uCell: { value: cell }, uPlane: { value: new THREE.Vector2(planeWidth, planeHeight) },
          uSweep: { value: 0 }, uFade: { value: 0 },
        };
        const glassMat = new THREE.ShaderMaterial({
          uniforms: glassUniforms, vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG,
          transparent: true, depthTest: false, depthWrite: false,
          blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
          blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,   // premultiplied alpha
        });
        const points3d = new THREE.Points(geo, glassMat);
        points3d.frustumCulled = false;

        /* ---- floating glass dust (a few hundred soft sparkles around the formation) ---- */
        const dustN = LOW_POWER ? 90 : 260;
        const dBase = new Float32Array(dustN * 3), dRand = new Float32Array(dustN * 3);
        for (let i = 0; i < dustN; i++) {
          dBase[i * 3] = g3() * viewWidth * 0.62;
          dBase[i * 3 + 1] = g3() * viewHeight * 0.5;
          dBase[i * 3 + 2] = -1 + Math.random() * 3.5;
          dRand[i * 3] = Math.random(); dRand[i * 3 + 1] = Math.random(); dRand[i * 3 + 2] = Math.random();
        }
        const dGeo = new THREE.BufferGeometry();
        dGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dustN * 3), 3));
        dGeo.setAttribute('aBase', new THREE.BufferAttribute(dBase, 3));
        dGeo.setAttribute('aRand', new THREE.BufferAttribute(dRand, 3));
        dGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
        const dustUniforms = { uTime: { value: 0 }, uPx: { value: dpr }, uFade: { value: 0 } };
        const dustMat = new THREE.ShaderMaterial({
          uniforms: dustUniforms, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG,
          transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const dust = new THREE.Points(dGeo, dustMat);
        dust.frustumCulled = false;

        // soft lavender glow behind everything — a cheap, restrained stand-in for bloom
        const glowTex = glowTexture();
        const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, color: 0x9a86ff, transparent: true, opacity: 0.2,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        glowSprite.scale.set(planeWidth * 1.5, planeHeight * 1.5, 1);
        glowSprite.position.set(0, 0, -1.2);

        scene.add(glowSprite);
        scene.add(points3d);
        scene.add(dust);

        /* ---- timeline + single animation loop ---- */
        let time = 0, sweepT = -1, stage = 'float';
        let running = true, raf = 0, onScreen = true;
        const clock = new THREE.Clock();

        function frame() {
          raf = 0;
          if (!running) return;
          if (!onScreen) { clock.getDelta(); return; }   // scrolled away: no work at all, resumed by the observer
          raf = requestAnimationFrame(frame);
          const dt = Math.min(clock.getDelta(), 0.05);   // clamped so a hidden/slow tab never makes it jump
          time += dt;

          const gather = Math.min(Math.max((time - FLOAT_TIME) / GATHER_TIME, 0), 1);
          glassUniforms.uTime.value = time;
          dustUniforms.uTime.value = time;
          glassUniforms.uProgress.value = gather;
          const fade = Math.min(time / 0.9, 1);
          glassUniforms.uFade.value = fade;
          dustUniforms.uFade.value = fade;

          if (stage === 'float' && time >= FLOAT_TIME) { stage = 'converge'; if (onStageChange) onStageChange('converge'); }
          if (stage === 'converge' && time >= FLOAT_TIME + GATHER_TIME + SETTLE_HOLD) {
            stage = 'settled'; sweepT = 0;
            if (onStageChange) onStageChange('settled');
          }
          if (sweepT >= 0) {
            sweepT += dt;
            const s = Math.min(sweepT / SWEEP_TIME, 1);
            glassUniforms.uSweep.value = s < 1 ? s * s * (3 - 2 * s) : 0;
          }
          // a slow, gentle 3D sway while the pieces are still apart (settles to perfectly flat)
          const loose = 1 - gather;
          points3d.rotation.y = Math.sin(time * 0.35) * 0.22 * loose;
          points3d.rotation.x = Math.sin(time * 0.27) * 0.08 * loose;

          renderer.render(scene, camera);
        }

        // don't render while the canvas is scrolled out of view
        let io = null;
        if ('IntersectionObserver' in window) {
          io = new IntersectionObserver((entries) => {
            onScreen = entries[entries.length - 1].isIntersecting;
            if (onScreen && running && !raf) { clock.getDelta(); raf = requestAnimationFrame(frame); }
          });
          io.observe(canvas);
        }

        let resizeTimer = 0;
        function applySize() {
          const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          glassUniforms.uScale.value = (h * dpr) / (2 * Math.tan(vFOV / 2));
        }
        function onResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(applySize, 120); }
        addEventListener('resize', onResize);

        function stop() {
          if (!running) return;
          running = false;
          if (raf) cancelAnimationFrame(raf);
          raf = 0;
          clearTimeout(resizeTimer);
          removeEventListener('resize', onResize);
          if (io) io.disconnect();
          geo.dispose(); dGeo.dispose();
          glassMat.dispose(); dustMat.dispose();
          glowSprite.material.dispose(); glowTex.dispose();
          renderer.dispose();
          // release the WebGL context (the canvas is already faded out when this runs; a replay uses a fresh canvas)
          try { renderer.forceContextLoss(); } catch (e) {}
        }

        run._stop = function () { runToken++; stop(); };
        raf = requestAnimationFrame(frame);
        resolve(true);
      }
    });
  }

  // run._stop(): stops the live effect, or cancels a run whose image is still loading (the old API, unchanged).
  run._stop = function () { runToken++; };

  return { run, pickParticleCount };
})();
