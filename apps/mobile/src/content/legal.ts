// Placeholder legal copy for the consent screen's Terms & Privacy modals.
// PLACEHOLDER, replace each section body with counsel-approved text before
// public release. Keep the structure (title + sections) so the UI needs no changes.

export const LEGAL_ENTITY = 'Stride Biometrics, LLC';

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
        `Stride is an AI-powered sprint coaching app operated by ${LEGAL_ENTITY} ("we" or "us"). You record or import short sprint videos, and Stride analyzes your running form to give coaching feedback, drill suggestions, and training plans.`,
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
      body:
        'Questions about these terms can be sent through TestFlight Share Beta Feedback. Do not include your password.',
    },
  ],
};

export const PRIVACY_POLICY: LegalDoc = {
  title: 'Privacy Policy',
  sections: [
    {
      heading: '1. Data We Collect',
      body:
        `${LEGAL_ENTITY} ("we") operates Stride. We collect the sprint videos you record or import, biometric motion data derived from them (body keypoints, joint angles, stride metrics), device motion-sensor data captured during recording (gyroscope and accelerometer), and your account profile (email, display name, event specialty, experience level, personal bests).`,
    },
    {
      heading: '2. How We Use It',
      body:
        'Your videos and motion data are used to analyze your running form, generate coaching feedback and drill suggestions, and track your progress over time. Messages you send the coach are stored so the coach can reply in that conversation. We do not sell your data or use it for advertising.',
    },
    {
      heading: '3. Service Providers',
      body:
        'We use a small number of service providers to run Stride: Supabase for sign-in and your account profile, and Amazon Web Services for video storage, the analysis worker, and the database. Coaching replies are written by a language-model provider, currently Inception Labs. That request includes the metrics from your analyses, your training context, and the messages you send the coach. Your sprint videos are not sent to the language-model provider. These providers process data only to provide their service to us.',
    },
    {
      heading: '4. Retention',
      body:
        'Videos and analysis results are retained while your account is active so you can review your history. Deleting your account permanently removes your videos, analyses, and coaching history from our systems.',
    },
    {
      heading: '5. Your Choices',
      body:
        'You can delete individual analyses or your entire account at any time from the app. You may also withdraw consent by deleting your account.',
    },
    {
      heading: '6. Contact',
      body:
        `Privacy and deletion requests are made in the app under Settings, Delete Account. ${LEGAL_ENTITY} does not publish a personal email address in this policy. Other privacy questions can be sent through TestFlight Share Beta Feedback. Do not include your password or a video.`,
    },
  ],
};
