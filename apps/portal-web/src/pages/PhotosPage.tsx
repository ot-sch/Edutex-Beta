/**
 * @fileoverview Implements the protected PhotosPage React feature, linking session-authorised UI state to same-origin Edutex API contracts.
 *
 * @remarks
 * Direct links: `@edutex/contracts`, `lucide-react`, `react`, `../components/PageStates.js`, `../core/api.js`.
 * Security: Browser trust boundary; no database/AWS credentials or protected server decisions may enter this bundle.
 */

import { resourceListResponseSchema, type ResourceRecord } from '@edutex/contracts';
import { ImagePlus, Search, ShieldCheck, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { EmptyState, PageLoading } from '../components/PageStates.js';
import { apiRequest } from '../core/api.js';

/** Sends a selected photo through the API re-encoding and S3 validation pipeline. */
export function PhotosPage(): React.JSX.Element {
  const [students, setStudents] = useState<readonly ResourceRecord[]>();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ResourceRecord>();
  const [preview, setPreview] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(
    /** Synchronises `PhotosPage` with browser/API state after the declared React dependencies change and returns any required cleanup. Direct links: `window.setTimeout`. */ () => {
      const controller = new AbortController();
      const timer = window.setTimeout(
        /** Derives the next immutable React state for `PhotosPage` from the previous value supplied by the state setter. Direct links: `apiRequest<unknown>('/api/v1/resources/studen`, `apiRequest`. */ () => {
          const parameters = new URLSearchParams({ search: query, page: '1', pageSize: '30' });
          void apiRequest<unknown>(
            `/api/v1/resources/students?${parameters}`,
            {},
            controller.signal,
          )
            .then(
              /** Performs the local `apiRequest<unknown>('/api/v1/resources/students?${parameters` operation inside `PhotosPage` and returns control to the surrounding feature only after this body completes. It receives `value`. Direct links: `setStudents`, `resourceListResponseSchema.parse`. */ (
                value,
              ) => {
                setStudents(resourceListResponseSchema.parse(value).items);
              },
            )
            .catch(
              /** Performs the local `apiRequest<unknown>('/api/v1/resources/students?${parameters` operation inside `PhotosPage` and returns control to the surrounding feature only after this body completes. It receives `reason`. Direct links: `setError`. */ (
                reason: unknown,
              ) => {
                if (!controller.signal.aborted)
                  setError(
                    reason instanceof Error
                      ? errorMessage(reason)
                      : 'Students could not be loaded.',
                  );
              },
            );
        },
        250,
      );
      return /** Performs the local `callback` operation inside `PhotosPage` and returns control to the surrounding feature only after this body completes. Direct links: `controller.abort`, `window.clearTimeout`. */ () => {
        controller.abort();
        window.clearTimeout(timer);
      };
    },
    [query],
  );

  /** Replaces the local object-URL preview and revokes the prior URL to avoid retaining file data. */
  const chooseFile = (file: File | undefined): void => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : undefined);
    setMessage(undefined);
    setError(undefined);
  };

  /** Uploads the selected image with its current row version; the API re-encodes before storage. */
  const upload = async (): Promise<void> => {
    const file = fileRef.current?.files?.[0];
    if (!selected || !file) return;
    setUploading(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const body = new FormData();
      body.set('photo', file, file.name);
      await apiRequest(`/api/v1/students/${selected.id}/photo`, {
        method: 'PUT',
        body,
        headers: { 'x-record-version': String(selected.rowVersion) },
      });
      setMessage('Photo uploaded and safely re-encoded.');
      if (fileRef.current) fileRef.current.value = '';
    } catch (reason) {
      setError(reason instanceof Error ? errorMessage(reason) : 'The photo could not be uploaded.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Media</p>
          <h1>Student photos</h1>
          <p>Validated profile images with metadata stripping and controlled access.</p>
        </div>
        <span className="secure-badge large">
          <ShieldCheck size={16} /> Re-encoded on upload
        </span>
      </div>
      <div className="photo-layout">
        <aside className="data-card photo-directory">
          <label className="table-search m-4">
            <Search size={17} />
            <input
              value={query}
              onChange={
                /** Handles the React `onChange` event inside `PhotosPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setQuery`. */ (
                  event,
                ) => {
                  setQuery(event.target.value);
                }
              }
              placeholder="Find a student…"
            />
          </label>
          {!students ? (
            <PageLoading />
          ) : students.length === 0 ? (
            <EmptyState title="No students found" detail="Try a different search." />
          ) : (
            <div className="photo-student-list">
              {students.map(
                /** Transforms each input item for `PhotosPage` into the derived value or React element consumed by the surrounding collection. It receives `student`. Direct links: `String`, `name .split(/\s+/) .map((part) => part[0]) .s`, `name .split(/\s+/) .map`, `name .split`. */ (
                  student,
                ) => {
                  const name = `${String(student.fields['preferredName'] ?? student.fields['firstName'])} ${String(student.fields['lastName'])}`;
                  return (
                    <button
                      key={student.id}
                      type="button"
                      className={
                        selected?.id === student.id
                          ? 'photo-student photo-student-active'
                          : 'photo-student'
                      }
                      onClick={
                        /** Handles the React `onClick` event inside `PhotosPage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setSelected`, `setMessage`, `setError`. */ () => {
                          setSelected(student);
                          setMessage(undefined);
                          setError(undefined);
                        }
                      }
                    >
                      <span className="student-avatar">
                        {name
                          .split(/\s+/)
                          .map(
                            /** Transforms each input item for `PhotosPage` into the derived value or React element consumed by the surrounding collection. It receives `part`. It uses only the local values shown in its body. */ (
                              part,
                            ) => part[0],
                          )
                          .slice(0, 2)
                          .join('')}
                      </span>
                      <span>
                        <strong>{name}</strong>
                        <small>
                          {String(student.fields['studentNumber'])} · Year{' '}
                          {String(student.fields['yearLevel'])}
                        </small>
                      </span>
                    </button>
                  );
                },
              )}
            </div>
          )}
        </aside>
        <article className="panel photo-uploader">
          {!selected ? (
            <EmptyState
              title="Choose a student"
              detail="Select a student to securely replace their profile photo."
            />
          ) : (
            <>
              <div>
                <p className="panel-eyebrow">Selected student</p>
                <h2>
                  {String(selected.fields['preferredName'] ?? selected.fields['firstName'])}{' '}
                  {String(selected.fields['lastName'])}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {String(selected.fields['studentNumber'])}
                </p>
              </div>
              <label className="drop-zone">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={
                    /** Handles the React `onChange` event inside `PhotosPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `chooseFile`. */ (
                      event,
                    ) => {
                      chooseFile(event.target.files?.[0]);
                    }
                  }
                />
                <span className="drop-preview">
                  {preview ? (
                    <img src={preview} alt="Selected upload preview" />
                  ) : (
                    <ImagePlus size={34} />
                  )}
                </span>
                <strong>{preview ? 'Photo ready to upload' : 'Choose a profile photo'}</strong>
                <small>JPEG, PNG or WebP · maximum 5 MB</small>
              </label>
              <div className="security-explainer">
                <ShieldCheck size={18} />
                <p>
                  <strong>Unsafe content does not reach student records.</strong>
                  <span>
                    Edutex verifies the image, strips metadata, limits dimensions and creates a
                    clean WebP.
                  </span>
                </p>
              </div>
              {error ? (
                <div className="form-error" role="alert">
                  {error}
                </div>
              ) : null}
              {message ? (
                <div className="success-message" role="status">
                  {message}
                </div>
              ) : null}
              <button
                className="button-primary self-start"
                type="button"
                disabled={!preview || uploading}
                onClick={
                  /** Handles the React `onClick` event inside `PhotosPage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `upload`. */ () =>
                    void upload()
                }
              >
                <Upload size={17} /> {uploading ? 'Uploading…' : 'Upload clean photo'}
              </button>
            </>
          )}
        </article>
      </div>
    </section>
  );
}

import { errorMessage } from '@edutex/contracts';
