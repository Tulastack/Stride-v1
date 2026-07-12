"""Canonical 2D keypoint schema + per-backbone canonicalizer.

The 2D biomechanics engine (`biomech2d`) consumes a FIXED canonical joint layout
(COCO-17, `[y, x, conf]`) accessed BY NAME — never by a backbone's raw indices.
Each pose backbone declares its native `keypoint_format`; `to_canonical` maps it
onto this schema so swapping the backbone can never silently feed biomech the
wrong joint (this is bug B2: `biomech2d` used to index a hardcoded COCO-17 map,
so BlazePose index 11 = "left_foot_index" would have been read as "left_hip").

COCO-17 is the canonical layout because it is exactly what the production
backbones (MoveNet, RTMPose `Body`) already emit — so the mapping is a behaviour-
preserving identity for them, and the swap-safety is gained for free.
"""

from __future__ import annotations

import numpy as np

# Canonical layout == COCO-17, in order.
CANONICAL_NAMES: list[str] = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]
CANON_KP: dict[str, int] = {n: i for i, n in enumerate(CANONICAL_NAMES)}
NUM_CANON = len(CANONICAL_NAMES)

_IDENTITY = list(range(NUM_CANON))

# native keypoint_format → the native indices that produce the 17 canonical
# joints (None = joint absent in that format → filled with NaN downstream).
FORMAT_MAPS: dict[str, list] = {
    # Both production backbones already emit COCO-17.
    "coco17": _IDENTITY,
    # Halpe-26's first 17 keypoints ARE COCO-17 (it appends head/neck/hip/feet).
    "halpe26": _IDENTITY,
    # BlazePose / ML Kit 33-landmark layout → COCO-17.
    "blazepose33": [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28],
}


def is_canonical_noop(keypoint_format: str) -> bool:
    """True when the native layout already IS the canonical layout (identity)."""
    return FORMAT_MAPS.get((keypoint_format or "").lower()) == _IDENTITY


def to_canonical(kpts: np.ndarray, keypoint_format: str) -> np.ndarray:
    """Map a native `(K, 3)` keypoint array to the canonical `(17, 3)` layout.

    Unknown formats raise (loud) rather than silently mis-indexing. Joints absent
    in the native format are returned as NaN so downstream can flag them."""
    fmt = (keypoint_format or "").lower()
    if fmt not in FORMAT_MAPS:
        raise ValueError(
            f"unknown keypoint_format {keypoint_format!r} — register it in "
            f"canonical_2d.FORMAT_MAPS (known: {sorted(FORMAT_MAPS)})"
        )
    src = np.asarray(kpts, dtype=float)
    idx = FORMAT_MAPS[fmt]
    out = np.full((NUM_CANON, 3), np.nan, dtype=float)
    for c, s in enumerate(idx):
        if s is not None and s < len(src):
            out[c] = src[s]
    return out
