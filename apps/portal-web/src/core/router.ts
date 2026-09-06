/**
 * @fileoverview Implements a protected-portal trust helper for same-origin API access, navigation, session state or browser-side restricted-field encryption.
 *
 * @remarks
 * Direct links: `react`.
 * Security: Browser trust boundary; no database/AWS credentials or protected server decisions may enter this bundle.
 */

import { useEffect, useState } from 'react';

/** Converts an application URL into the bounded internal route representation. */
function normalisePath(pathname: string): string {
  const stripped = pathname.replace(/^\/app\/?/, '').replace(/\/+$/, '');
  return stripped || 'dashboard';
}

/** Provides the small history router needed by the protected single-page client. */
export function usePathRouter(): {
  readonly path: string;
  readonly navigate: (path: string) => void;
} {
  const [path, setPath] = useState(
    /** Performs the local `useState` operation inside `usePathRouter` and returns control to the surrounding feature only after this body completes. Direct links: `normalisePath`. */ () =>
      normalisePath(window.location.pathname),
  );
  useEffect(
    /** Synchronises `usePathRouter` with browser/API state after the declared React dependencies change and returns any required cleanup. Direct links: `window.addEventListener`. */ () => {
      /** Synchronises component state after browser back/forward navigation. */
      const onPopState = (): void => {
        setPath(normalisePath(window.location.pathname));
      };
      window.addEventListener('popstate', onPopState);
      return /** Performs the local `callback` operation inside `usePathRouter` and returns control to the surrounding feature only after this body completes. Direct links: `window.removeEventListener`. */ () => {
        window.removeEventListener('popstate', onPopState);
      };
    },
    [],
  );
  return {
    path,
    /** Implements `navigate` for implements a protected-portal trust helper for same-origin api access, navigation, session state or browser-side restricted-field encryption. It receives `destination`. Direct links: `normalisePath`, `window.history.pushState`, `setPath`, `window.scrollTo`. */ navigate:
      (destination) => {
        const normalized = normalisePath(destination);
        window.history.pushState({}, '', `/app/${normalized === 'dashboard' ? '' : normalized}`);
        setPath(normalized);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
  };
}
