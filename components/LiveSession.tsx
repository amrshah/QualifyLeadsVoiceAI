import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';
import { BusinessConfig, SessionStatus } from '../types';
import { LIVE_MODEL } from '../constants';
import AudioVisualizer from './AudioVisualizer';
import { Mic, MicOff, PhoneOff, AlertCircle, RotateCcw, MessageSquare } from 'lucide-react';

interface LiveSessionProps {
  config: BusinessConfig;
  onClose: () => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
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
  const [retryTrigger, setRetryTrigger] = useState(0);

  // Chat State
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [realtimeInput, setRealtimeInput] = useState('');
  const [realtimeOutput, setRealtimeOutput] = useState('');

  // Audio Context Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // State Refs for Closures
  const isMutedRef = useRef(false);
  
  // Playback Refs
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Transcription Refs
  const inputBufferRef = useRef('');
  const outputBufferRef = useRef('');
  const chatScrollRef = useRef<HTMLDivElement>(null);
  
  // Session Ref
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  // Keep Ref in sync with state
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [history, realtimeInput, realtimeOutput]);

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

    // Attempt to close session if possible
    sessionPromiseRef.current?.then(session => {
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
        setErrorMsg(null);
        setHistory([]); // Clear history on new session
        inputBufferRef.current = '';
        outputBufferRef.current = '';
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
                
                // Using ScriptProcessor as per guide
                const processor = inputCtx.createScriptProcessor(4096, 1, 1);
                processorRef.current = processor;

                processor.onaudioprocess = (e) => {
                  if (isMutedRef.current || !active) return;
                  
                  const inputData = e.inputBuffer.getChannelData(0);
                  
                  // Simple VAD
                  const rms = Math.sqrt(inputData.reduce((sum, x) => sum + x * x, 0) / inputData.length);
                  if (rms > 0.02) {
                    setUserSpeaking(true);
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

                // Handle Transcription
                const serverContent = message.serverContent;
                if (serverContent?.inputTranscription) {
                  const text = serverContent.inputTranscription.text;
                  if (text) {
                    inputBufferRef.current += text;
                    setRealtimeInput(inputBufferRef.current);
                  }
                }
                if (serverContent?.outputTranscription) {
                  const text = serverContent.outputTranscription.text;
                  if (text) {
                    outputBufferRef.current += text;
                    setRealtimeOutput(outputBufferRef.current);
                  }
                }
                
                // Handle Turn Completion (Commit to History)
                if (serverContent?.turnComplete) {
                  const userText = inputBufferRef.current.trim();
                  const aiText = outputBufferRef.current.trim();
                  const now = new Date();
                  
                  if (userText) {
                    setHistory(prev => [...prev, { role: 'user', text: userText, timestamp: now }]);
                  }
                  if (aiText) {
                    setHistory(prev => [...prev, { role: 'assistant', text: aiText, timestamp: now }]);
                  }
                  
                  // Clear buffers
                  inputBufferRef.current = '';
                  outputBufferRef.current = '';
                  setRealtimeInput('');
                  setRealtimeOutput('');
                }

                // Handle Interruption
                if (serverContent?.interrupted) {
                    addLog("Interrupted by user");
                    sourcesRef.current.forEach(s => {
                        try { s.stop(); } catch(e){}
                    });
                    sourcesRef.current.clear();
                    nextStartTimeRef.current = 0;
                    setAiSpeaking(false);
                    
                    // If output was interrupted, commit what we have
                    if (outputBufferRef.current.trim()) {
                      setHistory(prev => [...prev, { role: 'assistant', text: outputBufferRef.current.trim() + "...", timestamp: new Date() }]);
                    }
                    outputBufferRef.current = '';
                    setRealtimeOutput('');
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
                },
                inputAudioTranscription: {},
                outputAudioTranscription: {},
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
  }, [config, disconnect, retryTrigger]);

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  const handleRetry = () => {
    setRetryTrigger(prev => prev + 1);
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

      {/* Main Content Area */}
      <div className="flex-1 p-4 md:p-8 flex flex-col md:flex-row gap-6 relative overflow-hidden">
         
         {/* Status / Error Message */}
         {status === SessionStatus.ERROR && (
             <div className="absolute top-4 left-4 right-4 bg-red-900/90 border border-red-500/50 text-red-200 p-4 rounded-lg flex items-center justify-between gap-3 shadow-lg z-20 backdrop-blur-sm">
                 <div className="flex items-center gap-3">
                    <AlertCircle className="shrink-0 text-red-400" />
                    <p className="text-sm font-medium">{errorMsg}</p>
                 </div>
                 <button 
                    onClick={handleRetry}
                    className="flex items-center gap-2 bg-red-500 hover:bg-red-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
                 >
                    <RotateCcw size={16} />
                    Retry
                 </button>
             </div>
         )}

         {/* Left Side: Visualizers */}
         <div className="flex-1 flex flex-col items-center justify-center min-h-[300px]">
             <div className="w-full max-w-xl space-y-12">
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

         {/* Right Side: Chat History */}
         <div className="w-full md:w-80 lg:w-96 bg-slate-800/50 rounded-lg border border-slate-700/50 flex flex-col overflow-hidden shrink-0 h-[300px] md:h-auto z-10">
            <div className="p-3 border-b border-slate-700/50 font-medium text-sm text-slate-400 flex items-center gap-2 bg-slate-900/50">
                <MessageSquare size={16} />
                Live Transcript
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans" ref={chatScrollRef}>
                {history.length === 0 && !realtimeInput && !realtimeOutput && (
                    <div className="text-center text-slate-600 text-sm py-10 italic">
                        Conversation started...
                    </div>
                )}
                
                {history.map((msg, i) => (
                    <div key={i} className={`flex flex-col ${msg.role === 'assistant' ? 'items-start' : 'items-end'} group`}>
                        <div className={`max-w-[90%] rounded-2xl px-4 py-2 text-sm leading-relaxed shadow-sm ${
                            msg.role === 'assistant' 
                                ? 'bg-slate-700 text-slate-200 rounded-tl-sm' 
                                : 'bg-blue-600 text-white rounded-tr-sm'
                        }`}>
                            {msg.text}
                        </div>
                        <div className="flex items-center gap-2 mt-1 select-none">
                            <span className="text-[10px] text-slate-500 uppercase font-medium tracking-wide">
                                {msg.role === 'assistant' ? 'AI' : 'You'}
                            </span>
                            {msg.timestamp && (
                                <span className="text-[10px] text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
                
                {/* Realtime Inputs */}
                {realtimeInput && (
                    <div className="flex flex-col items-end opacity-80">
                        <div className="max-w-[90%] rounded-2xl px-4 py-2 text-sm leading-relaxed bg-blue-600/50 text-white rounded-tr-sm italic border border-blue-500/30">
                            {realtimeInput}
                        </div>
                        <span className="text-[10px] text-blue-400 mt-1 uppercase font-medium tracking-wide animate-pulse">Speaking...</span>
                    </div>
                )}
                
                {realtimeOutput && (
                    <div className="flex flex-col items-start opacity-80">
                        <div className="max-w-[90%] rounded-2xl px-4 py-2 text-sm leading-relaxed bg-slate-700/50 text-slate-200 rounded-tl-sm italic border border-slate-600/30">
                            {realtimeOutput}
                        </div>
                        <span className="text-[10px] text-blue-400 mt-1 uppercase font-medium tracking-wide animate-pulse">AI Thinking...</span>
                    </div>
                )}
            </div>
         </div>

      </div>

      {/* Controls */}
      <div className="bg-slate-800 p-6 border-t border-slate-700 flex justify-center gap-6 relative z-30">
         <button 
           onClick={toggleMute}
           className={`p-4 rounded-full transition-all duration-200 shadow-lg ${isMuted ? 'bg-red-500 text-white hover:bg-red-600 ring-4 ring-red-500/20' : 'bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white'}`}
         >
            {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
         </button>
      </div>

    </div>
  );
};

export default LiveSession;