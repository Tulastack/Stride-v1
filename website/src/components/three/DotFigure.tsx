import { useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { BONES, type Pose } from '../../lib/gait'

// Dot density config per bone (matches BONES order): [count, jitter radius]
const BONE_DOTS: [number, number][] = [
  [26, 0.034], // head-neck
  [46, 0.062], // neck-chest
  [80, 0.072], // chest-pelvis
  [22, 0.045], // pelvis-hipL
  [22, 0.045], // pelvis-hipR
  [62, 0.05], // hipL-kneeL
  [62, 0.05], // hipR-kneeR
  [52, 0.038], // kneeL-ankleL
  [52, 0.038], // kneeR-ankleR
  [16, 0.026], // ankleL-toeL
  [16, 0.026], // ankleR-toeR
  [20, 0.042], // neck-shoulderL
  [20, 0.042], // neck-shoulderR
  [42, 0.038], // shoulderL-elbowL
  [42, 0.038], // shoulderR-elbowR
  [34, 0.03], // elbowL-wristL
  [34, 0.03], // elbowR-wristR
]
const HEAD_DOTS = 88
const HEAD_R = 0.088

interface Particle {
  bone: number // -1 = head shell
  u: number
  ox: number
  oy: number
  oz: number
}

export interface DotFigureProps {
  /** Called every frame; must return the pose to render. */
  sample: (elapsed: number) => Pose
  /** Fraction of dots tinted gold. */
  goldFraction?: number
  /** Scales the number of dots (1 = hero density). */
  density?: number
  /** Scales dot size. */
  sizeScale?: number
  /** Optional ref holding a 0..1 opacity multiplier, read per frame. */
  opacityRef?: RefObject<number>
}

/**
 * An athlete as an LED dot-matrix figure: particles distributed along the
 * skeleton, repositioned every frame from a pose sampler, twinkling like a
 * stadium board.
 */
export default function DotFigure({
  sample,
  goldFraction = 0.14,
  density = 1,
  sizeScale = 1,
  opacityRef,
}: DotFigureProps) {
  const pointsRef = useRef<THREE.Points>(null)
  const dpr = useThree((s) => s.viewport.dpr)

  const { geometry, particles } = useMemo(() => {
    const particles: Particle[] = []
    BONE_DOTS.forEach(([count, r], bi) => {
      const n = Math.max(2, Math.round(count * density))
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2
        const b = Math.acos(2 * Math.random() - 1)
        const rr = r * Math.cbrt(Math.random())
        particles.push({
          bone: bi,
          u: Math.random(),
          ox: rr * Math.sin(b) * Math.cos(a),
          oy: rr * Math.sin(b) * Math.sin(a),
          oz: rr * Math.cos(b),
        })
      }
    })
    for (let i = 0; i < Math.round(HEAD_DOTS * density); i++) {
      const a = Math.random() * Math.PI * 2
      const b = Math.acos(2 * Math.random() - 1)
      const rr = HEAD_R * (0.55 + 0.45 * Math.random())
      particles.push({
        bone: -1,
        u: 0,
        ox: rr * Math.sin(b) * Math.cos(a),
        oy: rr * Math.sin(b) * Math.sin(a),
        oz: rr * Math.cos(b),
      })
    }

    const n = particles.length
    const positions = new Float32Array(n * 3)
    const sizes = new Float32Array(n)
    const phases = new Float32Array(n)
    const tones = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      sizes[i] =
        (Math.random() < 0.1
          ? 0.085 + Math.random() * 0.03
          : 0.03 + Math.random() * 0.042) * sizeScale
      phases[i] = Math.random() * Math.PI * 2
      tones[i] = Math.random() < goldFraction ? 1 : 0
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
    geometry.setAttribute('aTone', new THREE.BufferAttribute(tones, 1))
    return { geometry, particles }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uPR: { value: 1 },
          uOpacity: { value: 1 },
        },
        vertexShader: /* glsl */ `
          attribute float aSize;
          attribute float aPhase;
          attribute float aTone;
          uniform float uPR;
          varying float vPhase;
          varying float vTone;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * uPR * (240.0 / -mv.z);
            gl_Position = projectionMatrix * mv;
            vPhase = aPhase;
            vTone = aTone;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uOpacity;
          varying float vPhase;
          varying float vTone;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c);
            float alpha = smoothstep(0.5, 0.12, d);
            float tw = 0.65 + 0.35 * sin(uTime * 2.4 + vPhase);
            vec3 bone = vec3(0.949, 0.949, 0.937);
            vec3 gold = vec3(0.910, 0.784, 0.490);
            vec3 col = mix(bone, gold, vTone);
            gl_FragColor = vec4(col * tw, alpha * (0.45 + 0.5 * tw) * uOpacity);
          }
        `,
      }),
    [],
  )

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.getElapsedTime()
    material.uniforms.uPR.value = dpr
    if (opacityRef) material.uniforms.uOpacity.value = opacityRef.current ?? 1
    if (!pointsRef.current) return
    const pose = sample(clock.getElapsedTime())
    const pos = pointsRef.current.geometry.attributes.position
    const head = pose.joints.head
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      if (p.bone === -1) {
        pos.setXYZ(i, head[0] + p.ox, head[1] + p.oy, head[2] + p.oz)
      } else {
        const [a, b] = BONES[p.bone]
        const pa = pose.joints[a]
        const pb = pose.joints[b]
        pos.setXYZ(
          i,
          pa[0] + (pb[0] - pa[0]) * p.u + p.ox,
          pa[1] + (pb[1] - pa[1]) * p.u + p.oy,
          pa[2] + (pb[2] - pa[2]) * p.u + p.oz,
        )
      }
    }
    pos.needsUpdate = true
    pointsRef.current.geometry.computeBoundingSphere()
  })

  return <points ref={pointsRef} geometry={geometry} material={material} />
}
