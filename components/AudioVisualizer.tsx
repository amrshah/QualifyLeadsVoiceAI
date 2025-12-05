import React, { useRef, useEffect } from 'react';

interface AudioVisualizerProps {
  isActive: boolean;
  role: 'user' | 'assistant';
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isActive, role }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let time = 0;
    const color = role === 'assistant' ? '#60a5fa' : '#34d399'; // Blue for AI, Green for User

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      time += 0.05;

      const centerY = canvas.height / 2;
      const amplitude = isActive ? 20 : 2; // High amplitude when active, low for idle

      ctx.beginPath();
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;

      for (let x = 0; x < canvas.width; x++) {
        // Super simple sine wave combination for visualization
        const y = centerY + 
          Math.sin(x * 0.02 + time) * amplitude * 0.5 +
          Math.sin(x * 0.05 + time * 2) * amplitude * 0.3 +
          Math.sin(x * 0.1 + time * 0.5) * amplitude * 0.2;
        
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [isActive, role]);

  return (
    <canvas 
      ref={canvasRef} 
      width={300} 
      height={100} 
      className="w-full h-24 bg-slate-900/50 rounded-lg border border-slate-700/50"
    />
  );
};

export default AudioVisualizer;
