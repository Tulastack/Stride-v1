import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Html, Trail } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { computePose, BONES } from '../../lib/gait'
import DotFigure from './DotFigure'
import TrackGround, { makeNumeralTexture, TRACK_SPEED, LANE_W } from './TrackGround'

const GOLD = '#E8C87D'
const CYCLE_SECONDS = 1.15 // one full stride

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
        color: GOLD,
        emissive: GOLD,
        emissiveIntensity: 1.7,
        roughness: 0.3,
      }),
    [],
  )
  const boneMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#8E897E',
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
        color={new THREE.Color(GOLD).multiplyScalar(0.6)}
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
            <span className="block h-px w-6 bg-gold/60" />
            <span className="font-mono text-[11px] tracking-wider text-gold">
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

/**
 * The hero track: scrolling lanes plus painted lane numerals that sweep past
 * with the surface once every 12 seconds — the runner is in lane 4.
 */
function HeroTrack() {
  const dist = useRef(0)
  const numeralRefs = useRef<(THREE.Mesh | null)[]>([])
  const numerals = useMemo(
    () =>
      ['3', '4', '5'].map((n, i) => ({
        tex: makeNumeralTexture(n),
        z: (1 - i) * LANE_W, // lane 3 near camera, 4 under the runner, 5 far
      })),
    [],
  )
  const numeralMats = useMemo(
    () =>
      numerals.map(
        ({ tex }) =>
          new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          }),
      ),
    [numerals],
  )

  const SWEEP = TRACK_SPEED * 12 // one pass every 12 seconds

  useFrame((_, delta) => {
    dist.current += TRACK_SPEED * delta
    const x = 6 - (dist.current % SWEEP)
    numerals.forEach((_, i) => {
      const mesh = numeralRefs.current[i]
      if (!mesh) return
      mesh.position.x = x
      // Painted on the surface: fade with the same falloff as the track
      const vis = THREE.MathUtils.clamp(1 - (Math.abs(x) - 2.2) / 2.2, 0, 1)
      numeralMats[i].opacity = vis * 0.8
    })
  })

  return (
    <group>
      <TrackGround distRef={dist} />
      {numerals.map(({ z }, i) => (
        <mesh
          key={z}
          ref={(m) => {
            numeralRefs.current[i] = m
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[6, 0.005, z]}
          material={numeralMats[i]}
        >
          <planeGeometry args={[0.6, 0.88]} />
        </mesh>
      ))}
    </group>
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
      <pointLight position={[-2, 1.5, -1]} intensity={0.5} color={GOLD} />

      <DotFigure sample={(t) => computePose(t / CYCLE_SECONDS)} />
      <Skeleton />
      <HeroTrack />
      <SpeedLines />
      <CameraRig />

      <EffectComposer>
        <Bloom intensity={0.7} luminanceThreshold={0.4} luminanceSmoothing={0.9} mipmapBlur />
        <Vignette eskil={false} offset={0.25} darkness={0.65} />
      </EffectComposer>
    </Canvas>
  )
}
