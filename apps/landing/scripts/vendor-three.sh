#!/usr/bin/env bash
# Rebuilds public/lib/three.min.js, the three.js bundle the hero film loads
# (KJL-TSK-0146): the classes and addons the film uses, all under 'three'.
# Usage: bash apps/landing/scripts/vendor-three.sh [version]
set -euo pipefail

VERSION="${1:-0.187.0}"
LANDING="$(cd "$(dirname "$0")/.." && pwd)"
ESBUILD="$LANDING/../../node_modules/.bin/esbuild"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

npm pack --silent --pack-destination "$WORK" "three@$VERSION" >/dev/null
mkdir -p "$WORK/node_modules/three"
tar -xzf "$WORK/three-$VERSION.tgz" -C "$WORK/node_modules/three" --strip-components=1

# Only what the film uses, so the browser downloads a fraction of three.
# A new THREE.X in public/film needs its name added here.
JSM=./node_modules/three/examples/jsm
cat > "$WORK/entry.js" <<EOF
export {
  ACESFilmicToneMapping, AdditiveBlending, Box3, BoxGeometry, BufferAttribute, BufferGeometry,
  CanvasTexture, CapsuleGeometry, CatmullRomCurve3, CircleGeometry, Color, ConeGeometry,
  CylinderGeometry, DirectionalLight, DoubleSide, FogExp2, Group, HemisphereLight,
  LatheGeometry, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial,
  PCFShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, PointLight, Points,
  Scene, ShaderMaterial, SphereGeometry, SplineCurve, SpotLight, SRGBColorSpace,
  TorusGeometry, TubeGeometry, Vector2, Vector3, WebGLRenderer,
} from 'three';
export { RoundedBoxGeometry } from '$JSM/geometries/RoundedBoxGeometry.js';
export { RoomEnvironment } from '$JSM/environments/RoomEnvironment.js';
export { EffectComposer } from '$JSM/postprocessing/EffectComposer.js';
export { RenderPass } from '$JSM/postprocessing/RenderPass.js';
export { UnrealBloomPass } from '$JSM/postprocessing/UnrealBloomPass.js';
export { OutputPass } from '$JSM/postprocessing/OutputPass.js';
EOF

mkdir -p "$LANDING/public/lib"
cd "$WORK"
"$ESBUILD" entry.js --bundle --format=esm --minify --legal-comments=inline --outfile="$LANDING/public/lib/three.min.js"
echo "three $VERSION vendored into $LANDING/public/lib"
