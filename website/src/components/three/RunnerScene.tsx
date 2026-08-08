import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, Trail } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { computePose, BONES } from '../../lib/gait'

const VOLT = '#CDFF4F'
const CYCLE_SECONDS = 1.15 // one full stride

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

/**
 * The athlete as an LED dot-matrix figure: particles distributed along the
 * skeleton, repositioned every frame from the gait engine, twinkling like a
 * stadium board.
 */
function DotBody() {
  const pointsRef = useRef<THREE.Points>(null)
  const dpr = useThree((s) => s.viewport.dpr)

  const { geometry, particles } = useMemo(() => {
    const particles: Particle[] = []
    // Bones
    BONE_DOTS.forEach(([count, r], bi) => {
      for (let i = 0; i < count; i++) {
        // Gaussian-ish jitter inside a ball of radius r
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
    // Head shell
    for (let i = 0; i < HEAD_DOTS; i++) {
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
        Math.random() < 0.1
          ? 0.085 + Math.random() * 0.03
          : 0.03 + Math.random() * 0.042
      phases[i] = Math.random() * Math.PI * 2
      tones[i] = Math.random() < 0.08 ? 1 : 0
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
    geometry.setAttribute('aTone', new THREE.BufferAttribute(tones, 1))
    return { geometry, particles }
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
          varying float vPhase;
          varying float vTone;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c);
            float alpha = smoothstep(0.5, 0.12, d);
            float tw = 0.65 + 0.35 * sin(uTime * 2.4 + vPhase);
            vec3 bone = vec3(0.925, 0.906, 0.863);
            vec3 volt = vec3(0.804, 1.0, 0.310);
            vec3 col = mix(bone, volt, vTone);
            gl_FragColor = vec4(col * tw, alpha * (0.45 + 0.5 * tw));
          }
        `,
      }),
    [],
  )

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.getElapsedTime()
    material.uniforms.uPR.value = dpr
    if (!pointsRef.current) return
    const t = clock.getElapsedTime() / CYCLE_SECONDS
    const pose = computePose(t)
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

/** Ghost skeleton: faint bones + tracked joints with live angle readouts. */
function Skeleton() {
  const boneRefs = useRef<(THREE.Mesh | null)[]>([])
  const kneeMesh = useRef<THREE.Mesh>(null)
  const hipMesh = useRef<THREE.Mesh>(null)
  const kneeLabelRef = useRef<HTMLSpanElement>(null)
  const hipLabelRef = useRef<HTMLSpanElement>(null)
  const kneeGroup = useRef<THREE.Group>(null)
  const hipGroup = useRef<THREE.Group>(null)

  const sphereGeo = useMemo(() => new THREE.SphereGeometry(1, 16, 16), [])
  const cylGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), [])
  const trackedMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: VOLT,
        emissive: VOLT,
        emissiveIntensity: 1.7,
        roughness: 0.3,
      }),
    [],
  )
  const boneMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#8A8E97',
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    [],
  )

  const tmpDir = useMemo(() => new THREE.Vector3(), [])
  const tmpUp = useMemo(() => new THREE.Vector3(0, 1, 0), [])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() / CYCLE_SECONDS
    const pose = computePose(t)

    BONES.forEach(([a, b], i) => {
      const mesh = boneRefs.current[i]
      if (!mesh) return
      const pa = pose.joints[a]
      const pb = pose.joints[b]
      mesh.position.set((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2)
      tmpDir.set(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2])
      const len = tmpDir.length()
      mesh.scale.set(0.006, len, 0.006)
      tmpDir.normalize()
      mesh.quaternion.setFromUnitVectors(tmpUp, tmpDir)
    })

    const knee = pose.joints.kneeR
    const hip = pose.joints.hipR
    kneeMesh.current?.position.set(knee[0], knee[1], knee[2])
    hipMesh.current?.position.set(hip[0], hip[1], hip[2])
    if (kneeGroup.current) kneeGroup.current.position.set(knee[0], knee[1], knee[2])
    if (hipGroup.current) hipGroup.current.position.set(hip[0], hip[1], hip[2])
    if (kneeLabelRef.current)
      kneeLabelRef.current.textContent = `${pose.kneeR.toFixed(1)}°`
    if (hipLabelRef.current)
      hipLabelRef.current.textContent = `${pose.hipR >= 0 ? '+' : ''}${pose.hipR.toFixed(1)}°`
  })

  return (
    <group>
      {BONES.map(([a, b], i) => (
        <mesh
          key={`${a}-${b}`}
          ref={(m) => {
            boneRefs.current[i] = m
          }}
          geometry={cylGeo}
          material={boneMat}
        />
      ))}

      <mesh ref={kneeMesh} geometry={sphereGeo} material={trackedMat} scale={0.026} />
      <mesh ref={hipMesh} geometry={sphereGeo} material={trackedMat} scale={0.026} />

      {/* Motion trail on the right ankle */}
      <Trail
        width={0.5}
        length={5}
        color={new THREE.Color(VOLT).multiplyScalar(0.6)}
        attenuation={(w) => w * w}
      >
        <mesh ref={useAnkleRef()} geometry={sphereGeo} material={trackedMat} scale={0.024} />
      </Trail>

      {/* Angle readouts pinned to tracked joints */}
      <group ref={kneeGroup}>
        <Html
          center
          style={{ pointerEvents: 'none', transform: 'translate(76px, 2px)' }}
          zIndexRange={[10, 0]}
        >
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="block h-px w-6 bg-volt/60" />
            <span className="font-mono text-[11px] tracking-wider text-volt">
              KNEE <span ref={kneeLabelRef}>—</span>
            </span>
          </div>
        </Html>
      </group>
      <group ref={hipGroup}>
        <Html
          center
          style={{ pointerEvents: 'none', transform: 'translate(-96px, -14px)' }}
          zIndexRange={[10, 0]}
        >
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="font-mono text-[11px] tracking-wider text-bone-300/90">
              HIP <span ref={hipLabelRef}>—</span>
            </span>
            <span className="block h-px w-6 bg-bone-300/50" />
          </div>
        </Html>
      </group>
    </group>
  )
}

/** Hook: a mesh ref that follows the right ankle each frame (for the Trail). */
function useAnkleRef() {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() / CYCLE_SECONDS
    const pose = computePose(t)
    const a = pose.joints.ankleR
    ref.current?.position.set(a[0], a[1], a[2])
  })
  return ref
}

/** Ground: scrolling grid with radial fade, implying speed. */
function Ground() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
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
          uniform float uTime;
          float gridLine(float v, float w) {
            float f = abs(fract(v) - 0.5);
            return smoothstep(0.5 - w, 0.5, f);
          }
          void main() {
            vec2 p = (vUv - 0.5) * 24.0;      // world-ish coords
            p.x += uTime * 4.4;               // scroll toward -x (runner "moves" +x)
            float g = max(gridLine(p.x, 0.05), gridLine(p.y, 0.05));
            float d = length((vUv - 0.5) * 2.0);
            float fade = smoothstep(0.85, 0.18, d);
            vec3 col = vec3(0.208, 0.227, 0.267); // hairline #353A44
            gl_FragColor = vec4(col, g * fade * 0.3);
          }
        `,
      }),
    [],
  )
  useFrame(({ clock }) => {
    mat.uniforms.uTime.value = clock.getElapsedTime()
  })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} material={mat}>
      <planeGeometry args={[14, 14]} />
    </mesh>
  )
}

