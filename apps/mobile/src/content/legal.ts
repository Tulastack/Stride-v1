// Placeholder legal copy for the consent screen's Terms & Privacy modals.
// PLACEHOLDER — replace each section body with counsel-approved text before
// public release. Keep the structure (title + sections) so the UI needs no changes.

export const LEGAL_CONTACT_EMAIL = 'adhibanarul@gmail.com';

export interface LegalSection {
  heading: string;
  body: string;
}

export interface LegalDoc {
  title: string;
  sections: LegalSection[];
}

export const TERMS_AND_CONDITIONS: LegalDoc = {
  title: 'Terms & Conditions',
  sections: [
    {
      heading: '1. About Stride',
      body:
        'Stride is an AI-powered sprint coaching app. You record or import short sprint videos, and Stride analyzes your running form to give coaching feedback, drill suggestions, and training plans.',
    },
    {
      heading: '2. Not Medical Advice',
      body:
        'Stride provides coaching insights only. It is not a medical device and does not provide medical advice, diagnosis, or treatment. Consult a physician before starting any new training program, and stop training if you feel pain or discomfort.',
    },
    {
      heading: '3. Your Account',
      body:
        'You are responsible for the accuracy of the information you provide and for keeping your login credentials secure. Users under 18 need a parent or guardian to review and consent to their use of Stride.',
    },
    {
      heading: '4. Acceptable Use',
      body:
        'Only upload videos you have the right to share. Do not upload videos of other people without their permission, and do not use Stride for any unlawful purpose.',
    },
    {
      heading: '5. Limitation of Liability',
      body:
        'Sprinting and athletic training carry inherent risk of injury. To the maximum extent permitted by law, Stride is provided "as is" and we are not liable for injuries or losses arising from training decisions you make based on the app\'s feedback.',
    },
    {
      heading: '6. Contact',
      body: `Questions about these terms? Contact us at ${LEGAL_CONTACT_EMAIL}.`,
    },
  ],
};

export const PRIVACY_POLICY: LegalDoc = {
  title: 'Privacy Policy',
  sections: [
    {
      heading: '1. Data We Collect',
      body:
        'We collect the sprint videos you record or import, biometric motion data derived from them (body keypoints, joint angles, stride metrics), device motion-sensor data captured during recording (gyroscope and accelerometer), and your account profile (email, display name, event specialty, experience level, personal bests).',
    },
    {
      heading: '2. How We Use It',
      body:
        'Your videos and motion data are used solely to analyze your running form, generate coaching feedback and drill suggestions, and track your progress over time. We do not sell your data or use it for advertising.',
    },
    {
      heading: '3. Retention',
      body:
        'Videos and analysis results are retained while your account is active so you can review your history. Deleting your account permanently removes your videos, analyses, and coaching history from our systems.',
    },
    {
      heading: '4. Your Choices',
      body:
        'You can delete individual analyses or your entire account at any time from the app. You may also withdraw consent by deleting your account.',
    },
    {
      heading: '5. Contact',
      body: `For privacy questions or data requests, contact ${LEGAL_CONTACT_EMAIL}.`,
    },
  ],
};
