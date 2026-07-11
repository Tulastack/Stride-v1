// Curated reference runners shown on the Progress tab's Insights view, for
// athletes to compare their own form check against. Placeholder content —
// swap in real names/notes/clips when available (no video asset pipeline for
// these yet, so `videoUrl` is left unset).

export interface ExampleRunner {
  id: string;
  name: string;
  specialty: string;
  formNote: string;
  videoUrl?: string;
}

export const EXAMPLE_RUNNERS: ExampleRunner[] = [
  {
    id: 'example-1',
    name: 'Elite 100m sprinter',
    specialty: '100m',
    formNote: 'Watch the knee drive height and how upright the torso stays through max velocity.',
  },
  {
    id: 'example-2',
    name: 'Elite 400m runner',
    specialty: '400m',
    formNote: 'Watch how cadence and stride length stay consistent even as fatigue sets in late in the race.',
  },
  {
    id: 'example-3',
    name: 'Elite distance runner',
    specialty: 'Distance',
    formNote: 'Watch the short ground-contact time and relaxed arm swing at an efficient, sustainable pace.',
  },
];
