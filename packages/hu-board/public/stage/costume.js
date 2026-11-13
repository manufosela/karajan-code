// KJC-TSK-1604 (decided by the maintainer on 2026-11-13): roles are told apart by their shape, not by
// colours. Solomon, who arbitrates when coder and reviewer cannot agree, is King Solomon: a long
// royal robe and a golden crown. Pure: costume-mesh.js builds them.

/** What each costume is made of; a role without one keeps the film's robot. */
export const COSTUMES = { king: ['robe', 'crown'] };
const BY_ROLE = { solomon: 'king' };

/** The costume a role wears, or null. */
export const costumeOf = (role) => BY_ROLE[role] ?? null;

