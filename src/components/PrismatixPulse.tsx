import React from 'react';

interface PrismatixPulseProps {
  color: string;
  showLogo?: boolean;
}

export const PrismatixPulse: React.FC<PrismatixPulseProps> = ({ color, showLogo = false }) => {
  return (
    <div className='prismatix-pulse-track'>
      {showLogo && <img src='/prismatix-icon-draft.svg' alt='Prismatix loading' className='prismatix-pulse-logo' />}
      <div className='prismatix-pulse-fill' style={{ '--pulse-color': color } as React.CSSProperties} />
    </div>
  );
};
