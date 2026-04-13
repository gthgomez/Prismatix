// src/hooks/useContextManager.ts
import { useRef, useState, useEffect } from 'react';
import { ContextManager } from '../services/contextManager.ts';
import type { Message } from '../types.ts';

export interface AutoContextEvent extends CustomEvent {
  detail: { createNewChatWithContext: () => string };
}

export function useContextManager(messages: Message[], autoCreate = false) {
    const contextManagerRef = useRef(new ContextManager());
    const [contextStatus, setContextStatus] = useState<ReturnType<ContextManager['analyzeConversation']> | null>(null);
    const [shouldShowWarning, setShouldShowWarning] = useState(false);

    useEffect(() => {
        const analysis = contextManagerRef.current.analyzeConversation(messages);
        setContextStatus(analysis);
        setShouldShowWarning(analysis.utilizationPercent > 80);

        if (autoCreate && analysis.shouldReset && messages.length > 0) {
            const timer = setTimeout(() => {
                const event = new CustomEvent('autoContextReset', {
                    detail: { createNewChatWithContext }
                }) as AutoContextEvent;
                globalThis.dispatchEvent(event);
            }, 1000);
            return () => clearTimeout(timer);
        }
        return undefined;
    }, [messages, autoCreate]);

    const createNewChatWithContext = () => {
        const contextDoc = contextManagerRef.current.generateContextSummary(messages);
        return `## Previous Chat Context
**Summary**: ${contextDoc.summary}
**Last Few Topics**: ${contextDoc.recentContext.map((c: { preview: string }) => c.preview).join(' | ')}
**Previous Message Count**: ${contextDoc.messageCount}

Please continue our conversation with this context in mind.`;
    };

    return {
        contextStatus,
        shouldShowWarning,
        createNewChatWithContext
    };
}
