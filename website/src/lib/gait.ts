// Procedural sprint kinematics.
//
// A parametric forward-kinematics body (computeFromParams) driven by two
// generators:
//   - gaitParams(t): cyclic sprint gait, keyframed from sprint biomechanics
//     references and interpolated with a periodic Catmull-Rom spline.
//   - startParams(time): a block start — set position, slow-motion drive
//     phase, then acceleration blending into the gait cycle.

export type Vec3 = [number, number, number]

export interface Pose {
  joints: Record<JointName, Vec3>
  /** Live readouts, degrees. */
  kneeR: number
  hipR: number
  cycle: number
}

export type JointName =
  | 'head'
  | 'neck'
  | 'chest'
  | 'pelvis'
  | 'hipL'
  | 'hipR'
  | 'kneeL'
  | 'kneeR'
  | 'ankleL'
  | 'ankleR'
  | 'toeL'
  | 'toeR'
  | 'shoulderL'
  | 'shoulderR'
  | 'elbowL'
  | 'elbowR'
  | 'wristL'
  | 'wristR'

export const BONES: [JointName, JointName][] = [
  ['head', 'neck'],
  ['neck', 'chest'],
  ['chest', 'pelvis'],
  ['pelvis', 'hipL'],
  ['pelvis', 'hipR'],
  ['hipL', 'kneeL'],
  ['hipR', 'kneeR'],
  ['kneeL', 'ankleL'],
  ['kneeR', 'ankleR'],
  ['ankleL', 'toeL'],
  ['ankleR', 'toeR'],
  ['neck', 'shoulderL'],
  ['neck', 'shoulderR'],
  ['shoulderL', 'elbowL'],
  ['shoulderR', 'elbowR'],
  ['elbowL', 'wristL'],
  ['elbowR', 'wristR'],
]

// Segment lengths (~1.8u tall athlete)
const THIGH = 0.46
const SHANK = 0.44
const FOOT = 0.15
const SPINE = 0.34
const CHEST_NECK = 0.13
const NECK_HEAD = 0.15
const HIP_W = 0.1
const SHOULDER_W = 0.19
const UPPER_ARM = 0.3
const FOREARM = 0.27

const D2R = Math.PI / 180

export interface LegParams {
  /** Thigh angle from vertical, degrees, +forward. */
  thigh: number
  /** Knee flexion, degrees, 0 = straight. */
  knee: number
  /** Foot offset from perpendicular-to-shank, degrees, + = toes up. */
  foot: number
}

export interface ArmParams {
  /** Upper-arm swing from vertical (before lean is added), degrees, +forward. */
  swing: number
  /** Included elbow angle, degrees, 180 = straight. */
  included: number
}

export interface BodyParams {
  /** Pelvis position in the sagittal plane. */
  pelvisX: number
  pelvisY: number
  /** Torso lean from vertical, degrees, +forward. */
  lean: number
  pelvisYaw: number
  shoulderYaw: number
  /** Extra head pitch, degrees (0 = looking ahead, + = looking down). */
  headDrop: number
  legR: LegParams
  legL: LegParams
  armR: ArmParams
  armL: ArmParams
}

/** Rotate a 2D vector CCW (x right, y up). */
function rot(v: [number, number], a: number): [number, number] {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]
}

