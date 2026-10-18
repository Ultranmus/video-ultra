/**
 * One tab owns a project at a time. Two tabs autosaving the same project would both append to
 * (and compact) its op log and corrupt it, so the editor takes a Web Lock per project id: the
 * holder saves; another tab opens the project read-only until it takes the lock over.
 * Browsers without Web Locks (rare) get a lock that always succeeds — the old behaviour.
 */

/** A held project lock. */
export interface ProjectLock {
  /** Gives the project up (another tab may take it). */
  release(): void;
  /** Settles when the lock is lost to another tab that took it over (never on `release()`). */
  readonly lost: Promise<void>;
}

const NAME = (projectId: string) => `video-ultra:project:${projectId}`;

/**
 * Takes the lock on `projectId`. Resolves `null` when another tab holds it (unless `steal`, which
 * takes it from that tab — its `lost` then settles).
 */
export async function lockProject(
  projectId: string,
  options: { steal?: boolean } = {},
): Promise<ProjectLock | null> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks) return { release: () => {}, lost: new Promise<void>(() => {}) };
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let released = false;
  let markLost!: () => void;
  const lost = new Promise<void>((resolve) => (markLost = resolve));
  const granted = await new Promise<boolean>((resolve) => {
    const request = locks.request(
      NAME(projectId),
      options.steal ? { steal: true } : { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        resolve(true);
        await held;
      },
    );
    // A stolen lock rejects the request: tell the holder (not when we let it go ourselves).
    request.catch(() => {
      if (!released) markLost();
    });
  });
  if (!granted) return null;
  return {
    release: () => {
      released = true;
      release();
    },
    lost,
  };
}
