import { Router } from 'express';
import { z } from 'zod';
import type { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import type { AuthenticatedRequest, ConversationMessage } from '../types.js';
import {
  createConversation,
  getConversation,
  addMessage,
  updateSummary,
  getAnalysisByIdOnly,
  getAnalysesByUser,
  createCalendarEvents,
  getConversationsByUser,
} from '../db/queries.js';

const router = Router();

const conversationSchema = z.object({
  analysisId: z.string().uuid().optional(),
});

const messageSchema = z.object({
  content: z.string().min(1).max(5000),
});

/**
 * 1. Create a new conversation
 */
router.post('/conversations', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { analysisId } = conversationSchema.parse(req.body);
    const userId = req.userId;

    if (analysisId) {
      const analysis = await getAnalysisByIdOnly(analysisId);
      if (!analysis || analysis.user_id !== userId) {
        res.status(404).json({ error: 'Analysis not found' });
        return;
      }
    }

    const conversation = await createConversation(userId, analysisId ?? null);
    res.json(conversation);
  } catch (err) {
    next(err);
  }
});

/**
 * 2. List user conversations
 */
router.get('/conversations', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    const conversations = await getConversationsByUser(userId);
    res.json(conversations);
  } catch (err) {
    next(err);
  }
});

/**
 * 3. Get specific conversation details and messages
 */
router.get('/conversations/:conversationId', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { conversationId } = req.params;
    const userId = req.userId;

    const conversation = await getConversation(conversationId, userId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    res.json(conversation);
  } catch (err) {
    next(err);
  }
});

/**
 * 4. Send a message to the AI coach and get a response
 */
