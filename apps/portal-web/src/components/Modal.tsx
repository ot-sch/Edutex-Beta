/** @fileoverview Native modal focus containment with stable lifetime and focus restoration. */
import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
/** Opens an accessible top-layer dialog; changing form state never resets focus. */
export function Modal(props: {
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
  readonly onClose: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useEffect(
    /** Synchronises Modal with its dependencies and cleans up pending work when the view changes. */
    () => {
      const element = dialog.current;
      const previous = document.activeElement as HTMLElement | null;
      const overflow = document.body.style.overflow;
      element?.showModal();
      document.body.style.overflow = 'hidden';
      return /** Releases the Modal resources owned by this lifecycle callback. */ () => {
        element?.close();
        document.body.style.overflow = overflow;
        previous?.focus();
      };
    },
    [],
  );
  return (
    <dialog
      ref={dialog}
      className="native-dialog"
      aria-labelledby={titleId}
      onCancel={
        /** Handles Modal interaction state from the current control. */
        (event) => {
          event.preventDefault();
          close.current();
        }
      }
    >
      <div className="modal-card">
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{props.title}</h2>
            {props.description && <p>{props.description}</p>}
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={props.onClose}
            aria-label="Close dialog"
          >
            <X size={19} />
          </button>
        </div>
        {props.children}
      </div>
    </dialog>
  );
}
