import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';
import { BusinessConfig, SessionStatus } from '../types';
import { LIVE_MODEL } from '../constants';
import AudioVisualizer from './AudioVisualizer';
import { Mic, MicOff, PhoneOff, AlertCircle } from 'lucide-react';

interface LiveSessionProps {
  config: BusinessConfig;
  onClose: () => void;
}

// --- Audio Helper Functions ---
function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const LiveSession: React.FC<LiveSessionProps> = ({ config, onClose }) => {
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.CONNECTING);
  const [isMuted, setIsMuted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);

  // Audio Context Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // Playback Refs
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Session Ref
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-4), msg]);
  };

  const constructSystemInstruction = (c: BusinessConfig) => {
    return `
      You are a specialized AI Sales Assistant for "${c.businessName}", a company in the "${c.industry}" industry.
      
      PRODUCT/SERVICE DETAILS:
      ${c.productDescription}
      
      YOUR GOAL:
      Qualify the user as a potential lead by casually asking the following questions one by one. Do not ask them all at once. Integrate them naturally into the conversation.
      
      QUALIFICATION QUESTIONS:
      ${c.qualificationQuestions.map(q => `- ${q}`).join('\n')}
      
      TONE OF VOICE:
      ${c.toneOfVoice}
      
      INSTRUCTIONS:
      1. Start by introducing yourself and the company briefly.
      2. Ask the qualification questions naturally.
      3. If they answer a question, acknowledge it and move to the next or answer their questions about the product.
      4. Keep responses concise and conversational (under 3 sentences preferably).
      5. If the user seems qualified based on positive answers, suggest they schedule a consultation.
      6. If they are clearly not interested or not qualified, politely wrap up.
    `;
  };

  const disconnect = useCallback(() => {
    // Stop all audio sources
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();

    // Close Audio Contexts
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }

    // Stop tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Attempt to close session if possible (SDK doesn't expose explicit close on the promise easily, 
    // but we can just drop references and the server will timeout or we can send a close signal if available)
    sessionPromiseRef.current?.then(session => {
        // SDK example shows session.close() if available, or just letting it go.
        // Assuming session object might have close() based on standard WebSocket practices wrapped by SDK.
        // If not, we just clean up client side.
        if(typeof session.close === 'function') session.close();
    }).catch(() => {});
    
    sessionPromiseRef.current = null;
    setStatus(SessionStatus.DISCONNECTED);
  }, []);

  useEffect(() => {
    let active = true;

    const startSession = async () => {
      try {
        if (!process.env.API_KEY) {
            throw new Error("API Key not found in environment.");
        }

        setStatus(SessionStatus.CONNECTING);
        addLog("Initializing Audio Contexts...");

        // 1. Setup Audio Contexts
        const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        inputAudioContextRef.current = inputCtx;
        outputAudioContextRef.current = outputCtx;

        const outputNode = outputCtx.createGain();
        outputNode.connect(outputCtx.destination);

        addLog("Requesting Microphone...");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;

        // 2. Initialize Gemini Client
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        addLog("Connecting to Gemini Live API...");
        
        const configParams = {
            model: LIVE_MODEL,
            callbacks: {
              onopen: () => {
                if (!active) return;
                addLog("Session Connected!");
                setStatus(SessionStatus.CONNECTED);

                // Setup Input Processing
                const source = inputCtx.createMediaStreamSource(stream);
                inputSourceRef.current = source;
                
                // Using ScriptProcessor as per guide (AudioWorklet is better but more complex for single-file)
                const processor = inputCtx.createScriptProcessor(4096, 1, 1);
                processorRef.current = processor;

                processor.onaudioprocess = (e) => {
                  if (isMuted || !active) return;
                  
                  const inputData = e.inputBuffer.getChannelData(0);
                  
                  // Simple VAD (Voice Activity Detection) visualization trigger
                  const rms = Math.sqrt(inputData.reduce((sum, x) => sum + x * x, 0) / inputData.length);
                  if (rms > 0.02) {
                    setUserSpeaking(true);
                    // Debounce clearing user speaking
                    setTimeout(() => setUserSpeaking(false), 300);
                  }

                  const pcmBlob = createBlob(inputData);
                  
                  if (sessionPromiseRef.current) {
                      sessionPromiseRef.current.then(session => {
                          try {
                            session.sendRealtimeInput({ media: pcmBlob });
                          } catch (err) {
                              console.error("Error sending input", err);
                          }
                      });
                  }
                };

                source.connect(processor);
                processor.connect(inputCtx.destination);
              },
              onmessage: async (message: LiveServerMessage) => {
                if (!active) return;

                // Handle Audio Output
                const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (base64Audio) {
                    setAiSpeaking(true);
                    
                    // Track playback time
                    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);

                    const audioBuffer = await decodeAudioData(
                        decode(base64Audio),
                        outputCtx,
                        24000,
                        1
                    );

                    const source = outputCtx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(outputNode);
                    
                    source.onended = () => {
                        sourcesRef.current.delete(source);
                        if (sourcesRef.current.size === 0) {
                            setAiSpeaking(false);
                        }
                    };

                    source.start(nextStartTimeRef.current);
                    nextStartTimeRef.current += audioBuffer.duration;
                    sourcesRef.current.add(source);
                }

                // Handle Interruption
                if (message.serverContent?.interrupted) {
                    addLog("Interrupted by user");
                    sourcesRef.current.forEach(s => {
                        try { s.stop(); } catch(e){}
                    });
                    sourcesRef.current.clear();
                    nextStartTimeRef.current = 0;
                    setAiSpeaking(false);
                }
              },
              onclose: () => {
                if(active) {
                    addLog("Session Closed");
                    setStatus(SessionStatus.DISCONNECTED);
                }
              },
              onerror: (err: any) => {
                if(active) {
                    console.error(err);
                    setErrorMsg("Connection Error: " + (err.message || "Unknown error"));
                    setStatus(SessionStatus.ERROR);
                }
              }
            },
            config: {
                responseModalities: [Modality.AUDIO],
                systemInstruction: constructSystemInstruction(config),
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
                }
            }
        };

        // Connect
        sessionPromiseRef.current = ai.live.connect(configParams);

      } catch (err: any) {
        console.error("Setup failed", err);
        setErrorMsg(err.message || "Failed to initialize session");
        setStatus(SessionStatus.ERROR);
      }
    };

    startSession();

    return () => {
      active = false;
      disconnect();
    };
  }, [config, disconnect, isMuted]); // Re-run if config changes (though usually we'd want to just start a new session)

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 text-white rounded-xl overflow-hidden relative">
      
      {/* Header */}
      <div className="bg-slate-800 p-4 border-b border-slate-700 flex justify-between items-center">
        <div>
           <h2 className="font-semibold text-lg flex items-center gap-2">
             <span className={`w-3 h-3 rounded-full ${status === SessionStatus.CONNECTED ? 'bg-emerald-500 animate-pulse' : 'bg-yellow-500'}`}></span>
             Live Qualification Bot
           </h2>
           <p className="text-xs text-slate-400 font-mono">Model: {LIVE_MODEL}</p>
        </div>
        <button 
          onClick={onClose}
          className="bg-red-500/10 hover:bg-red-500/20 text-red-500 p-2 rounded-lg transition-colors"
        >
            <PhoneOff size={20} />
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-8 flex flex-col items-center justify-center relative">
         
         {/* Status / Error Message */}
         {status === SessionStatus.ERROR && (
             <div className="absolute top-4 left-4 right-4 bg-red-900/50 border border-red-500/50 text-red-200 p-4 rounded-lg flex items-center gap-3">
                 <AlertCircle />
                 <p>{errorMsg}</p>
             </div>
         )}

         {/* Visualizers */}
         <div className="w-full max-w-2xl space-y-12">
            
            {/* AI Avatar / Viz */}
            <div className="flex flex-col items-center gap-4">
                <div className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 ${aiSpeaking ? 'bg-blue-500/20 shadow-[0_0_50px_rgba(59,130,246,0.3)]' : 'bg-slate-800'}`}>
                    <div className={`w-24 h-24 rounded-full bg-gradient-to-tr from-blue-600 to-cyan-400 opacity-80 ${aiSpeaking ? 'animate-pulse scale-105' : 'scale-100'}`}></div>
                    {/* Ring animation */}
                    {aiSpeaking && (
                         <div className="absolute inset-0 rounded-full border-2 border-blue-400 opacity-50 animate-ping"></div>
                    )}
                </div>
                <div className="w-full">
                     <AudioVisualizer isActive={aiSpeaking} role="assistant" />
                     <p className="text-center text-slate-400 text-sm mt-2 font-mono uppercase tracking-wider">AI Assistant</p>
                </div>
            </div>

            {/* User Viz */}
            <div className="flex flex-col items-center gap-4">
                <div className="w-full">
                     <AudioVisualizer isActive={userSpeaking} role="user" />
                     <p className="text-center text-slate-400 text-sm mt-2 font-mono uppercase tracking-wider">You</p>
                </div>
            </div>

         </div>
      </div>

      {/* Controls */}
      <div className="bg-slate-800 p-6 border-t border-slate-700 flex justify-center gap-6">
         <button 
           onClick={toggleMute}
           className={`p-4 rounded-full transition-all duration-200 ${isMuted ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
         >
            {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
         </button>
      </div>

      {/* Connection Logs Overlay (Mini console) */}
      <div className="absolute bottom-24 left-4 pointer-events-none opacity-50">
          <div className="space-y-1">
              {logs.map((log, i) => (
                  <p key={i} className="text-[10px] font-mono text-emerald-400">{'>'} {log}</p>
              ))}
          </div>
      </div>

    </div>
  );
};

export default LiveSession;