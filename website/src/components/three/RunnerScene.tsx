import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Html, Trail } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { computePose, BONES } from '../../lib/gait'
import DotFigure from './DotFigure'

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

/** Ground: a running track — lanes along the direction of motion, with
 *  surface seams scrolling past to imply speed, fading out radially. */
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
          void main() {
            vec2 p = (vUv - 0.5) * 14.0;      // world units, runner at origin
            p.x += uTime * 3.4;               // track streams toward -x

            const float LANE = 1.12;          // lane width
            // Runner centred in a lane: boundaries at +-LANE/2, ...
            float fy = abs(fract(p.y / LANE) - 0.5) * LANE;
            float lane = smoothstep(0.055, 0.028, fy);

            // Faint surface seams sweeping past (speed cue)
            float fx = abs(fract(p.x / 2.6 + 0.5) - 0.5) * 2.6;
            float seam = smoothstep(0.05, 0.02, fx) * 0.18;

            float d = length((vUv - 0.5) * 2.0);
            float fade = smoothstep(0.82, 0.15, d);

            // Warm asphalt base + beige lane lines
            vec3 base = vec3(0.105, 0.095, 0.078);
            vec3 line = vec3(0.80, 0.78, 0.72);
            float lineA = lane * 0.5 + seam;
            vec3 col = mix(base, line, clamp(lineA, 0.0, 1.0));
            float alpha = fade * (0.5 + 0.5 * clamp(lineA, 0.0, 1.0));
            gl_FragColor = vec4(col, alpha * 0.75);
          }
        `,
      }),
    [],
  )
  useFrame(({ clock }) => {
    mat.uniforms.uTime.value = clock.getElapsedTime()
  })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0.56]} material={mat}>
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
        color: GOLD,
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
      <pointLight position={[-2, 1.5, -1]} intensity={0.5} color={GOLD} />

      <DotFigure sample={(t) => computePose(t / CYCLE_SECONDS)} />
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
