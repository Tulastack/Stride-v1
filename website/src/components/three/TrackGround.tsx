import { useMemo, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export const LANE_W = 1.12
export const TRACK_SPEED = 3.4 // world units per second at speed 1

/**
 * A running track: lanes along the direction of motion, surface seams, radial
 * fade. Scroll is driven by `distRef` — accumulated distance in world units —
 * so scenes can run it at any speed (or hold it still).
 */
export default function TrackGround({
  distRef,
  size = 14,
  opacity = 0.75,
  position = [0, 0, 0.56] as [number, number, number],
}: {
  distRef?: RefObject<number>
  size?: number
  opacity?: number
  position?: [number, number, number]
}) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uDist: { value: 0 },
          uSize: { value: size },
          uAlpha: { value: opacity },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          uniform float uDist;
          uniform float uSize;
          uniform float uAlpha;
          void main() {
            vec2 p = (vUv - 0.5) * uSize;
            p.x += uDist;

            const float LANE = 1.12;
            float fy = abs(fract(p.y / LANE) - 0.5) * LANE;
            float lane = smoothstep(0.055, 0.028, fy);

            float fx = abs(fract(p.x / 2.6 + 0.5) - 0.5) * 2.6;
            float seam = smoothstep(0.05, 0.02, fx) * 0.18;

            float d = length((vUv - 0.5) * 2.0);
            float fade = smoothstep(0.82, 0.15, d);

            vec3 base = vec3(0.105, 0.095, 0.078);
            vec3 line = vec3(0.80, 0.78, 0.72);
            float lineA = lane * 0.5 + seam;
            vec3 col = mix(base, line, clamp(lineA, 0.0, 1.0));
            float alpha = fade * (0.5 + 0.5 * clamp(lineA, 0.0, 1.0));
            gl_FragColor = vec4(col, alpha * uAlpha);
          }
        `,
      }),
    [size, opacity],
  )
  useFrame(() => {
    mat.uniforms.uDist.value = distRef?.current ?? 0
  })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={position} material={mat}>
      <planeGeometry args={[size, size]} />
    </mesh>
  )
}

/** Canvas texture of a painted lane numeral. */
export function makeNumeralTexture(n: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 384
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#E8E4D8'
  ctx.font = '700 300px "Space Grotesk Variable", "Arial Narrow", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(n, 128, 200)
  const tex = new THREE.CanvasTexture(c)
  tex.anisotropy = 8
  return tex
}