export function computeFromParams(p: BodyParams): Pose {
  const lean = p.lean * D2R
  const pelvis: Vec3 = [p.pelvisX, p.pelvisY, 0]
  const chest: Vec3 = [
    pelvis[0] + SPINE * Math.sin(lean),
    pelvis[1] + SPINE * Math.cos(lean),
    0,
  ]
  const neck: Vec3 = [
    chest[0] + CHEST_NECK * Math.sin(lean),
    chest[1] + CHEST_NECK * Math.cos(lean),
    0,
  ]
  const headAng = lean * 0.6 + p.headDrop * D2R
  const head: Vec3 = [
    neck[0] + NECK_HEAD * Math.sin(headAng),
    neck[1] + NECK_HEAD * Math.cos(headAng),
    0,
  ]

  const joints = { pelvis, chest, neck, head } as Record<JointName, Vec3>

  const pelvisYaw = p.pelvisYaw * D2R
  const shoulderYaw = p.shoulderYaw * D2R

  const legs: { side: 'L' | 'R'; lp: LegParams; zSign: number }[] = [
    { side: 'R', lp: p.legR, zSign: 1 },
    { side: 'L', lp: p.legL, zSign: -1 },
  ]
  for (const { side, lp, zSign } of legs) {
    const hipZ = zSign * HIP_W
    const hip: Vec3 = [
      pelvis[0] + hipZ * Math.sin(pelvisYaw),
      pelvis[1] - 0.06,
      pelvis[2] + hipZ * Math.cos(pelvisYaw),
    ]
    const thighAng = lp.thigh * D2R
    const thighDir = rot([0, -1], thighAng)
    const knee3: Vec3 = [hip[0] + THIGH * thighDir[0], hip[1] + THIGH * thighDir[1], hip[2]]
    const shankAng = thighAng - lp.knee * D2R
    const shankDir = rot([0, -1], shankAng)
    const ankle3: Vec3 = [
      knee3[0] + SHANK * shankDir[0],
      knee3[1] + SHANK * shankDir[1],
      knee3[2],
    ]
    const footDir = rot(shankDir, (90 + lp.foot) * D2R)
    const toe3: Vec3 = [
      ankle3[0] + FOOT * footDir[0],
      ankle3[1] + FOOT * footDir[1],
      ankle3[2],
    ]
    joints[`hip${side}` as JointName] = hip
    joints[`knee${side}` as JointName] = knee3
    joints[`ankle${side}` as JointName] = ankle3
    joints[`toe${side}` as JointName] = toe3
  }

  const arms: { side: 'L' | 'R'; ap: ArmParams; zSign: number }[] = [
    { side: 'R', ap: p.armR, zSign: 1 },
    { side: 'L', ap: p.armL, zSign: -1 },
  ]
  for (const { side, ap, zSign } of arms) {
    const shoulderZ = zSign * SHOULDER_W
    const shoulder: Vec3 = [
      neck[0] + shoulderZ * Math.sin(shoulderYaw),
      neck[1] - 0.05,
      neck[2] + shoulderZ * Math.cos(shoulderYaw),
    ]
    const upperAng = lean + ap.swing * D2R
    const upperDir = rot([0, -1], upperAng)
    const elbow: Vec3 = [
      shoulder[0] + UPPER_ARM * upperDir[0],
      shoulder[1] + UPPER_ARM * upperDir[1],
      shoulder[2] + zSign * 0.02,
    ]
    const foreDir = rot(upperDir, Math.PI - ap.included * D2R)
    const wrist: Vec3 = [
      elbow[0] + FOREARM * foreDir[0],
      elbow[1] + FOREARM * foreDir[1],
      elbow[2] + zSign * 0.02,
    ]
    joints[`shoulder${side}` as JointName] = shoulder
    joints[`elbow${side}` as JointName] = elbow
    joints[`wrist${side}` as JointName] = wrist
  }

  return {
    joints,
    kneeR: 180 - p.legR.knee,
    hipR: p.legR.thigh,
    cycle: 0,
  }
}

// ─── Cyclic sprint gait ──────────────────────────────────────────────

// Phase 0 = right foot initial contact.
// More keyframes + smoother knee drive arc for fluid animation.
const KEYS: { t: number; thigh: number; knee: number; foot: number }[] = [
  { t: 0.00, thigh:  26, knee:  22, foot:  12 },  // right foot strike
  { t: 0.06, thigh:  14, knee:  35, foot:   8 },  // loading
  { t: 0.13, thigh:   0, knee:  28, foot:   0 },  // mid-stance
  { t: 0.22, thigh: -18, knee:  24, foot: -10 },  // late stance
  { t: 0.32, thigh: -26, knee:  22, foot: -18 },  // toe-off approach
  { t: 0.40, thigh: -16, knee:  72, foot: -10 },  // early swing, heel recovery
  { t: 0.50, thigh:  10, knee: 118, foot:  -2 },  // peak knee flexion
  { t: 0.60, thigh:  46, knee: 112, foot:   2 },  // late swing rising
  { t: 0.70, thigh:  72, knee:  96, foot:   6 },  // peak knee drive — thigh well past horizontal
  { t: 0.80, thigh:  60, knee:  62, foot:   8 },  // descending to contact
  { t: 0.90, thigh:  38, knee:  34, foot:  10 },  // pre-contact
  { t: 0.97, thigh:  28, knee:  23, foot:  11 },  // contact imminent
]

function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u
  const u3 = u2 * u
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  )
}

function sampleLeg(phase: number): LegParams {
  const t = ((phase % 1) + 1) % 1
  const n = KEYS.length
  let i = n - 1
  for (let k = 0; k < n; k++) {
    const cur = KEYS[k]
    const next = KEYS[(k + 1) % n]
    const end = next.t <= cur.t ? next.t + 1 : next.t
    if (t >= cur.t && t < end) {
      i = k
      break
    }
  }
  const k0 = KEYS[(i - 1 + n) % n]
  const k1 = KEYS[i]
  const k2 = KEYS[(i + 1) % n]
  const k3 = KEYS[(i + 2) % n]
  const t1 = k1.t
  let t2 = k2.t
  if (t2 <= t1) t2 += 1
  const tt = t < t1 ? t + 1 : t
  const u = (tt - t1) / (t2 - t1)
  return {
    thigh: catmullRom(k0.thigh, k1.thigh, k2.thigh, k3.thigh, u),
    knee: catmullRom(k0.knee, k1.knee, k2.knee, k3.knee, u),
    foot: catmullRom(k0.foot, k1.foot, k2.foot, k3.foot, u),
  }
}

