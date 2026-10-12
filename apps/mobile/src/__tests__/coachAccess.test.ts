import { proposalDetails, usageCaption, type CoachProposal } from '../lib/coachAccess';

const proposal = (action: CoachProposal['action'], before?: CoachProposal['before']): CoachProposal =>
  ({ token: 't', label: 'Change', action, before });

describe('coach usage caption', () => {
  it('hides when the server runs without a cap', () => {
    expect(usageCaption(null)).toBeNull();
    expect(usageCaption({ used: 4, cap: 0, remaining: null, period: 'beta' })).toBeNull();
  });
  it('counts down and names the period', () => {
    expect(usageCaption({ used: 3, cap: 20, remaining: 17, period: 'beta' })).toBe('17 of 20 coach messages left for the beta');
    expect(usageCaption({ used: 3, cap: 20, remaining: 17, period: '2026-10' })).toBe('17 of 20 coach messages left this month');
  });
  it('points to what stays available once the allowance is used', () => {
    expect(usageCaption({ used: 20, cap: 20, remaining: 0, period: 'beta' })).toMatch(/remain fully available/);
  });
});

describe('proposal details for the new coach actions', () => {
  it('describes status changes, suggestions and reduce motion', () => {
    expect(proposalDetails(proposal({ kind: 'set_event_status', status: 'completed', eventId: 'e' }, { title: 'Tempo', scheduled_date: '2026-10-12' })))
      .toBe('2026-10-12: Tempo\nMark as completed');
    expect(proposalDetails(proposal({ kind: 'approve_suggestion', suggestionId: 's' }, { drill_name: 'Wall drives' }))).toBe('Wall drives\nAdds it to your training');
    expect(proposalDetails(proposal({ kind: 'skip_suggestion', suggestionId: 's' }, { drill_name: 'Wall drives' }))).toBe('Wall drives\nSets it aside');
    expect(proposalDetails(proposal({ kind: 'reduce_motion', value: true }))).toBe('Reduce motion: on');
  });
});
