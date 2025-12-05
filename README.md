# QualifyAI - Live Lead Qualification Voice Bot

QualifyAI is a real-time voice assistant designed to qualify website leads using natural conversation. Built with React, Vite, and Google's Gemini Multimodal Live API, it acts as an intelligent sales representative that can interview potential customers, understand their needs, and determine if they are a good fit for your business.

## Features

- **Real-time Voice Interaction**: Talk to the bot naturally with low-latency responses.
- **Configurable Business Profile**: Customize the bot's persona, industry, and tone of voice.
- **Dynamic Qualification**: Define your own qualification questions (e.g., budget, timeline, authority).
- **Visual Feedback**: Real-time audio visualizers for both user and AI.
- **Privacy Focused**: API keys are not stored; use your own key for the demo.

## Demo

Live Demo: [https://amrshah.github.io/QualifyLeadsVoiceAI/](https://amrshah.github.io/QualifyLeadsVoiceAI/)

> **Note**: You will need a valid Google Gemini API Key to use the demo. You can get one from [Google AI Studio](https://aistudio.google.com/).

## Setup & Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/amrshah/QualifyLeadsVoiceAI.git
    cd QualifyLeadsVoiceAI
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Run locally**
    ```bash
    npm run dev
    ```

## Development

- **`App.tsx`**: Main entry point managing routing between config and live session.
- **`components/ConfigForm.tsx`**: Form to set up the business context and questions.
- **`components/LiveSession.tsx`**: Handles the WebRTC connection with Gemini, audio processing, and UI visualization.

## Deployment to GitHub Pages

This project is configured for GitHub Pages hosting.

1.  **Configuration**:
    The `vite.config.ts` file is already set up with `base: '/QualifyLeadsVoiceAI/'`. If you deploy to a different repository name, update this value.

2.  **Build**:
    ```bash
    npm run build
    ```
    This will generate a `dist` folder containing the static assets.

3.  **Deploy**:
    Push the contents of the `dist` folder to your `gh-pages` branch, or configure your GitHub repository to deploy from the main branch's `dist` folder (if using a custom workflow).

    *Recommended: Use a GitHub Action to build and deploy automatically on push.*

## Tech Stack

- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS
- **AI**: Google Gemini Multimodal Live API through `@google/genai` SDK
- **Icons**: Lucide React

## License

MIT
