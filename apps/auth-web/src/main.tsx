/**
 * @fileoverview Implements the public authentication-only React bundle that discovers tenant login methods and begins server-owned OAuth/passkey flows.
 *
 * @remarks
 * Direct links: `react-dom/client`, `./App.js`, `./styles.css`.
 * Security: Authentication/session security boundary; changes require negative tests for replay, binding, MFA and unauthenticated access.
 */

import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './styles.css';

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('The authentication application mount point is missing.');
createRoot(root).render(<App />);
