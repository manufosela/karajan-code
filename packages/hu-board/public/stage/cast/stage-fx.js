// Atmosphere for the stage: a fake volumetric beam under the key light and
// the dust that floats in it. Both are additive and cost one draw call each.
// 'three' is the landing's trimmed bundle (public/lib/three.min.js): the core
// classes and the addons the film uses, all under one name (tests/landing/three-bundle.test.js).
import * as THREE from 'three';

export function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, strength: { value: 0 } },
    vertexShader: /* glsl */`
      varying float vHeight; varying vec3 vNormalV; varying vec3 vViewDir;
      void main() {
        vHeight = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 color; uniform float strength;
      varying float vHeight; varying vec3 vNormalV; varying vec3 vViewDir;
      void main() {
        float facing = pow(abs(dot(vNormalV, vViewDir)), 2.2);
        float fade = smoothstep(0.0, 0.85, vHeight) * (1.0 - smoothstep(0.92, 1.0, vHeight));
        gl_FragColor = vec4(color, facing * fade * 0.16 * strength);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

export function dustField(count, radius, height) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  let s = 7;
  const rand = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * radius;
    positions.set([Math.cos(a) * r, rand() * height, Math.sin(a) * r], i * 3);
    seeds[i] = rand();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, strength: { value: 0 }, height: { value: height }, pixelRatio: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float seed; uniform float time; uniform float height; uniform float pixelRatio;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.y = mod(p.y + time * (0.05 + seed * 0.08), height);
        p.x += sin(time * 0.3 + seed * 40.0) * 0.25;
        p.z += cos(time * 0.25 + seed * 30.0) * 0.25;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (14.0 + seed * 22.0) * pixelRatio / -mv.z;
        vAlpha = 0.35 + 0.65 * fract(seed * 7.13);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float strength; varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = (1.0 - smoothstep(0.0, 0.5, d)) * vAlpha * strength;
        gl_FragColor = vec4(1.0, 0.86, 0.62, a * 0.55);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}
