import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { computePose, BONES, type JointName } from '../../lib/gait'
import DotFigure from './DotFigure'
import TrackGround, { TRACK_SPEED } from './TrackGround'

const GOLD = '#E8C87D'
const CYCLE = 1.15

const JOINTS: JointName[] = [
  'head',
  'neck',
  'chest',
  'pelvis',
  'hipL',
  'hipR',
  'kneeL',
  'kneeR',
  'ankleL',
  'ankleR',
  'toeL',
  'toeR',
  'shoulderL',
  'shoulderR',
  'elbowL',
  'elbowR',
  'wristL',
  'wristR',
]

// Per-step targets: camera azimuth (rad, orbit if null), dot opacity,
// keypoints visible, tilt-correct anim, runner speed, labels visible.
const STEP = [
  { az: null, dots: 1, kp: false, tilt: false, speed: 1, labels: false },
  { az: 0.55, dots: 0.14, kp: true, tilt: false, speed: 1, labels: false },
  { az: 0.15, dots: 0.75, kp: false, tilt: true, speed: 1, labels: false },
  { az: 0.42, dots: 1, kp: false, tilt: false, speed: 1, labels: true },
  { az: 0.75, dots: 1, kp: false, tilt: false, speed: 0.42, labels: false },
] as const

function SceneInner({ step }: { step: number }) {
  const cfg = STEP[step] ?? STEP[0]
  const phase = useRef(0)
  const trackDist = useRef(0)
  const tiltGroup = useRef<THREE.Group>(null)
  const dotOpacity = useRef(1)
  const kpRefs = useRef<(THREE.Mesh | null)[]>([])
  const kpMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#F2F2EF',
        transparent: true,
        opacity: 0,
      }),
    [],
  )
  const kpGoldMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0 }),
    [],
  )
  const boneMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: '#C9C4B8',
        transparent: true,
        opacity: 0,
      }),
    [],
  )
  const plumbRef = useRef<THREE.Mesh>(null)
  const kneeLabel = useRef<HTMLSpanElement>(null)
  const hipLabel = useRef<HTMLSpanElement>(null)
  const labelsGroup = useRef<THREE.Group>(null)
  const kneeAnchor = useRef<THREE.Group>(null)
  const hipAnchor = useRef<THREE.Group>(null)

  const sphereGeo = useMemo(() => new THREE.SphereGeometry(1, 12, 12), [])
  const boneLines = useMemo(
    () =>
      BONES.map(() => {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(),
          new THREE.Vector3(),
        ])
        return new THREE.Line(geo, boneMat)
      }),
    [boneMat],
  )

  useFrame(({ camera, clock }, delta) => {
    phase.current += (delta * cfg.speed) / CYCLE
    trackDist.current += TRACK_SPEED * cfg.speed * delta
    const pose = computePose(phase.current)

    // Camera: orbit on step 0, ease to fixed azimuth otherwise
    const t = clock.getElapsedTime()
    const az = cfg.az === null ? t * 0.35 : cfg.az
    const targetX = Math.sin(az) * 3.1
    const targetZ = Math.cos(az) * 3.1
    const k = cfg.az === null ? 1 : 0.06
    camera.position.x += (targetX - camera.position.x) * k
    camera.position.z += (targetZ - camera.position.z) * k
    camera.position.y += (1.3 - camera.position.y) * 0.06
    camera.lookAt(0, 0.82, 0)

    // Dot opacity eases toward target
    dotOpacity.current += (cfg.dots - dotOpacity.current) * 0.07

    // Keypoints + wire skeleton
    const kpTarget = cfg.kp ? 0.95 : 0
    kpMat.opacity += (kpTarget - kpMat.opacity) * 0.08
    kpGoldMat.opacity = kpMat.opacity
    boneMat.opacity += ((cfg.kp ? 0.5 : 0) - boneMat.opacity) * 0.08
    JOINTS.forEach((name, i) => {
      const m = kpRefs.current[i]
      if (!m) return
      const p = pose.joints[name]
      m.position.set(p[0], p[1], p[2])
    })
    BONES.forEach(([a, b], i) => {
      const pa = pose.joints[a]
      const pb = pose.joints[b]
      const posAttr = boneLines[i].geometry.attributes.position
      posAttr.setXYZ(0, pa[0], pa[1], pa[2])
      posAttr.setXYZ(1, pb[0], pb[1], pb[2])
      posAttr.needsUpdate = true
    })

    // Gravity tilt-correct loop: tip the world, then lock it back to plumb
    if (tiltGroup.current) {
      let tilt = 0
      if (cfg.tilt) {
        const cycle = (t % 4.2) / 4.2
        // hold tilted briefly, then ease to vertical, hold, repeat
        const u = cycle < 0.25 ? 0 : Math.min((cycle - 0.25) / 0.45, 1)
        tilt = (14 * (1 - (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2)) * Math.PI) / 180
      }
      tiltGroup.current.rotation.z +=
        (tilt - tiltGroup.current.rotation.z) * (cfg.tilt ? 0.15 : 0.08)
    }
    if (plumbRef.current) {
      const mat = plumbRef.current.material as THREE.MeshBasicMaterial
      mat.opacity += ((cfg.tilt ? 0.5 : 0) - mat.opacity) * 0.08
    }

    // Measurement labels
    if (labelsGroup.current) labelsGroup.current.visible = cfg.labels
    if (cfg.labels) {
      const knee = pose.joints.kneeR
      const hip = pose.joints.hipR
      kneeAnchor.current?.position.set(knee[0], knee[1], knee[2])
      hipAnchor.current?.position.set(hip[0], hip[1], hip[2])
      if (kneeLabel.current) kneeLabel.current.textContent = `${pose.kneeR.toFixed(1)}°`
      if (hipLabel.current)
        hipLabel.current.textContent = `${pose.hipR >= 0 ? '+' : ''}${pose.hipR.toFixed(1)}°`
    }
  })

  return (
    <group>
      <group ref={tiltGroup}>
        <TrackGround distRef={trackDist} size={10} opacity={0.6} />
        <DotFigure
          sample={() => computePose(phase.current)}
          opacityRef={dotOpacity}
          density={0.8}
        />
        {JOINTS.map((name, i) => (
          <mesh
            key={name}
            ref={(m) => {
              kpRefs.current[i] = m
            }}
            geometry={sphereGeo}
            material={name === 'kneeR' || name === 'hipR' || name === 'ankleR' ? kpGoldMat : kpMat}
            scale={name === 'head' ? 0.05 : 0.022}
          />
        ))}
        {boneLines.map((line, i) => (
          <primitive key={i} object={line} />
        ))}
      </group>

      {/* Plumb line — true vertical */}
      <mesh ref={plumbRef} position={[0, 1, -0.3]}>
        <planeGeometry args={[0.004, 2.4]} />
        <meshBasicMaterial
          color={GOLD}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Live measurement labels */}
      <group ref={labelsGroup} visible={false}>
        <group ref={kneeAnchor}>
          <Html
            center
            style={{ pointerEvents: 'none', transform: 'translate(70px, 0px)' }}
            zIndexRange={[10, 0]}
          >
            <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider whitespace-nowrap text-gold">
              <span className="block h-px w-5 bg-gold/60" />
              KNEE <span ref={kneeLabel}>—</span>
            </span>
          </Html>
        </group>
        <group ref={hipAnchor}>
          <Html
            center
            style={{ pointerEvents: 'none', transform: 'translate(-84px, -10px)' }}
            zIndexRange={[10, 0]}
          >
            <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider whitespace-nowrap text-bone-300/90">
              HIP <span ref={hipLabel}>—</span>
              <span className="block h-px w-5 bg-bone-300/50" />
            </span>
          </Html>
        </group>
      </group>
    </group>
  )
}

export default function PipelineScene({ step }: { step: number }) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
        toneMapping: THREE.NoToneMapping,
      }}
      camera={{ position: [1.6, 1.25, 2.7], fov: 38 }}
      style={{ background: 'transparent' }}
    >
      <SceneInner step={step} />
    </Canvas>
  )
}
