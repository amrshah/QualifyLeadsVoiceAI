import React, { useState } from 'react';
import ConfigForm from './components/ConfigForm';
import LiveSession from './components/LiveSession';
import { BusinessConfig } from './types';
import { DEFAULT_CONFIG } from './constants';
import { Bot } from 'lucide-react';

function App() {
  const [config, setConfig] = useState<BusinessConfig>(DEFAULT_CONFIG);
  const [isLive, setIsLive] = useState(false);

  const handleSaveConfig = (newConfig: BusinessConfig) => {
    setConfig(newConfig);
    // In a real app, you might save to local storage here
    alert("Configuration saved successfully!");
  };

  const startLiveSession = () => {
    setIsLive(true);
  };

  const endLiveSession = () => {
    setIsLive(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 selection:bg-blue-500/30">
      
      {/* Navbar */}
      <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg">
                <Bot className="text-white" size={24} />
            </div>
            <span className="font-bold text-xl tracking-tight text-white">QualifyAI</span>
          </div>
          <div className="flex items-center gap-4">
             <span className="text-xs font-mono text-slate-500 px-2 py-1 bg-slate-900 rounded border border-slate-800">
               v1.0.0
             </span>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-8 h-[calc(100vh-64px)]">
        {isLive ? (
            // Live Session View (Full Height)
            <div className="h-full max-h-[800px] max-w-5xl mx-auto shadow-2xl shadow-blue-900/20 rounded-xl border border-slate-800">
                <LiveSession config={config} onClose={endLiveSession} />
            </div>
        ) : (
            // Configuration View
            <div className="animate-fade-in">
                <ConfigForm 
                  config={config} 
                  onSave={handleSaveConfig} 
                  onStart={startLiveSession}
                />
            </div>
        )}
      </main>

    </div>
  );
}

export default App;
