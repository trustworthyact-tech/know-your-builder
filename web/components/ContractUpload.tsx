'use client';

import { useCallback, useRef, useState } from 'react';

export interface UploadResult {
  r2Key: string;
  fileType: string;
  warning?: string;
}

interface ContractUploadProps {
  onComplete: (result: UploadResult) => void;
  onCancel: () => void;
}

const ALLOWED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
];

const MAX_BYTES = 10 * 1024 * 1024;

function validateFile(file: File): string | null {
  if (!ALLOWED_MIME.includes(file.type)) return 'Unsupported file type. Please use PDF, Word (.docx), JPG, or PNG.';
  if (file.size > MAX_BYTES) return 'File exceeds 10 MB limit.';
  return null;
}

export function ContractUpload({ onComplete, onCancel }: ContractUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = useCallback((f: File) => {
    const err = validateFile(f);
    if (err) { setError(err); setFile(null); return; }
    setError(null);
    setFile(f);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) pickFile(dropped);
    },
    [pickFile],
  );

  const upload = () => {
    if (!file || uploading) return;
    setUploading(true);
    setProgress(0);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 95));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setProgress(100);
        const result: UploadResult = JSON.parse(xhr.responseText);
        onComplete(result);
      } else {
        let msg = 'Upload failed. Please try again.';
        try { msg = JSON.parse(xhr.responseText).error ?? msg; } catch { /* ignore */ }
        setError(msg);
        setUploading(false);
      }
    };

    xhr.onerror = () => {
      setError('Upload failed. Please try again.');
      setUploading(false);
    };

    xhr.send(formData);
  };

  return (
    <div className="bg-surface rounded-2xl p-6 shadow-md border border-border text-left">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-primary">Upload Your Contract</h2>
          <p className="text-xs text-text-muted mt-0.5">
            We'll extract builder details automatically
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-text-muted hover:text-text-secondary transition"
          aria-label="Cancel upload and return to search"
        >
          Cancel
        </button>
      </div>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="File drop zone — click or drag a file here"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => { if (!uploading) inputRef.current?.click(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
        className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition select-none ${
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary-light'
        } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,image/jpeg,image/png"
          className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); }}
        />

        {file ? (
          <div>
            <p className="text-sm font-medium text-text-primary truncate">{file.name}</p>
            <p className="text-xs text-text-muted mt-1">
              {(file.size / 1024).toFixed(0)} KB &middot; {file.type.split('/')[1].toUpperCase()}
            </p>
            {!uploading && (
              <p className="text-xs text-primary-light mt-2 underline underline-offset-2">
                Click to change file
              </p>
            )}
          </div>
        ) : (
          <div>
            <svg
              className="mx-auto mb-3 w-10 h-10 text-text-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z"
              />
            </svg>
            <p className="text-sm text-text-secondary">
              <span className="font-medium text-primary">Click to upload</span> or drag and drop
            </p>
            <p className="text-xs text-text-muted mt-1">PDF, Word (.docx), JPG, PNG — max 10 MB</p>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-danger mt-2">{error}</p>}

      {uploading && (
        <div className="mt-3">
          <div className="h-1.5 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-200 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-text-muted mt-1 text-right">{progress}%</p>
        </div>
      )}

      <button
        type="button"
        onClick={upload}
        disabled={!file || uploading}
        className="mt-4 w-full bg-primary hover:bg-primary-light text-white font-semibold text-sm py-4 rounded-xl transition shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {uploading ? 'Uploading…' : 'Upload Contract →'}
      </button>
    </div>
  );
}
