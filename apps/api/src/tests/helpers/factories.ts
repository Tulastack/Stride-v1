import { Pool } from 'pg';

export function createFactories(pool: Pool) {
  return {
    async createTestUser(overrides: Record<string, any> = {}) {
      const uid = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const { rows } = await pool.query(`
        INSERT INTO users (supabase_uid, email, consent_version, consent_given_at, parental_consent, is_injured)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [uid, overrides.email ?? `${uid}@stride.test`,
         overrides.consent_version ?? 1,
         overrides.consented !== false ? new Date() : null,
         overrides.parental_consent ?? false,
         overrides.is_injured ?? false]
      );
      return rows[0];
    },

    async createTestAnalysis(userId: string, overrides: Record<string, any> = {}) {
      const s3Key = `uploads/${userId}/test-${Date.now()}.mp4`;
      const { rows } = await pool.query(`
        INSERT INTO analyses (user_id, s3_key, status, overall_score, result_json)
        VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [userId, s3Key, overrides.status ?? 'completed', overrides.overall_score ?? 85,
         overrides.result_json ? JSON.stringify(overrides.result_json) : null]
      );
      return rows[0];
    },

    async truncateAll() {
      await pool.query(`
        TRUNCATE TABLE suggestion_audit, drill_suggestions, metrics_timeline,
          coach_sessions, calendar_events, conversations, analyses, users CASCADE`
      );
    },

    async assertNoCalendarEventsCreated(userId: string, snapshotCount: number) {
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int as count FROM calendar_events WHERE user_id = $1', [userId]
      );
      if (rows[0].count !== snapshotCount) {
        throw new Error(`Expected ${snapshotCount} calendar_events but found ${rows[0].count}`);
      }
    },

    async seedReferenceDrills() {
      await pool.query(`
        INSERT INTO reference_drills (key, name, video_url, cues, contraindications, target_metrics)
        VALUES
          ('a_skips','A-Skips','https://cdn.stride.ai/drills/a-skips.mp4','["Drive knee to 90°"]','[]','["knee_drive_angle"]'),
          ('wall_drills','Wall Drills','https://cdn.stride.ai/drills/wall-drills.mp4','["Full hip extension"]','["lower_back_pain"]','["hip_extension"]')
        ON CONFLICT (key) DO NOTHING`
      );
    },
  };
}