/** Horizontal volt scan line sweeping the athlete, timing-board style. */
function ScanLine() {
  const ref = useRef<THREE.Mesh>(null)
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: VOLT,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  )
  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = (clock.getElapsedTime() % 7) / 7
    const y = THREE.MathUtils.lerp(0.05, 1.85, t)
    ref.current.position.y = y
    mat.opacity = 0.16 * Math.sin(Math.PI * t)
  })
  return (
    <mesh ref={ref} position={[0, 1, -0.35]} material={mat}>
      <planeGeometry args={[1.9, 0.004]} />
    </mesh>
  )
}

/** Sparse particles streaming backwards — speed. */
function SpeedLines() {
  const ref = useRef<THREE.Points>(null)
  const { geo, speeds } = useMemo(() => {
    const count = 90
    const pos = new Float32Array(count * 3)
    const speeds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 10
      pos[i * 3 + 1] = Math.random() * 2.4
      pos[i * 3 + 2] = -1.5 - Math.random() * 3
      speeds[i] = 1.5 + Math.random() * 3
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return { geo, speeds }
  }, [])
  const mat = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: '#8A8E97',
        size: 0.015,
        transparent: true,
        opacity: 0.5,
        sizeAttenuation: true,
      }),
    [],
  )
  useFrame((_, delta) => {
    if (!ref.current) return
    const pos = ref.current.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) - speeds[i] * delta
      if (x < -5) x = 5
      pos.setX(i, x)
    }
    pos.needsUpdate = true
  })
  return <points ref={ref} geometry={geo} material={mat} />
}

function CameraRig() {
  useFrame(({ camera, pointer, clock }) => {
    const t = clock.getElapsedTime()
    const baseX = 2.7 + Math.sin(t * 0.11) * 0.25
    const baseY = 1.15 + Math.cos(t * 0.14) * 0.08
    const baseZ = 3.3
    camera.position.x += (baseX + pointer.x * 0.28 - camera.position.x) * 0.04
    camera.position.y += (baseY - pointer.y * 0.18 - camera.position.y) * 0.04
    camera.position.z += (baseZ - camera.position.z) * 0.04
    camera.lookAt(0.05, 0.92, 0)
  })
  return null
}

export default function RunnerScene() {
  return (
    <Canvas
      dpr={[1, 1.75]}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
        toneMapping: THREE.NoToneMapping,
      }}
      camera={{ position: [2.7, 1.15, 3.3], fov: 34 }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 4, 2]} intensity={0.9} color="#ECE7DC" />
      <pointLight position={[-2, 1.5, -1]} intensity={0.5} color={VOLT} />

      <DotBody />
      <Skeleton />
      <Ground />
      <ScanLine />
      <SpeedLines />
      <CameraRig />

      <EffectComposer>
        <Bloom intensity={0.7} luminanceThreshold={0.4} luminanceSmoothing={0.9} mipmapBlur />
        <Vignette eskil={false} offset={0.25} darkness={0.65} />
      </EffectComposer>
    </Canvas>
  )
}
