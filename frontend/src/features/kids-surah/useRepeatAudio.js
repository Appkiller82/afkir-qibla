import { useEffect, useRef, useState } from "react";

export default function useRepeatAudio(src, { rate = 1.0 } = {}) {
  const audioRef = useRef(null);
  const [isPlaying, setPlaying] = useState(false);

  useEffect(() => {
    const a = new Audio(src);
    a.playbackRate = rate;
    audioRef.current = a;
    return () => { a.pause(); a.src = ""; };
  }, [src, rate]);

  return {
    play: () => { audioRef.current?.play(); setPlaying(true); },
    pause: () => { audioRef.current?.pause(); setPlaying(false); },
    seek: (t) => { if (audioRef.current) audioRef.current.currentTime = t; },
    isPlaying,
    setRate: (r)=>{ if(audioRef.current){ audioRef.current.playbackRate = r; } }
  };
}
