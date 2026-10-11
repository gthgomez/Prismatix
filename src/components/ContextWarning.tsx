import React from 'react';

interface ContextWarningProps {
  contextStatus: {
    shouldReset: boolean;
    utilizationPercent: number;
    messageCount: number;
    tokenEstimate: number;
  } | null;
  onNewChat: () => void;
}

export const ContextWarning: React.FC<ContextWarningProps> = ({ contextStatus, onNewChat }) => {
  if (!contextStatus?.shouldReset) return null;

  return (
    <div className="context-warning">
      <div className="context-warning-copy" role="status">
        <strong>Context getting long</strong>
        <span>
          {contextStatus.utilizationPercent}% capacity · {contextStatus.messageCount} messages · about{' '}
          {contextStatus.tokenEstimate} tokens
        </span>
      </div>
      <button type="button" onClick={onNewChat} className="context-warning-action">
        Start New Chat with Context
      </button>
    </div>
  );
};
