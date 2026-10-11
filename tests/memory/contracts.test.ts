import { describe, expect, it } from 'vitest';
import { MEMORY_TOOLS, parseMemoryTool, validateExtractedFacts, buildMemoryContext } from '../../supabase/functions/_shared/memory_contract';

describe('memory contracts', () => {
  it('exposes only bounded read-only tools without account arguments', () => {
    expect(MEMORY_TOOLS.map(t => t.function.name)).toEqual(['search_memory', 'read_memory']);
    expect(JSON.stringify(MEMORY_TOOLS)).not.toContain('user_id');
    expect(parseMemoryTool('search_memory', { query: 'café project', limit: 99 })).toEqual({ name: 'search_memory', query: 'café project', limit: 8 });
    expect(() => parseMemoryTool('search_memory', { query: 'x', user_id: 'other' })).toThrow();
    expect(() => parseMemoryTool('delete_memory', {})).toThrow();
    expect(() => parseMemoryTool('read_memory', { ids: ['not-an-id'] })).toThrow();
  });
  it('preserves Unicode, returns empty context for no hits, and quotes evidence', () => {
    expect(buildMemoryContext([]).contextBlock).toBe('');
    const result = buildMemoryContext([{ id: '11111111-1111-4111-8111-111111111111', text: 'Je préfère le café.', kind: 'preference', basis: 'user_statement', sources: [], created_at: '2026-10-10' }]);
    expect(result.contextBlock).toContain('Je préfère le café.');
    expect(result.contextBlock).toContain('untrusted');
    expect(result.hits).toBe(1);
    expect(buildMemoryContext(Array.from({length: 8}, (_, i) => ({id: String(i), text: 'a'.repeat(500), kind:'fact', basis:'legacy', sources:[]}))).contextBlock.length).toBeLessThanOrEqual(6000);
  });
  it('accepts only exact saved user quotations and rejects assistant-only claims', () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const assistantId = '22222222-2222-4222-8222-222222222222';
    const messages = [{id:userId,role:'user',content:'I prefer concise answers.'}, {id:assistantId,role:'assistant',content:'You live in London.'}];
    expect(validateExtractedFacts(JSON.stringify({facts:[{kind:'preference',sourceMessageId:userId,quote:'I prefer concise answers.'}]}),messages)).toEqual([{kind:'preference',source_message_id:userId,text:'I prefer concise answers.'}]);
    expect(() => validateExtractedFacts(JSON.stringify({facts:[{kind:'fact',sourceMessageId:assistantId,quote:'You live in London.'}]}),messages)).toThrow();
    expect(() => validateExtractedFacts(JSON.stringify({facts:[{kind:'fact',sourceMessageId:userId,quote:'I live in London.'}]}),messages)).toThrow();
    expect(validateExtractedFacts('{"facts":[]}',messages)).toEqual([]);
    expect(() => validateExtractedFacts('not json',messages)).toThrow();
  });
});
