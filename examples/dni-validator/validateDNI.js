const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const DNI_REGEX = /^(\d{8})([A-Za-z])$/;

/**
 * Validates a Spanish DNI (8 digits + letter, modulo-23 check).
 * @param {string} input - DNI string to validate
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateDNI(input) {
  if (typeof input !== 'string') {
    return { valid: false, error: 'Formato inválido: se esperan 8 dígitos y una letra' };
  }

  const match = input.match(DNI_REGEX);
  if (!match) {
    return { valid: false, error: 'Formato inválido: se esperan 8 dígitos y una letra' };
  }

  const digits = parseInt(match[1], 10);
  const letter = match[2].toUpperCase();
  const expectedLetter = DNI_LETTERS[digits % 23];

  if (letter !== expectedLetter) {
    return { valid: false, error: `Letra inválida: se esperaba '${expectedLetter}', se recibió '${letter}'` };
  }

  return { valid: true, error: null };
}
