import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { startFrame, type StartFrame } from '../../lib/gait'
import DotFigure from './DotFigure'
import TrackGround from './TrackGround'

const START_X = -1.7 // where the blocks sit

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
  const shadowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#000000',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    [],
  )
  const opacity = useRef(0)

  useFrame(({ clock, camera }) => {
    const f = startFrame(clock.getElapsedTime())
    frameRef.current = f
    opacity.current = f.fade * 0.5 // background layer — hazier than the hero
    if (groupRef.current) {
      groupRef.current.position.x = START_X + 0.16 + f.travel
    }
    shadowMat.opacity = f.fade * 0.35
    camera.lookAt(0.55, 0.78, 0)
  })

  return (
    <>
      <TrackGround size={20} opacity={0.6} position={[1.2, 0, 0.56]} />
      <StartingBlocks />
      <group ref={groupRef}>
        <DotFigure
          sample={() => frameRef.current.pose}
          opacityRef={opacity}
          density={0.7}
          goldFraction={0.2}
        />
        {/* soft contact shadow keeps the athlete visually on the track */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0.1, 0.006, 0]}
          scale={[0.55, 0.22, 1]}
          material={shadowMat}
        >
          <circleGeometry args={[1, 24]} />
        </mesh>
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
      camera={{ position: [1.1, 1.1, 3.5], fov: 36 }}
      style={{ background: 'transparent' }}
    >
      <SceneInner />
    </Canvas>
  )
}
