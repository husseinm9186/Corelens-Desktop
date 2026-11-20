import { describe, expect, it } from 'vitest';
import { choosePort, consoleSpeed, portOption, shortPort } from './consolePort';
import type { ConsolePort } from './ipc';

const port = (name: string, likelyConsole: boolean, description = ''): ConsolePort => ({
  name, kind: likelyConsole ? 'usb' : 'unknown', description, likelyConsole,
});

describe('which port a console opens', () => {
  const cable = port('COM3', true, 'USB serial adapter (FTDI)');
  const builtIn = port('COM1', false, 'Built-in serial port');

  it('the one cable, without asking', () => {
    expect(choosePort([cable, builtIn], 'COM3')).toEqual({ open: 'COM3' });
  });

  it('the one somebody picked, over the one found', () => {
    expect(choosePort([cable, builtIn], 'COM3', 'COM1')).toEqual({ open: 'COM1' });
  });

  it('a picked port that has been unplugged is not opened; the cable found is', () => {
    expect(choosePort([cable], 'COM3', 'COM7')).toEqual({ open: 'COM3' });
  });

  it('two cables is a question, never a guess', () => {
    expect(choosePort([cable, port('COM10', true)], null)).toEqual({ ask: 'several' });
  });

  it('ports but no cable, and no ports at all, each say which', () => {
    expect(choosePort([builtIn], null)).toEqual({ ask: 'noCable' });
    expect(choosePort([], null)).toEqual({ ask: 'none' });
  });

  it('a port the backend chose that is not in its own list is not opened', () => {
    expect(choosePort([builtIn], 'COM3')).toEqual({ ask: 'noCable' });
  });
});

describe('what a port is called', () => {
  it('its name without its folder', () => {
    expect(shortPort('/dev/ttyUSB0')).toBe('ttyUSB0');
    expect(shortPort('/dev/cu.usbserial-0001')).toBe('usbserial-0001');
    expect(shortPort('COM3')).toBe('COM3');
    expect(shortPort('\\\\.\\COM12')).toBe('COM12');
  });

  it('and in a list, what the adapter says it is', () => {
    expect(portOption(port('/dev/ttyUSB0', true, 'FT232R USB UART (FTDI)'))).toBe('ttyUSB0 — FT232R USB UART (FTDI)');
    expect(portOption(port('COM1', false))).toBe('COM1');
  });
});

describe('the speed', () => {
  it('is one a console speaks, or 9600', () => {
    expect(consoleSpeed('115200')).toBe(115200);
    expect(consoleSpeed(9600)).toBe(9600);
    expect(consoleSpeed('9601')).toBe(9600);
    expect(consoleSpeed(undefined)).toBe(9600);
    expect(consoleSpeed('fast')).toBe(9600);
  });
});
