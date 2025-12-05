import { BusinessConfig } from './types';

export const DEFAULT_CONFIG: BusinessConfig = {
  businessName: "Acme Solar Solutions",
  industry: "Residential Solar Panels",
  productDescription: "High-efficiency solar panel installation with 25-year warranty and $0 down financing options.",
  qualificationQuestions: [
    "Do you own your home?",
    "Is your monthly electricity bill over $100?",
    "Is your roof in good condition?",
    "Are you looking to install solar within the next 3 months?"
  ],
  toneOfVoice: 'friendly'
};

export const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';
