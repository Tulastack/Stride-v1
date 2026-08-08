import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer } from '@react-three/postprocessing'
import { Effect } from 'postprocessing'
import * as THREE from 'three'
import { startFrame, type StartFrame } from '../../lib/gait'
import DotFigure from './DotFigure'

// ── Heat-haze warp around the athlete ────────────────────────────────
const warpFragment = /* glsl */ `
  uniform float uTime;
  uniform vec2 uCenter;
  uniform float uStrength;

  void mainUv(inout vec2 uv) {
    vec2 d = uv - uCenter;
    float r = length(d);
    float ripple = sin(r * 26.0 - uTime * 5.0) * exp(-r * 5.0);
    uv += (d / max(r, 1e-4)) * ripple * uStrength;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    outputColor = inputColor;
  }
`

class WarpEffectImpl extends Effect {
  constructor() {
    super('WarpEffect', warpFragment, {
      uniforms: new Map<string, THREE.Uniform>([
        ['uTime', new THREE.Uniform(0)],
        ['uCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ['uStrength', new THREE.Uniform(0)],
      ]),
    })
  }
}

function SceneInner() {
  const frameRef = useRef<StartFrame>(startFrame(0))
  const groupRef = useRef<THREE.Group>(null)
  const opacity = useRef(0)
  const warp = useMemo(() => new WarpEffectImpl(), [])
  const camera = useThree((s) => s.camera)
  const projected = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ clock }) => {
    const f = startFrame(clock.getElapsedTime())
    frameRef.current = f
    opacity.current = f.fade * 0.55 // deliberately hazier than the hero

    if (groupRef.current) {
      groupRef.current.position.x = -2.0 + f.travel
    }

    // Warp centred on the athlete's pelvis, strength follows the drive
    const pelvis = f.pose.joints.pelvis
    projected
      .set(pelvis[0] + (groupRef.current?.position.x ?? 0), pelvis[1], pelvis[2])
      .project(camera)
    warp.uniforms.get('uCenter')!.value.set(
      projected.x * 0.5 + 0.5,
      projected.y * 0.5 + 0.5,
    )
    warp.uniforms.get('uTime')!.value = clock.getElapsedTime()
    warp.uniforms.get('uStrength')!.value = f.warp * 0.016 * f.fade
  })

  return (
    <>
      <group ref={groupRef}>
        <DotFigure
          sample={() => frameRef.current.pose}
          opacityRef={opacity}
          density={0.6}
          goldFraction={0.22}
        />
      </group>
      <EffectComposer>
        <primitive object={warp} />
      </EffectComposer>
    </>
  )
}

/** The waitlist backdrop: a dot-matrix sprinter exploding out of the blocks
 *  in slow motion, air warping around them, then accelerating away. */
export default function BlocksScene() {
  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{
        antialias: false,
        alpha: true,
        powerPreference: 'high-performance',
        toneMapping: THREE.NoToneMapping,
      }}
      camera={{ position: [0.3, 0.8, 3.4], fov: 40 }}
      style={{ background: 'transparent' }}
    >
      <SceneInner />
    </Canvas>
  )
}