router.post('/conversations/:conversationId/messages', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { conversationId } = req.params;
    const { content } = messageSchema.parse(req.body);
    const userId = req.userId;

    // Fetch conversation and verify ownership
    const conversation = await getConversation(conversationId, userId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Save user's message
    const userMessage: ConversationMessage = {
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
    await addMessage(conversationId, userMessage);

    // Prepare system instructions and conversation history for Gemini
    let systemInstruction = `You are "Stride Coach", an elite sprint coach and expert biomechanist. 
Your goal is to guide solo athletes on improving their sprinting form using structured, biomechanically-driven advice.
Keep your tone encouraging, direct, and authoritative yet supportive. Focus on giving action-oriented feedback.
When discussing drills, specify exactly what cues to keep in mind. Do not give generic workout plans; give specific biomechanical insights.`;

    // If conversation is linked to a completed analysis, enrich the system instructions
    if (conversation.analysis_id) {
      // Instant Analysis Workflow
      const analysis = await getAnalysisByIdOnly(conversation.analysis_id);
      if (analysis && analysis.status === 'completed' && analysis.result_json) {
        const result = analysis.result_json as any;
        systemInstruction += `\n\nThis is an instant analysis workflow. You have access to the athlete's completed sprint biomechanics analysis for their recent video upload.
Analysis Details:
- Overall Score: ${result.overall_score}/100 (${result.score_label ?? 'N/A'})
- MoveNet Keypoints Subsampling Version: ${result.movenet_version ?? 'Thunder'}
- Primary Issues Detected:
${result.primary_issues?.map((issue: any) => {
  const drillsList = issue.drills?.map((d: any) => `  * Drill: ${d.name} (${d.volume}) - Cue: "${d.cue}"`).join('\n') ?? '';
  return `* Issue rank #${issue.rank}: ${issue.type} (${issue.severity} severity)
  - Measured Value: ${issue.measured_value} vs Optimal Range: ${issue.optimal_range}
  - Description: ${issue.plain_english}
  - Corrective Drills:
${drillsList}
  - Recommended Timeline: ${issue.timeline}`;
}).join('\n\n') ?? 'None'}

Incorporate these findings naturally into your conversation when relevant. Refer specifically to their measured values, optimal ranges, and recommend the corrective drills.`;
      }
    } else {
      // Long-term Coach Workflow
      const pastAnalyses = await getAnalysesByUser(userId);
      const completedAnalyses = pastAnalyses.filter((a) => a.status === 'completed' && a.result_json);

      systemInstruction += `\n\nThis is a long-term coaching conversation. You are the athlete's continuous coach. You have access to their past biomechanical analyses to identify trends, progress, and persistent issues.
Past Analyses (most recent first):
${completedAnalyses.slice(0, 5).map((a) => {
  const r = a.result_json as any;
  const issues = r.primary_issues?.map((i: any) => i.type).join(', ') || 'None';
  return `- Date: ${new Date(a.created_at).toLocaleDateString()} | Score: ${r.overall_score}/100 | Issues: ${issues}`;
}).join('\n') || 'No past analyses available yet.'}

Your role is to develop structured training and recovery schedules based on these past analyses. 
When the user approves a recommended schedule (e.g., drills, rest days), you MUST automatically sync it to their calendar. 
To sync, include a JSON block formatted exactly like this in your response:
\`\`\`calendar_events
[
  {
    "title": "Sprint Drills - A-Skips",
    "event_type": "drill",
    "scheduled_date": "2026-05-25",
    "details": { "focus": "Knee drive and posture" }
  },
  {
    "title": "Active Recovery",
    "event_type": "rest",
    "scheduled_date": "2026-05-26",
    "details": { "focus": "Light stretching and hydration" }
  }
]
\`\`\`
The backend will automatically parse this block and sync the events. Be sure to confirm to the user that you have synced their calendar.`;
    }

    // Call Gemini API REST endpoint using fetch
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not configured');
    }

    // Load full message history (including the newly added user message)
    const allMessages = [...conversation.messages, userMessage];

    // Format for Gemini API contents array
    const contents = allMessages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API request failed:', errText);
      throw new Error(`Gemini API error: ${response.statusText}`);
    }

    const resJson = (await response.json()) as any;
    let assistantText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!assistantText) {
      throw new Error('No text content returned from Gemini API');
    }

    // Extract and sync calendar events
    const calendarRegex = /```calendar_events\n([\s\S]*?)\n```/;
    const match = assistantText.match(calendarRegex);
    if (match) {
      try {
        const events = JSON.parse(match[1]);
        if (Array.isArray(events) && events.length > 0) {
          await createCalendarEvents(userId, events);
          // Remove the JSON block from the text displayed to the user
          assistantText = assistantText.replace(calendarRegex, '').trim();
        }
      } catch (parseErr) {
        console.error('Failed to parse calendar_events JSON:', parseErr);
      }
    }

    // Save coach response to DB
    const assistantMessage: ConversationMessage = {
      role: 'assistant',
      content: assistantText,
      timestamp: new Date().toISOString(),
    };
    await addMessage(conversationId, assistantMessage);

    // Background task: Summarize conversation asynchronously if message count modulo 4 === 0
    const updatedMessages = [...allMessages, assistantMessage];
    if (updatedMessages.length % 4 === 0) {
      // Fire-and-forget background summarization
      (async () => {
        try {
          const summarizePrompt = `Please summarize the following sprint coaching conversation in one concise sentence:
\n\n${updatedMessages.map((m) => `${m.role === 'assistant' ? 'Coach' : 'Athlete'}: ${m.content}`).join('\n')}`;

          const summaryResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: summarizePrompt }] }],
            }),
          });
          if (summaryResponse.ok) {
            const sumJson = (await summaryResponse.json()) as any;
            const summaryText = sumJson.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (summaryText) {
              await updateSummary(conversationId, summaryText);
              console.log(`[Summary Job] Updated summary for conversation ${conversationId}`);
            }
          }
        } catch (sumErr) {
          console.error('[Summary Job] Background summarization failed:', sumErr);
        }
      })();
    }

    res.json(assistantMessage);
  } catch (err) {
    next(err);
  }
});

export default router;
