"""LLM integration module for generating structured biomechanical sprint reports.

Integrates Gemini 2.5 Pro (via google-genai) with Pydantic validation schemas.
Implements robust fallbacks to Gemini 2.5 Flash and Groq (Llama 3 70B).
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from google import genai
from google.genai import types
from groq import Groq
from pydantic import ValidationError

from src.schemas import AnalysisResult

logger = logging.getLogger(__name__)

# ─── Elite Sprint Coaching Knowledge Base ──────────────────────────────
COACHING_KNOWLEDGE: str = """
Stride Sprint Coaching Biomechanical Knowledge Base:

1. KNEE DRIVE (KNEE FLEXION & HIP FLEXION)
- Optimal mechanics: During the recovery phase, the thigh of the lead leg should drive forward and upward, reaching an angle of 90° to 95° relative to the vertical line of the torso. Active dorsiflexion of the ankle (toes pointed up) is critical to create a shorter lever arm, allowing for faster hip flexion.
- Biomechanical consequence: Low knee drive reduces stride length and decreases flight time, which limits force application on the subsequent stride.
- Corrective drills:
  * A-Skips (drill_key: a_skips): Focusing on active knee drive and synchronized arm action. Cue: "Drive the knee high, punch the foot down."
  * Wall Drills (1-2-3 switch) (drill_key: wall_drills): High knee drive positioning against a wall at a 45-degree angle. Cue: "Dorsiflex the ankle, step over the opposite knee."
  * Power Skips (drill_key: power_skips): Explosive vertical drive for stride length. Cue: "Maximum height per skip, full arm drive."

2. FORWARD LEAN / POSTURE
- Optimal mechanics: During max-velocity sprinting, the torso should maintain a slight, natural forward lean of 5° to 15° from the vertical line. This lean must originate from the ankles, not by bending at the waist (hip flexion). The head, neck, and spine must maintain neutral alignment.
- Biomechanical consequence: Bending at the waist (excessive forward lean >25°) forces the center of mass too far forward, leading to premature foot strike ahead of the center of mass (overstriding), lower back strain, and restricted hip flexion (low knee drive).
- Corrective drills:
  * Sled Pulls (light load) (drill_key: sled_pulls): Reinforces proper forward acceleration lean without breaking posture at the waist. Cue: "Drive the ground away, keep a straight line from ankle to head."
  * Lean March (drill_key: torso_lean_march): Forward lean and posture drill for acceleration. Cue: "Lean from ankles not waist, drive arms aggressively."
  * Wicket Runs (drill_key: wicket_runs): Stride length and frequency drill with hurdles. Cue: "Consistent stride pattern, high hips."

3. ARM DRIVE (SHOULDER KINEMATICS)
- Optimal mechanics: Arm swing should occur primarily at the shoulder joint in a sagittal plane, with minimal lateral crossing. The elbow angle should remain relatively open at approximately 90° to 110° on the backswing, and close slightly during the forward swing. Range of motion must cover the pocket (hands back) to the chin (hands forward).
- Biomechanical consequence: Short, tense, or sideways arm swings decrease rotational counter-balance, reducing stride frequency and overall horizontal power.
- Corrective drills:
  * Standing Arm Swings (drill_key: standing_arm_swings): Seated or standing isolated arm drive. Cue: "Hands from pocket to chin, drive elbows straight back."
  * Hip Mobility Circles (drill_key: hip_circles): Dynamic hip flexor and rotator mobilization. Cue: "Full range of motion, control the movement."

4. HIP EXTENSION & TOEOFF FORCE
- Optimal mechanics: At the terminal extension of the stance phase (toe-off), the trail leg should achieve near-complete triple extension across the hip, knee, and ankle joints. The hip extension angle should reach 170° to 180° to maximize horizontal force application.
- Biomechanical consequence: Incomplete hip extension ("short-striding") limits the horizontal force applied to the track, drastically reducing stride length and acceleration power.
- Corrective drills:
  * Resisted Sled Pulls (drill_key: sled_pulls): Loaded acceleration for power development. Cue: "Lean into harness 45°, powerful triple extension."
  * Wall Drills (drill_key: wall_drills): Static wall drive for acceleration mechanics. Cue: "Step over opposite knee, full hip extension."
  * Power Skips (drill_key: power_skips): Explosive vertical drive for stride length. Cue: "Maximum height per skip, full arm drive."

5. OVERSTRIDING (FOOT STRIKE POSITION)
- Optimal mechanics: The foot should strike the ground directly underneath or only slightly ahead (within 0.06 normalized coordinate units) of the athlete's center of mass (mid-hip midpoint). Strikepoint should be on the ball of the foot (midfoot/forefoot) rather than the heel.
- Biomechanical consequence: Striking the ground far ahead of the hips creates a massive braking force, increases ground contact time, and places extreme impact stress on the knees and hamstrings.
- Corrective drills:
  * B-Skips (drill_key: b_skips): Extended A-skip with pawback for stride mechanics. Cue: "Cycle through full ROM, pawback before ground contact."
  * Ankle Stiffness Jumps (drill_key: ankle_stiffness): Rapid ground contact for reactive strength. Cue: "Minimal ground contact time, land mid-foot."
  * Wicket Runs (drill_key: wicket_runs): Stride length and frequency drill with hurdles. Cue: "Consistent stride pattern, high hips."
