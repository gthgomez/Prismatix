import type { CSSProperties } from 'react';
import '../styles/ChatBackdrop.css';

// Fixed positions keep the atmosphere stable across typing and streaming renders.
const STARS = Array.from({ length: 42 }, (_, index) => ({
  x: (index * 37 + 7) % 100,
  y: (index * 53 + 11) % 100,
  size: index % 7 === 0 ? 2 : 1,
  opacity: 0.2 + (index % 4) * 0.13,
}));

const TRAILS = [
  { x: 12, y: 20 }, { x: 84, y: 13 }, { x: 94, y: 53 },
  { x: 7, y: 66 }, { x: 80, y: 84 }, { x: 25, y: 88 },
];

export function ChatBackdrop() {
  return (
    <div className='chat-backdrop' aria-hidden='true'>
      <div className='chat-backdrop-horizon' />
      <div className='chat-backdrop-stars'>
        {STARS.map((star, index) => (
          <span key={index} style={{
            left: `${star.x}%`, top: `${star.y}%`,
            width: star.size, height: star.size, opacity: star.opacity,
          }} />
        ))}
      </div>
      <div className='chat-backdrop-trails'>
        {TRAILS.map((trail, index) => (
          <span key={index} style={{
            left: `${trail.x}%`, top: `${trail.y}%`,
            '--trail-angle': `${Math.atan2(trail.y - 38, trail.x - 50)}rad`,
            '--trail-x': `${(trail.x - 50) * 0.7}px`,
            '--trail-y': `${(trail.y - 38) * 0.7}px`,
            animationDelay: `${index * -2.1}s`,
          } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}
