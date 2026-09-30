const ESC = "\x1b[";

export const colors = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  italic: `${ESC}3m`,
  underline: `${ESC}4m`,

  // Foreground colors
  black: `${ESC}30m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,
  gray: `${ESC}90m`,

  // Bright foreground
  brightRed: `${ESC}91m`,
  brightGreen: `${ESC}92m`,
  brightYellow: `${ESC}93m`,
  brightBlue: `${ESC}94m`,
  brightMagenta: `${ESC}95m`,
  brightCyan: `${ESC}96m`,
  brightWhite: `${ESC}97m`,

  // Background colors
  bgBlack: `${ESC}40m`,
  bgRed: `${ESC}41m`,
  bgGreen: `${ESC}42m`,
  bgYellow: `${ESC}43m`,
  bgBlue: `${ESC}44m`,
  bgCyan: `${ESC}46m`,
  bgDarkGray: `${ESC}100m`,
};

/**
 * Wraps a text string with ANSI styling codes and resets styling at the end.
 *
 * @param text - Plain text to format.
 * @param colorCode - ANSI escape sequence code.
 * @returns Stylized text string.
 */
export const colorize = (text: string, colorCode: string): string => {
  return `${colorCode}${text}${colors.reset}`;
};

export const cursor = {
  hide: (): void => {
    process.stdout.write(`${ESC}?25l`);
  },
  show: (): void => {
    process.stdout.write(`${ESC}?25h`);
  },
  moveTo: (row: number, col: number): void => {
    process.stdout.write(`${ESC}${row};${col}H`);
  },
  home: (): void => {
    process.stdout.write(`${ESC}H`);
  },
  clearScreen: (): void => {
    process.stdout.write(`${ESC}2J${ESC}H`);
  },
  clearLine: (): void => {
    process.stdout.write(`${ESC}2K\r`);
  },
};

export const altScreen = {
  enter: (): void => {
    // 1. Switch to Alternate Screen Buffer
    process.stdout.write(`${ESC}?1049h`);

    // 2. Reposition cursor to home
    cursor.home();

    // 3. Hide cursor
    cursor.hide();
  },
  exit: (): void => {
    // 1. Restore visible cursor
    cursor.show();

    // 2. Restore Main Screen Buffer
    process.stdout.write(`${ESC}?1049l`);
  },
};