"""


def _generate_fallback_groq(prompt: str) -> dict[str, Any]:
    """Fallback generator using Groq's Llama 3 70B model."""
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY is not configured for fallback.")

    logger.info("Executing Groq (Llama 3 70B) fallback analysis...")
    client = Groq(api_key=api_key)

    system_message = (
        "You are an elite sprint coach and expert biomechanist. "
        "Analyze the provided biomechanical data and output a valid JSON report matching the schema. "
        "Keep recommendations concise and personalized. "
        "Do NOT include any chat preamble, long-winded text, or markdown formatting (like ```json) other than raw JSON. "
        "Ensure the output conforms exactly to this JSON schema structure:\n"
        "{\n"
        '  "overall_score": 85,\n'
        '  "score_label": "Excellent job...",\n'
        '  "movenet_version": "singlepose-thunder-v4",\n'
        '  "primary_issues": [\n'
        "    {\n"
        '      "rank": 1,\n'
        '      "type": "low_knee_drive",\n'
        '      "severity": "medium",\n'
        '      "measured_value": "82.5°",\n'
        '      "optimal_range": "90–95°",\n'
        '      "plain_english": "Your knee drive is slightly low...",\n'
        '      "drills": [\n'
        '        {"drill_key": "a_skips", "name": "A-Skips", "volume": "3 sets of 20m", "cue": "Punch foot down"}\n'
        "      ],\n"
        '      "timeline": "2-3 weeks"\n'
        "    }\n"
        "  ]\n"
        "}"
    )

    chat_completion = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
        response_format={"type": "json_object"},
    )

    content = chat_completion.choices[0].message.content
    if not content:
        raise ValueError("Empty response from Groq")

    return json.loads(content)


def generate_sprint_report(
    analysis_summary: dict[str, Any],
    detected_issues: list[dict[str, Any]],
) -> AnalysisResult:
    """Send biomechanics data to Gemini 2.5 Pro to synthesize structured sprint feedback.

    Args:
        analysis_summary: Summary statistics from biomechanics.analyze().
        detected_issues: List of detected issues (up to 3) from biomechanics.analyze().

    Returns:
        An instantiated Pydantic AnalysisResult model.
    """
    prompt = f"""
Sprint Athlete Biomechanics Data:
- Summary Statistics: {json.dumps(analysis_summary)}
- Rules-based Detected Issues: {json.dumps(detected_issues)}

Instructions:
1. Your ENTIRE response MUST be strictly valid JSON matching the schema. No preamble, no markdown.
2. Focus on the SINGLE most impactful issue — the one that, if fixed, would improve performance the most. If there is a clear secondary issue, include it (max 2 total). Do NOT list 3+ issues — athletes fix one thing at a time.
3. Determine a unified `overall_score` (0-100) reflecting their technique quality.
4. Draft a concise, motivating `score_label` (1 sentence max). Be direct, not generic.
5. For each issue (1-2 max):
   - Write a `plain_english` coaching cue: what's wrong, why it costs them speed, and the ONE thing to focus on fixing (2 sentences max).
   - Prescribe exactly 2 corrective drills with specific volume (sets × distance), frequency (days/week), and a single coaching cue per drill. Use valid `drill_key` values from the knowledge base.
   - Provide a realistic improvement `timeline` (e.g., '2 weeks', '3 weeks').

Reference Sprint Coaching Knowledge Base:
{COACHING_KNOWLEDGE}
"""

    gemini_key = os.environ.get("GEMINI_API_KEY")
    if not gemini_key:
        raise ValueError("GEMINI_API_KEY environment variable is not configured.")

    client = genai.Client(api_key=gemini_key)

    # 1. Attempt Gemini 2.5 Pro
    try:
        logger.info("Calling Gemini 2.5 Pro for report generation...")
        response = client.models.generate_content(
            model="gemini-2.5-pro",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=AnalysisResult,
                temperature=0.2,
            ),
        )
        if response.text:
            data = json.loads(response.text)
            return AnalysisResult(**data)
        raise ValueError("Empty response from Gemini 2.5 Pro")
    except Exception as err:
        logger.warning("Gemini 2.5 Pro failed: %s. Falling back to Gemini 2.5 Flash...", err)

    # 2. Attempt Gemini 2.5 Flash
    try:
        logger.info("Calling Gemini 2.5 Flash for report generation...")
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=AnalysisResult,
                temperature=0.2,
            ),
        )
        if response.text:
            data = json.loads(response.text)
            return AnalysisResult(**data)
        raise ValueError("Empty response from Gemini 2.5 Flash")
    except Exception as err:
        logger.warning("Gemini 2.5 Flash failed: %s. Falling back to Groq...", err)

    # 3. Attempt Groq Fallback
    try:
        raw_json = _generate_fallback_groq(prompt)
        # Standardize movenet_version if missing
        raw_json["movenet_version"] = raw_json.get("movenet_version") or "singlepose-thunder-v4"
        return AnalysisResult(**raw_json)
    except Exception as err:
        logger.error("All LLM providers failed to generate sprint report: %s", err)
        raise