function armAt(ph: number, intensity = 1.0): ArmParams {
  // Base swing amplitude 50°, elbow variation 28°
  // Higher intensity (acceleration phase) = wider swing
  const amp = 50 * intensity
  const elbowVar = 28 * intensity
  return {
    swing: amp * Math.sin(2 * Math.PI * (ph + 0.03)),
    included: 98 - elbowVar * Math.sin(2 * Math.PI * (ph + 0.03)),
  }
}

export function gaitParams(t: number, lean = 9): BodyParams {
  const phR = t
  const phL = t + 0.5
  // Arms swing more aggressively at steep lean (acceleration) than upright sprint
  const armIntensity = Math.max(0.85, Math.min(1.4, lean / 18))
  return {
    pelvisX: 0.02 * Math.sin(4 * Math.PI * t),
    pelvisY: 0.98 + 0.035 * Math.cos(4 * Math.PI * (t - 0.1)),
    lean,
    pelvisYaw: 8 * Math.sin(2 * Math.PI * t),
    shoulderYaw: -10 * Math.sin(2 * Math.PI * t),
    headDrop: 0,
    legR: sampleLeg(phR),
    legL: sampleLeg(phL),
    armR: armAt(phL, armIntensity), // arms counter-phase to same-side leg
    armL: armAt(phR, armIntensity),
  }
}

export function computePose(t: number): Pose {
  const pose = computeFromParams(gaitParams(t))
  pose.cycle = ((t % 1) + 1) % 1
  return pose
}

// ─── Block start sequence ────────────────────────────────────────────

/**
 * "Set" position: athlete coiled in the blocks.
 *
 * legL/legR thigh+knee are solved (2-link IK, foot angle held fixed) so the
 * TOE — not just the ankle — lands on the real pedal-face geometry from
 * StartingBlocks() in BlocksScene.tsx:
 *   front (left foot)  pedal face ≈ local (-0.111, 0.113)
 *   rear  (right foot) pedal face ≈ local (-0.479, 0.131)
 * With pelvisX = -0.10, pelvisY = 0.70 (hip at local (-0.10, 0.64)):
 *   legL (thigh 44.4°, knee 123.3°, foot 30°) → toe ≈ (-0.111, 0.113) ✓
 *   legR (thigh -0.6°, knee 101.2°, foot 34°) → toe ≈ (-0.479, 0.131) ✓
 * (Previous values undershot badly — the rear toe landed ~0.12 units
 * *below* the ground plane, which read as the foot missing the block
 * entirely. If the block geometry or pelvis position ever changes, re-solve
 * rather than hand-tune — these are exact for the current geometry, not
 * eyeballed.)
 */
const SET_POSE: BodyParams = {
  pelvisX: -0.10,
  pelvisY: 0.70,
  lean: 95,          // torso pitched well past horizontal — hips above shoulders
  pelvisYaw: 0,
  shoulderYaw: 0,
  headDrop: 22,      // eyes down at the line
  // Front (left) foot — knee bent ~90°, foot dorsiflexed into the pedal
  legL: { thigh: 44.4, knee: 123.3, foot: 30 },
  // Rear (right) foot — leg more extended, ankle plantar-flexed into rear pedal
  legR: { thigh: -0.6, knee: 101.2, foot: 34 },
  // Arms straight down, weight through knuckles on the line
  armR: { swing: -92, included: 174 },
  armL: { swing: -92, included: 174 },
}

/**
 * First drive step: explosive triple extension. Push leg nearly straight,
 * rear knee punching forward and up, arms ripping apart with full range.
 */
const DRIVE_POSE: BodyParams = {
  pelvisX: 0.42,
  pelvisY: 0.88,
  lean: 42,
  pelvisYaw: 7,
  shoulderYaw: -9,
  headDrop: 12,
  legL: { thigh: -36, knee: 5, foot: -28 },   // push leg fully extended
  legR: { thigh: 80, knee: 104, foot: 8 },     // drive knee punching high and forward
  // Strong, wide arm split — back arm driving elbow past hip, front punching forward
  armR: { swing: -78, included: 115 },
  armL: { swing: 74, included: 64 },
}

