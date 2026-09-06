/**
 * @fileoverview Implements the protected React portal entry/configuration and is served only after the backend verifies an opaque session.
 *
 * @remarks
 * Direct links: `react-dom/client`, `./App.js`, `./core/session.js`, `./styles.css`.
 * Security: Browser trust boundary; no database/AWS credentials or protected server decisions may enter this bundle.
 */

import { createRoot } from 'react-dom/client';

import { FailureBoundary } from './components/FailureBoundary.js';
import { App } from './App.js';
import { SessionProvider } from './core/session.js';
import './styles.css';

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('The portal application mount point is missing.');
createRoot(root).render(
  <SessionProvider>
    <FailureBoundary>
      <App />
    </FailureBoundary>
  </SessionProvider>,
);
