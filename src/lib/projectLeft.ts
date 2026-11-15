/**
 * What a module keeps for the session and must let go of when the project is
 * closed.
 *
 * Most state lives in the store, which `closeProject` resets itself. A few
 * things are module-level on purpose — a copied rack layout, the last
 * traceroute to a target — and each of those names one customer's devices. A
 * module registers how to forget its own here, and closing a project calls
 * every one, so nothing of one project is still in memory when the next opens.
 */
const forgetters: (() => void)[] = [];

/** Registers something to forget when a project is closed. */
export function onProjectLeft(forget: () => void): void {
  forgetters.push(forget);
}

/** Forgets everything registered. Called by the store on close. */
export function projectLeft(): void {
  for (const forget of forgetters) {
    try {
      forget();
    } catch {
      // One module's failure to forget must not stop the others.
    }
  }
}
