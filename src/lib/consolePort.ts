/**
 * Which serial port a console session opens, and what its tab is called.
 *
 * The backend lists the machine's ports and names the one it would open
 * without asking — the only USB serial adapter, when there is exactly one.
 * This decides what the window does with that: open it, or say why somebody
 * has to choose.
 *
 * Pure, so the decision is tested without a cable.
 */
import type { ConsolePort } from './ipc';

/** The speeds offered. 9600 is what a console speaks out of the box. */
export const CONSOLE_SPEEDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] as const;
export const DEFAULT_CONSOLE_SPEED = 9600;

/** A stored speed, or 9600 where what is stored is not a speed. */
export function consoleSpeed(raw: unknown): number {
  const n = Number(raw);
  return (CONSOLE_SPEEDS as readonly number[]).includes(n) ? n : DEFAULT_CONSOLE_SPEED;
}

export type PortChoice =
  | { open: string }
  /** No port at all; ports but none a USB adapter; or more than one adapter. */
  | { ask: 'none' | 'noCable' | 'several' };

/**
 * The port to open. One somebody picked wins, while it is still there; then
 * the one the backend chose. Otherwise it is a question: a guess between two
 * cables would type into the wrong device.
 */
export function choosePort(ports: readonly ConsolePort[], chosen: string | null, wanted = ''): PortChoice {
  if (wanted && ports.some((p) => p.name === wanted)) return { open: wanted };
  if (chosen && ports.some((p) => p.name === chosen)) return { open: chosen };
  if (ports.length === 0) return { ask: 'none' };
  return { ask: ports.some((p) => p.likelyConsole) ? 'several' : 'noCable' };
}

/** A port's name without the folder it lives in: `ttyUSB0`, `COM3`. */
export function shortPort(name: string): string {
  return name.split(/[\\/]/).filter(Boolean).pop()?.replace(/^cu\./, '') ?? name;
}

/** How a port reads in a list: its name, and what the adapter says it is. */
export function portOption(port: ConsolePort): string {
  return port.description ? `${shortPort(port.name)} — ${port.description}` : shortPort(port.name);
}
