import type { StatusId } from './status';
export const MINOR_NEGATIVE_STATUSES: readonly StatusId[] = ['BURNING', 'POISONED', 'BLEEDING', 'SLOWED', 'TURTLE_HOBBLE_1', 'TURTLE_HOBBLE_2'];
export const isMinorNegativeStatus = (id: StatusId): boolean => MINOR_NEGATIVE_STATUSES.includes(id);
