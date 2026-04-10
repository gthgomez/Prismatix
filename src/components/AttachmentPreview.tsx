// AttachmentPreview.tsx - Draft attachment list shown above the input box

import React from 'react';
import type { FileUploadPayload } from '../types';

interface AttachmentPreviewProps {
  attachments: FileUploadPayload[];
  onRemove: (index: number) => void;
  onClearAll: () => void;
}

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({
  attachments,
  onRemove,
  onClearAll,
}) => {
  if (attachments.length === 0) return null;

  return (
    <div className='draft-preview-container'>
      <div className='draft-preview-header'>
        <span>
          {attachments.length} file{attachments.length > 1 ? 's' : ''} attached
        </span>
        <button
          type='button'
          onClick={onClearAll}
          className='clear-all-btn'
          title='Remove all attachments'
        >
          Clear all
        </button>
      </div>
      <div className='draft-files-list'>
        {attachments.map((file, index) => (
          <div key={file.clientId || `${file.name}-${index}`} className='draft-file-item'>
            {file.isImage && file.imageData
              ? (
                <img
                  src={`data:${file.mediaType};base64,${file.imageData}`}
                  alt={file.name}
                  className='draft-thumbnail'
                />
              )
              : <div className='draft-file-icon'>{file.kind === 'video' ? '🎬' : '📄'}</div>}
            <span className='draft-filename' title={file.name}>
              {file.name.length > 20 ? file.name.slice(0, 17) + '...' : file.name}
            </span>
            {file.kind === 'video' && (
              <span className='draft-video-status'>
                {file.status === 'ready'
                  ? 'ready'
                  : file.status === 'failed'
                  ? file.errorCode || 'failed'
                  : `${file.uploadProgress || 0}%`}
              </span>
            )}
            <button
              type='button'
              onClick={() => onRemove(index)}
              className='draft-remove-btn'
              title='Remove this file'
            >
              <svg
                width='14'
                height='14'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
              >
                <line x1='18' y1='6' x2='6' y2='18' />
                <line x1='6' y1='6' x2='18' y2='18' />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