function lerp(a: number, b: number, u: number) {
  return a + (b - a) * u
}
function lerpLeg(a: LegParams, b: LegParams, u: number): LegParams {
  return {
    thigh: lerp(a.thigh, b.thigh, u),
    knee: lerp(a.knee, b.knee, u),
    foot: lerp(a.foot, b.foot, u),
  }
}
function lerpArm(a: ArmParams, b: ArmParams, u: number): ArmParams {
  return {
    swing: lerp(a.swing, b.swing, u),
    included: lerp(a.included, b.included, u),
  }
}
function lerpBody(a: BodyParams, b: BodyParams, u: number): BodyParams {
  return {
    pelvisX: lerp(a.pelvisX, b.pelvisX, u),
    pelvisY: lerp(a.pelvisY, b.pelvisY, u),
    lean: lerp(a.lean, b.lean, u),
    pelvisYaw: lerp(a.pelvisYaw, b.pelvisYaw, u),
    shoulderYaw: lerp(a.shoulderYaw, b.shoulderYaw, u),
    headDrop: lerp(a.headDrop, b.headDrop, u),
    legR: lerpLeg(a.legR, b.legR, u),
    legL: lerpLeg(a.legL, b.legL, u),
    armR: lerpArm(a.armR, b.armR, u),
    armL: lerpArm(a.armL, b.armL, u),
  }
}
function easeInOut(u: number) {
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
}

export const START_LOOP = 5.8 // seconds — longer so runner gets further down the track
const DRIVE_AT = 1.6 // brief hold in set, then gun
const DRIVE_LEN = 0.42
const RUN_AT = DRIVE_AT + DRIVE_LEN

export interface StartFrame {
  pose: Pose
  /** Forward travel of the athlete, world units. */
  travel: number
  /** Overall figure opacity 0..1 (fade at loop edges). */
  fade: number
}

/**
 * Block start on a repeating loop:
 * 0.0-1.6s    set position, held with subtle breathing sway
 * 1.6-2.02s   explosive drive off the front pedal
 * 2.02s+      acceleration strides: lean dropping 44 to 10 degrees
 * last 0.5s   fade out, loop restarts silently in the blocks
 */
export function startFrame(time: number): StartFrame {
  const t = ((time % START_LOOP) + START_LOOP) % START_LOOP

  let params: BodyParams
  let travel = 0

  if (t < DRIVE_AT) {
    // SET — subtle breathing sway
    const sway = Math.sin(t * 2.2) * 0.006
    const breathLean = Math.sin(t * 1.8) * 0.4
    params = { ...SET_POSE, pelvisY: SET_POSE.pelvisY + sway, lean: SET_POSE.lean + breathLean }
  } else if (t < RUN_AT) {
    // DRIVE — explosive off the blocks. Real sprint starts aren't symmetric:
    // the rear (back) leg leaves the pedal and punches its knee through
    // early/fast to become the first step, while the front leg stays loaded
    // and extends more gradually. Stagger the two legs (and their
    // contralateral arms) instead of lerping everything on one clock, or it
    // reads as both legs firing in sync.
    const u = (t - DRIVE_AT) / DRIVE_LEN
    const ease = (x: number) => 1 - (1 - x) * (1 - x) * (1 - x)
    const e = ease(u)
    const eDrive = ease(Math.min(u * 1.4, 1)) // rear leg + front arm: fast, early
    const ePush = ease(Math.max(0, (u - 0.15) / 0.85)) // front leg + back arm: delayed

    params = lerpBody(SET_POSE, DRIVE_POSE, e)
    params.legR = lerpLeg(SET_POSE.legR, DRIVE_POSE.legR, eDrive) // rear (back) leg drives first
    params.armL = lerpArm(SET_POSE.armL, DRIVE_POSE.armL, eDrive) // contralateral arm
    params.legL = lerpLeg(SET_POSE.legL, DRIVE_POSE.legL, ePush) // front leg keeps pushing
    params.armR = lerpArm(SET_POSE.armR, DRIVE_POSE.armR, ePush)
    travel = e * 0.55
  } else {
    // ACCELERATE — blend into cyclic gait, turnover ramping up
    const tt = t - RUN_AT
    const blendDur = 0.4
    const blend = Math.min(tt / blendDur, 1)
    // Gait phase starts at 0.72 (matching drive leg position) and ramps up
    const runPhase = 0.72 + 1.85 * tt + 0.08 * tt * tt
    // Lean eases from drive lean (44°) down to upright sprint (10°) over 2.5s
    const lean = lerp(44, 10, Math.min(tt / 2.5, 1))
    const run = gaitParams(runPhase, lean)
    params = blend < 1 ? lerpBody(DRIVE_POSE, run, easeInOut(blend)) : run
    travel = 0.55 + 1.6 * tt + 0.22 * tt * tt
  }

  const fadeIn = t < 0.3 ? t / 0.3 : 1
  const fadeOut = t > START_LOOP - 0.5 ? Math.max(0, (START_LOOP - t) / 0.5) : 1

  return {
    pose: computeFromParams(params),
    travel,
    fade: Math.min(fadeIn, fadeOut),
  }
}
