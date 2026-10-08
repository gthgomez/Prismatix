// PX07 conversation attachment reference parsing/ownership/normalization.
//
// Attachment refs are the JSONB element shape persisted on `public.messages`
// (`{ ordinal, kind, storageRef, videoAssetId, available }`). Image refs are
// private `supabase://chat-uploads/<subject>/<path>` references; video refs
// carry a `video_assets` id whose ownership is enforced in the write RPC.
import { describe, expect, it } from 'vitest';
import {
  attachmentRefIsOwned,
  normalizeAttachments,
  parseStorageReference,
  type AttachmentRef,
} from '../../supabase/functions/_shared/conversation_attachments.ts';

const SUBJECT = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';

function imageRef(overrides: Partial<AttachmentRef> = {}): AttachmentRef {
  return {
    ordinal: 0,
    kind: 'image',
    storageRef: `supabase://chat-uploads/${SUBJECT}/1700000000_photo.png`,
    videoAssetId: null,
    available: true,
    ...overrides,
  };
}

describe('parseStorageReference', () => {
  it('parses a private supabase:// bucket/path reference', () => {
    expect(parseStorageReference('supabase://chat-uploads/user-1/a.png')).toEqual({
      bucket: 'chat-uploads',
      path: 'user-1/a.png',
    });
  });

  it('rejects a bare path with no scheme', () => {
    expect(parseStorageReference('user-1/a.png')).toBeNull();
  });

  it('rejects other schemes and malformed references', () => {
    expect(parseStorageReference('https://example.com/a.png')).toBeNull();
    expect(parseStorageReference('supabase://chat-uploads')).toBeNull();
    expect(parseStorageReference('supabase:///a.png')).toBeNull();
    expect(parseStorageReference('supabase://chat-uploads/')).toBeNull();
    expect(parseStorageReference('')).toBeNull();
  });

  it('keeps nested paths intact', () => {
    expect(parseStorageReference('supabase://chat-uploads/u/nested/dir/a.png')).toEqual({
      bucket: 'chat-uploads',
      path: 'u/nested/dir/a.png',
    });
  });
});

describe('attachmentRefIsOwned', () => {
  it('accepts an image under the subject folder of the chat-uploads bucket', () => {
    expect(attachmentRefIsOwned(imageRef(), SUBJECT)).toBe(true);
  });
  it('rejects another subject path', () => {
    expect(
      attachmentRefIsOwned(
        imageRef({ storageRef: `supabase://chat-uploads/${OTHER}/a.png` }),
        SUBJECT,
      ),
    ).toBe(false);
  });

  it('rejects a different bucket', () => {
    expect(
      attachmentRefIsOwned(
        imageRef({ storageRef: `supabase://other-bucket/${SUBJECT}/a.png` }),
        SUBJECT,
      ),
    ).toBe(false);
  });

  it('rejects an image with a null or unparseable storageRef', () => {
    expect(attachmentRefIsOwned(imageRef({ storageRef: null }), SUBJECT)).toBe(false);
    expect(attachmentRefIsOwned(imageRef({ storageRef: 'nonsense' }), SUBJECT)).toBe(false);
  });

  it('accepts a video ref that carries an asset id, regardless of folder', () => {
    expect(
      attachmentRefIsOwned(
        {
          ordinal: 1,
          kind: 'video',
          storageRef: null,
          videoAssetId: '22222222-2222-4222-8222-222222222222',
          available: true,
        },
        SUBJECT,
      ),
    ).toBe(true);
  });

  it('rejects a video ref without an asset id', () => {
    expect(
      attachmentRefIsOwned(
        { ordinal: 1, kind: 'video', storageRef: null, videoAssetId: null, available: false },
        SUBJECT,
      ),
    ).toBe(false);
  });

  it('treats a file (text/code) ref as not storage-owned', () => {
    expect(
      attachmentRefIsOwned(
        { ordinal: 2, kind: 'file', storageRef: null, videoAssetId: null, available: true, name: 'notes.md', size: 12 },
        SUBJECT,
      ),
    ).toBe(false);
  });
});

describe('normalizeAttachments', () => {
  it('drops unknown kinds, resets ordinals, and coerces the element shape', () => {
    const normalized = normalizeAttachments([
      { ordinal: 5, kind: 'text', content: 'a big merged prompt' },
      { ordinal: 9, kind: 'image', storageRef: 'supabase://chat-uploads/u/a.png', available: true },
      { ordinal: 2, kind: 'video', videoAssetId: 'video-1', available: true },
      'not-an-object',
      { kind: 'image' },
    ]);

    expect(normalized).toEqual([
      {
        ordinal: 0,
        kind: 'image',
        storageRef: 'supabase://chat-uploads/u/a.png',
        videoAssetId: null,
        available: true,
      },
      {
        ordinal: 1,
        kind: 'video',
        storageRef: null,
        videoAssetId: 'video-1',
        available: true,
      },
      {
        ordinal: 2,
        kind: 'image',
        storageRef: null,
        videoAssetId: null,
        available: false,
      },
    ]);
  });

  it('keeps file (text/code) metadata without a storage ref or signed URL', () => {
    const normalized = normalizeAttachments([
      { ordinal: 0, kind: 'file', name: 'notes.md', size: 123, storageRef: 'ignored', content: 'huge body' },
      { ordinal: 1, kind: 'file', name: 'main.ts' },
      { ordinal: 2, kind: 'file', size: 10 },
    ]);

    expect(normalized).toEqual([
      {
        ordinal: 0,
        kind: 'file',
        storageRef: null,
        videoAssetId: null,
        available: true,
        name: 'notes.md',
        size: 123,
      },
      {
        ordinal: 1,
        kind: 'file',
        storageRef: null,
        videoAssetId: null,
        available: true,
        name: 'main.ts',
        size: null,
      },
      {
        ordinal: 2,
        kind: 'file',
        storageRef: null,
        videoAssetId: null,
        available: true,
        name: null,
        size: 10,
      },
    ]);
  });

  it('bounds the array to 16 entries and the storageRef to 2048 chars', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      kind: 'image',
      storageRef: `supabase://chat-uploads/u/${i}.png`,
      available: true,
    }));
    expect(normalizeAttachments(many)).toHaveLength(16);

    const oversized = normalizeAttachments([
      { kind: 'image', storageRef: `supabase://chat-uploads/u/${'x'.repeat(2048)}`, available: true },
    ]);
    expect(oversized[0]!.storageRef).toBeNull();
  });

  it('returns an empty array for non-array input', () => {
    expect(normalizeAttachments(null)).toEqual([]);
    expect(normalizeAttachments('nope')).toEqual([]);
  });
});
