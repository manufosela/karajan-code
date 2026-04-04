/**
 * Execute an optimistic UI update with rollback on error.
 * @param {object} params
 * @param {Function} params.apply - Apply the optimistic change to the UI
 * @param {Function} params.revert - Revert the UI change
 * @param {Function} params.commit - Server call that confirms the change
 * @returns {Promise<any>}
 */
export async function optimistic({ apply, revert, commit }) {
  apply();
  try {
    return await commit();
  } catch (err) {
    revert();
    throw err;
  }
}
