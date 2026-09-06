/**
 * @fileoverview Implements the reusable protected-portal AppShell component used by one or more authenticated pages.
 *
 * @remarks
 * Direct links: `lucide-react`, `react`, `../core/session.js`, `./navigation.js`.
 * Security: Browser trust boundary; no database/AWS credentials or protected server decisions may enter this bundle.
 */

import { Bell, ChevronDown, Fingerprint, Menu, Search, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useSession } from '../core/session.js';
import { AppearanceControl } from '../core/appearance.js';
import { Notifications } from './Notifications.js';
import { Modal } from './Modal.js';
import { Navigation, navigationItems, routeMetadata } from './navigation.js';

/** Derives a short, display-only avatar label without changing the authoritative user name. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(
      /** Transforms each input item for `initials` into the derived value or React element consumed by the surrounding collection. It receives `part`. Direct links: `part[0]?.toUpperCase`. */ (
        part,
      ) => part[0]?.toUpperCase() ?? '',
    )
    .join('');
}

/** Hosts global navigation, search, account controls and the page content region. */
export function AppShell(props: {
  readonly currentPath: string;
  readonly navigate: (path: string) => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const { session, hasPermission, isModuleEnabled, registerPasskey, signOut } = useSession();
  const community = ['parent_guardian', 'student'].includes(session.user.category);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const accountRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDialogElement>(null);
  useEffect(
    /** Synchronises App Shell with its dependencies and cleans up pending work when the view changes. */
    () => {
      if (!navigationOpen) return;
      const element = drawerRef.current;
      const previous = document.activeElement as HTMLElement | null;
      const overflow = document.body.style.overflow;
      element?.showModal();
      document.body.style.overflow = 'hidden';
      const wide =
        window.matchMedia(
          '(min-width: 1024px)',
        ); /** Coordinates close Wide within App Shell, preserving the caller's validation and error handling. */
      const closeWide = (): void => {
        if (wide.matches) setNavigationOpen(false);
      };
      wide.addEventListener('change', closeWide);
      return /** Releases the App Shell resources owned by this lifecycle callback. */ () => {
        element?.close();
        document.body.style.overflow = overflow;
        wide.removeEventListener('change', closeWide);
        previous?.focus();
      };
    },
    [navigationOpen],
  );
  const metadata = routeMetadata(props.currentPath);
  const CurrentIcon = metadata.icon;
  const searchResults = navigationItems.filter(
    /** Keeps only input items that satisfy this predicate before `AppShell` continues its lookup, render or request construction. It receives `item`. Direct links: `hasPermission`, `isModuleEnabled`, `item.label.toLowerCase().includes`, `item.label.toLowerCase`, `query.toLowerCase`. */ (
      item,
    ) =>
      hasPermission(item.permission) &&
      (community
        ? item.path === (session.user.category === 'student' ? 'student-portal' : 'parent-portal')
        : !['parent-portal', 'student-portal'].includes(item.path)) &&
      isModuleEnabled(item.path) &&
      item.label.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(
    /** Synchronises `AppShell` with browser/API state after the declared React dependencies change and returns any required cleanup. Direct links: `document.addEventListener`. */ () => {
      /** Closes the account menu when pointer focus moves outside its owned element. */
      const closeOnOutsideClick = (event: MouseEvent): void => {
        if (accountRef.current && !accountRef.current.contains(event.target as Node))
          setAccountOpen(false);
      };
      /** Implements the documented command-palette shortcut and a consistent Escape dismissal path. */
      const shortcut = (event: KeyboardEvent): void => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          setSearchOpen(true);
        }
        if (event.key === 'Escape') {
          setSearchOpen(false);
          setAccountOpen(false);
          setNavigationOpen(false);
        }
      };
      document.addEventListener('mousedown', closeOnOutsideClick);
      document.addEventListener('keydown', shortcut);
      return /** Performs the local `callback` operation inside `AppShell` and returns control to the surrounding feature only after this body completes. Direct links: `document.removeEventListener`. */ () => {
        document.removeEventListener('mousedown', closeOnOutsideClick);
        document.removeEventListener('keydown', shortcut);
      };
    },
    [],
  );

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Skip to page content
      </a>
      {notificationsOpen && (
        <Notifications
          onClose={
            /** Handles App Shell update Notifications Open state from the current control. */
            () => {
              setNotificationsOpen(false);
            }
          }
        />
      )}
      <aside className="desktop-sidebar">
        <Navigation currentPath={props.currentPath} onNavigate={props.navigate} />
      </aside>
      {navigationOpen ? (
        <dialog
          ref={drawerRef}
          className="mobile-drawer-layer lg:hidden"
          aria-label="School navigation"
          onCancel={
            /** Handles App Shell update Navigation Open state from the current control. */
            (event) => {
              event.preventDefault();
              setNavigationOpen(false);
            }
          }
        >
          <button
            type="button"
            className="drawer-backdrop"
            onClick={
              /** Handles the React `onClick` event inside `AppShell`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setNavigationOpen`. */ () => {
                setNavigationOpen(false);
              }
            }
            aria-label="Close navigation"
          />
          <aside className="mobile-drawer">
            <Navigation
              currentPath={props.currentPath}
              onNavigate={props.navigate}
              onClose={
                /** Handles the React `onClose` event inside `AppShell`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setNavigationOpen`. */ () => {
                  setNavigationOpen(false);
                }
              }
            />
          </aside>
        </dialog>
      ) : null}

      <div className="main-column">
        <header className="topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="icon-button lg:hidden"
              type="button"
              onClick={
                /** Handles the React `onClick` event inside `AppShell`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setNavigationOpen`. */ () => {
                  setNavigationOpen(true);
                }
              }
              aria-label="Open navigation"
            >
              <Menu size={21} />
            </button>
            <div className="page-identity">
              <span className="page-icon">
                <CurrentIcon size={18} strokeWidth={1.9} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950 sm:text-[0.95rem]">
                  {metadata.label}
                </p>
                <p className="hidden text-[0.68rem] font-medium text-slate-400 sm:block">
                  Edutex school workspace
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            <button
              className="search-trigger"
              type="button"
              onClick={
                /** Handles the React `onClick` event inside `AppShell`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setSearchOpen`. */ () => {
                  setSearchOpen(true);
                }
              }
            >
              <Search size={17} />
              <span>Search</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="icon-button relative"
              type="button"
              aria-label="Notifications"
              onClick={
                /** Handles App Shell update Notifications Open state from the current control. */
                () => {
                  setNotificationsOpen(true);
                }
              }
            >
              <Bell size={19} />
            </button>
            <div className="relative" ref={accountRef}>
              <button
                className="account-trigger"
                type="button"
                onClick={
                  /** Handles the React `onClick` event inside `AppShell`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setAccountOpen`. */ () => {
                    setAccountOpen(
                      /** Derives the next immutable React state for `AppShell` from the previous value supplied by the state setter. It receives `open`. It uses only the local values shown in its body. */ (
                        open,
                      ) => !open,
                    );
                  }
                }
                aria-expanded={accountOpen}
              >
                <span className="avatar">{initials(session.user.displayName)}</span>
                <span className="hidden min-w-0 text-left md:block">
                  <span className="block max-w-36 truncate text-xs font-semibold text-slate-900">
                    {session.user.displayName}
                  </span>
                  <span className="block max-w-36 truncate text-[0.65rem] capitalize text-slate-400">
                    {session.user.category.replaceAll('_', ' ')}
                  </span>
                </span>
                <ChevronDown className="hidden text-slate-400 md:block" size={15} />
              </button>
              {accountOpen ? (
                <div className="account-menu">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="truncate text-sm font-semibold text-slate-950">
                      {session.user.displayName}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{session.user.email}</p>
                  </div>
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
                      <ShieldCheck size={15} /> Session protected
                    </div>
                    <p className="mt-1.5 text-[0.68rem] leading-4 text-slate-400">
                      Signed in on this device only. Expires{' '}
                      {new Date(session.expiresAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      .
                    </p>
                  </div>
                  <AppearanceControl />
                  {accountError && (
                    <p className="form-error" role="alert">
                      {accountError}
                    </p>
                  )}
                  <button
                    className="account-menu-button"
                    type="button"
                    onClick={
                      /** Handles the React `onClick` event inside `AppShell`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `registerPasskey`. */ () =>
                        void registerPasskey().catch(
                          /** Surfaces App Shell failures through the existing error handler without silently succeeding. */
                          (reason: unknown) => {
                            setAccountError(
                              reason instanceof Error
                                ? errorMessage(reason)
                                : 'Passkey registration failed.',
                            );
                          },
                        )
                    }
                  >
                    <Fingerprint size={15} /> Register a passkey
                  </button>
                  <button
                    className="account-menu-button"
                    type="button"
                    onClick={
                      /** Handles the React `onClick` event inside `AppShell`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `signOut`. */ () =>
                        void signOut().catch(
                          /** Surfaces App Shell failures through the existing error handler without silently succeeding. */
                          (reason: unknown) => {
                            setAccountError(
                              reason instanceof Error ? errorMessage(reason) : 'Sign out failed.',
                            );
                          },
                        )
                    }
                  >
                    Sign out of this device
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="page-content" id="main-content">
          {props.children}
        </main>
      </div>

      <nav className="mobile-tabs" aria-label="Quick navigation">
        {navigationItems
          .filter(
            /** Keeps only input items that satisfy this predicate before `AppShell` continues its lookup, render or request construction. It receives `item`. Direct links: `['dashboard', 'students', 'attendance', 'clas`, `hasPermission`, `isModuleEnabled`. */ (
              item,
            ) =>
              (community
                ? [session.user.category === 'student' ? 'student-portal' : 'parent-portal']
                : ['dashboard', 'students', 'attendance', 'classes']
              ).includes(item.path) &&
              hasPermission(item.permission) &&
              isModuleEnabled(item.path),
          )
          .map(
            /** Performs the local `navigationItems .filter( (item) => ['dashboard', 'students',` operation inside `AppShell` and returns control to the surrounding feature only after this body completes. It receives `item`. Direct links: `props.currentPath.split`. */ (
              item,
            ) => {
              const Icon = item.icon;
              const active = props.currentPath.split('/')[0] === item.path;
              return (
                <button
                  key={item.path}
                  type="button"
                  className={active ? 'mobile-tab mobile-tab-active' : 'mobile-tab'}
                  onClick={
                    /** Handles the React `onClick` event inside `AppShell`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `props.navigate`. */ () => {
                      if (item.path === 'technician') window.location.assign('/technician/');
                      else props.navigate(item.path);
                    }
                  }
                >
                  <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                  <span>{item.label}</span>
                </button>
              );
            },
          )}
        <button
          type="button"
          className="mobile-tab"
          onClick={
            /** Handles the React `onClick` event inside `AppShell`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setNavigationOpen`. */ () => {
              setNavigationOpen(true);
            }
          }
        >
          <Menu size={20} />
          <span>More</span>
        </button>
      </nav>

      {searchOpen ? (
        <Modal
          title="Search Edutex"
          onClose={
            /** Handles App Shell update Search Open state from the current control. */
            () => {
              setSearchOpen(false);
            }
          }
        >
          <div className="command-panel">
            <div className="command-input">
              <Search size={20} />
              <input
                autoFocus
                value={query}
                onChange={
                  /** Handles the React `onChange` event inside `AppShell`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setQuery`. */ (
                    event,
                  ) => {
                    setQuery(event.target.value);
                  }
                }
                placeholder="Find a module…"
                aria-label="Find a module"
              />
              <kbd>Esc</kbd>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {searchResults.map(
                /** Transforms each input item for `AppShell` into the derived value or React element consumed by the surrounding collection. It receives `item`. It uses only the local values shown in its body. */ (
                  item,
                ) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.path}
                      className="command-result"
                      type="button"
                      onClick={
                        /** Handles the React `onClick` event inside `AppShell`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `props.navigate`, `setSearchOpen`, `setQuery`. */ () => {
                          if (item.path === 'technician') window.location.assign('/technician/');
                          else props.navigate(item.path);
                          setSearchOpen(false);
                          setQuery('');
                        }
                      }
                    >
                      <span className="page-icon">
                        <Icon size={17} />
                      </span>
                      <span>{item.label}</span>
                    </button>
                  );
                },
              )}
              {searchResults.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-400">
                  No permitted modules match that search.
                </p>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

import { errorMessage } from '@edutex/contracts';
