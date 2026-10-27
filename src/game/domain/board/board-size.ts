/**
 * Playable battlefield dimensions. The playable grid is what the rules see; decorative
 * scenery around it is presentation-only and never adds tiles.
 *
 *   COMPACT   5×7   tutorial / introductory fights
 *   STANDARD  6×9   the main battlefield of the game
 *   LARGE     7×10  special / boss fights, only when the encounter needs it
 */
export interface BoardSize {
  rows: number;
  columns: number;
}

export const BOARD_SIZES = {
  COMPACT: { rows: 5, columns: 7 },
  STANDARD: { rows: 6, columns: 9 },
  LARGE: { rows: 7, columns: 10 },
} as const satisfies Record<string, BoardSize>;

/** Sanity limits for authored boards (beyond these, framing and readability break down). */
export const BOARD_LIMITS = { minRows: 3, minColumns: 3, maxRows: 10, maxColumns: 12 } as const;

/** Errors for a declared size; empty when valid. */
export function boardSizeErrors(size: BoardSize): string[] {
  const errors: string[] = [];
  const { rows, columns } = size;
  if (!Number.isInteger(rows) || !Number.isInteger(columns)) errors.push(`non-integer board ${rows}x${columns}`);
  else {
    if (rows < BOARD_LIMITS.minRows || rows > BOARD_LIMITS.maxRows)
      errors.push(`rows ${rows} outside ${BOARD_LIMITS.minRows}..${BOARD_LIMITS.maxRows}`);
    if (columns < BOARD_LIMITS.minColumns || columns > BOARD_LIMITS.maxColumns)
      errors.push(`columns ${columns} outside ${BOARD_LIMITS.minColumns}..${BOARD_LIMITS.maxColumns}`);
  }
  return errors;
}
