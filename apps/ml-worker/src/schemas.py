"""Pydantic v2 models matching the PRD's LLM output contract for sprint analysis."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class Drill(BaseModel):
    """A corrective drill prescribed for a specific biomechanical issue."""

    name: str = Field(..., min_length=1, max_length=100)
    volume: str = Field(..., min_length=1, max_length=50)
    cue: str = Field(..., min_length=1, max_length=200)


class PrimaryIssue(BaseModel):
    """A single biomechanical issue identified during analysis."""

    rank: int = Field(..., ge=1, le=3)
    type: str = Field(..., min_length=1)
    severity: Literal["low", "medium", "high"]
    measured_value: str
    optimal_range: str
    plain_english: str = Field(..., max_length=500)
    drills: list[Drill] = Field(..., min_length=1, max_length=3)
    timeline: str = Field(..., max_length=200)


class AnalysisResult(BaseModel):
    """Top-level analysis result returned by the LLM and stored in the DB."""

    overall_score: int = Field(..., ge=0, le=100)
    score_label: str = Field(..., max_length=200)
    movenet_version: str
    primary_issues: list[PrimaryIssue] = Field(..., max_length=3)

    # ------------------------------------------------------------------
    # Validators
    # ------------------------------------------------------------------

    @field_validator("primary_issues")
    @classmethod
    def validate_ranks_unique_and_ordered(
        cls, issues: list[PrimaryIssue],
    ) -> list[PrimaryIssue]:
        """Ensure ranks are unique and sorted in ascending order (1, 2, 3)."""
        if not issues:
            return issues

        ranks = [issue.rank for issue in issues]

        # Uniqueness check
        if len(ranks) != len(set(ranks)):
            raise ValueError(
                f"Duplicate ranks detected: {ranks}. Each issue must have a unique rank."
            )

        # Ordering check – ranks must be monotonically increasing
        for i in range(1, len(ranks)):
            if ranks[i] <= ranks[i - 1]:
                raise ValueError(
                    f"Ranks must be in ascending order, got: {ranks}"
                )

        # Contiguous starting at 1
        expected = list(range(1, len(ranks) + 1))
        if ranks != expected:
            raise ValueError(
                f"Ranks must be contiguous starting at 1, got: {ranks}"
            )

        return issues

    @model_validator(mode="after")
    def validate_score_consistency(self) -> "AnalysisResult":
        """If there are no issues the score should be near-perfect."""
        if not self.primary_issues and self.overall_score < 85:
            raise ValueError(
                "overall_score should be >= 85 when there are no primary issues detected."
            )
        return self
