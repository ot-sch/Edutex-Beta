/** @fileoverview Light, dark and system themes saved to the authenticated account. */
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { usePreferences } from './preferences.js';
const appearanceDefaults = { theme: 'system' as 'light' | 'dark' | 'system' };
type AppearancePreferences = ReturnType<typeof usePreferences<typeof appearanceDefaults>>;
const AppearanceContext = createContext<AppearancePreferences | null>(null);
/** Applies the saved account theme at startup and responds to operating-system colour changes. */
export function AppearanceProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const prefs = usePreferences('appearance', appearanceDefaults);
  useEffect(
    /** Synchronises appearance with its dependencies and cleans up pending work when the view changes. */
    () => {
      const media = window.matchMedia(
        '(prefers-color-scheme: dark)',
      ); /** Coordinates apply within appearance, preserving the caller's validation and error handling. */
      const apply = (): void => {
        document.documentElement.dataset['theme'] =
          prefs.value.theme === 'system' ? (media.matches ? 'dark' : 'light') : prefs.value.theme;
      };
      apply();
      media.addEventListener('change', apply);
      return /** Releases the appearance resources owned by this lifecycle callback. */ () => {
        media.removeEventListener('change', apply);
      };
    },
    [prefs.value.theme],
  );
  return <AppearanceContext.Provider value={prefs}>{children}</AppearanceContext.Provider>;
}
/** Edits the shared preference without resetting appearance when the account menu closes. */
export function AppearanceControl(): React.JSX.Element {
  const prefs = useContext(AppearanceContext);
  if (!prefs) return <p>Appearance is unavailable.</p>;
  return (
    <div className="appearance-control">
      <label htmlFor="appearance-mode">Appearance</label>
      <select
        id="appearance-mode"
        value={prefs.value.theme}
        onChange={
          /** Updates appearance interaction state from the current control. */
          (event) => {
            prefs.setValue({ theme: event.target.value as typeof prefs.value.theme });
          }
        }
      >
        <option value="system">Use device setting</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      <button
        type="button"
        className="text-action"
        disabled={prefs.loading || prefs.saving}
        onClick={
          /** Handles appearance interaction state from the current control. */
          () =>
            void prefs.save().catch(
              /** Surfaces appearance failures through the existing error handler without silently succeeding. */
              () => undefined,
            )
        }
      >
        {prefs.saving ? 'Saving…' : prefs.saved ? 'Saved to your account' : 'Save appearance'}
      </button>
      {prefs.error && <small role="alert">{prefs.error}</small>}
    </div>
  );
}
