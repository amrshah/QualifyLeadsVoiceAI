export interface BusinessConfig {
  businessName: string;
  industry: string;
  productDescription: string;
  qualificationQuestions: string[];
  toneOfVoice: 'professional' | 'friendly' | 'enthusiastic' | 'direct';
  apiKey?: string;
}

export enum SessionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}
