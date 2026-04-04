/**
 * Set up drag-and-drop handlers for task cards.
 * Uses native HTML5 Drag API.
 */

/**
 * @param {HTMLElement} cardEl
 * @param {string} cardId
 */
export function makeDraggable(cardEl, cardId) {
  cardEl.draggable = true;
  cardEl.dataset.cardId = cardId;

  cardEl.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', cardId);
    e.dataTransfer.effectAllowed = 'move';
    cardEl.classList.add('dragging');
  });

  cardEl.addEventListener('dragend', () => {
    cardEl.classList.remove('dragging');
  });
}

/**
 * @param {HTMLElement} columnEl
 * @param {(cardId: string, columnId: string, position: number) => void} onDrop
 */
export function makeDropTarget(columnEl, onDrop) {
  columnEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    columnEl.classList.add('drag-over');
  });

  columnEl.addEventListener('dragleave', (e) => {
    if (!columnEl.contains(e.relatedTarget)) {
      columnEl.classList.remove('drag-over');
    }
  });

  columnEl.addEventListener('drop', (e) => {
    e.preventDefault();
    columnEl.classList.remove('drag-over');
    const cardId = e.dataTransfer.getData('text/plain');
    const columnId = columnEl.dataset.columnId;
    const position = calculateDropPosition(columnEl, e.clientY);
    onDrop(cardId, columnId, position);
  });
}

/**
 * Calculate the position to insert based on mouse Y.
 * @param {HTMLElement} columnEl
 * @param {number} clientY
 * @returns {number}
 */
function calculateDropPosition(columnEl, clientY) {
  const cards = [...columnEl.querySelectorAll('task-card:not(.dragging)')];
  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return cards.length;
}
