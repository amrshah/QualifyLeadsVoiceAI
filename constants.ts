import { BusinessConfig } from './types';

export const DEFAULT_CONFIG: BusinessConfig = {
  businessName: "Silver Ant Marketing",
  industry: "Full-Service Digital Marketing Agency",
  productDescription:
    "We help businesses grow through performance-driven digital marketing — including SEO, Google Ads, Social Media Marketing, Web Development, Branding, and Content Creation.",
  qualificationQuestions: [
    "Which services are you looking for? (SEO, Social Media, PPC, Web Development, Branding, etc.)",
    "What is the biggest marketing challenge you're facing right now?",
    "Do you currently have an in-house marketing team or agency?",
    "What is your expected timeline to start the project?",
    "What monthly marketing budget are you considering?"
  ],
  toneOfVoice: 'friendly',
  apiKey: ''
};

export const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';
