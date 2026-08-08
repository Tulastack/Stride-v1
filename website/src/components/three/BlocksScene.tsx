import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { startFrame, type StartFrame } from '../../lib/gait'
import DotFigure from './DotFigure'
import TrackGround from './TrackGround'

const START_X = -1.5 // where the blocks sit — shifted slightly right for better framing

/** Starting blocks: centre rail with two angled pedals, plus the start line. */
function StartingBlocks() {
  const body = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#3E3931', transparent: true, opacity: 0.9 }),
    [],
  )
  const face = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#8E897E', transparent: true, opacity: 0.55 }),
    [],
  )
  const lineMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#CCC7BA', transparent: true, opacity: 0.4, depthWrite: false }),
    [],
  )
  return (
    <group position={[START_X, 0, 0]}>
      {/* centre rail */}
      <mesh position={[-0.32, 0.025, 0]} material={body}>
        <boxGeometry args={[0.62, 0.03, 0.045]} />
      </mesh>
      {/* front pedal (left foot) */}
      <group position={[-0.13, 0.09, 0.045]} rotation={[0, 0, 0.9]}>
        <mesh material={body}>
          <boxGeometry args={[0.05, 0.17, 0.11]} />
        </mesh>
        <mesh position={[0.03, 0, 0]} material={face}>
          <boxGeometry args={[0.006, 0.16, 0.1]} />
        </mesh>
      </group>
      {/* rear pedal (right foot) */}
      <group position={[-0.5, 0.11, -0.045]} rotation={[0, 0, 0.78]}>
        <mesh material={body}>
          <boxGeometry args={[0.05, 0.19, 0.11]} />
        </mesh>
        <mesh position={[0.03, 0, 0]} material={face}>
          <boxGeometry args={[0.006, 0.18, 0.1]} />
        </mesh>
      </group>
      {/* start line painted across the lanes */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.16, 0.004, 0]} material={lineMat}>
        <planeGeometry args={[0.07, 3.3]} />
      </mesh>
    </group>
  )
}

function SceneInner() {
  const frameRef = useRef<StartFrame>(startFrame(0))
  const groupRef = useRef<THREE.Group>(null)
  const opacity = useRef(0)
  const camX = useRef(-0.4)
  const camY = useRef(1.2)
  const camZ = useRef(3.6)

  useFrame(({ clock, camera }) => {
    const f = startFrame(clock.getElapsedTime())
    frameRef.current = f
    opacity.current += (f.fade * 0.58 - opacity.current) * 0.1

    const runnerX = START_X + f.travel
    if (groupRef.current) {
      groupRef.current.position.x = runnerX
    }

    // During set position, frame tightly on the athlete + blocks
    // As they run, pan right to follow while widening slightly
    const inSet = f.travel < 0.1
    const targetCamX = inSet
      ? START_X + 0.6   // frame the whole set + blocks
      : Math.min(runnerX + 0.4, 2.4)
    const targetCamY = inSet ? 1.1 : 1.2
    const targetCamZ = inSet ? 3.2 : 3.8

    const k = 0.035
    camX.current += (targetCamX - camX.current) * k
    camY.current += (targetCamY - camY.current) * k
    camZ.current += (targetCamZ - camZ.current) * k

    camera.position.set(camX.current, camY.current, camZ.current)
    // Look slightly ahead of the runner
    const lookX = inSet ? START_X + 0.1 : runnerX - 0.1
    camera.lookAt(lookX, 0.75, 0)
  })

  return (
    <>
      <TrackGround size={28} opacity={0.5} position={[1.5, 0, 0]} />
      <StartingBlocks />
      <group ref={groupRef}>
        <DotFigure
          sample={() => frameRef.current.pose}
          opacityRef={opacity}
          density={0.78}
          goldFraction={0.22}
        />
      </group>
    </>
  )
}

/** The waitlist backdrop: a dot-matrix sprinter in the blocks — set, gun,
 *  drive, and quick accelerating strides away down the track. */
export default function BlocksScene() {
  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
        toneMapping: THREE.NoToneMapping,
      }}
      camera={{ position: [-0.4, 1.1, 3.2], fov: 38 }}
      style={{ background: 'transparent' }}
    >
      <SceneInner />
    </Canvas>
  )
}
