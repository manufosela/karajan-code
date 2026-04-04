import './task-column.js';
import { api } from '../services/api.js';
import { WsClient } from '../services/ws-client.js';
import { optimistic } from '../services/optimistic.js';

class TaskBoard extends HTMLElement {
  connectedCallback() {
    this.boardId = this.getAttribute('board-id');
    this.columns = [];
    this.cardsByColumn = {};
    this.ws = null;
    this.render();
    this.loadBoard();
    this.setupWs();
    this.setupEventListeners();
  }

  disconnectedCallback() {
    if (this.ws) this.ws.disconnect();
  }

  async loadBoard() {
    const { columns } = await api.listColumns(this.boardId);
    this.columns = columns;

    for (const col of columns) {
      const { cards } = await api.listCards(col.id);
      this.cardsByColumn[col.id] = cards;
    }

    this.renderColumns();
  }

  setupWs() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WsClient(`${proto}//${location.host}/ws`);
    this.ws.connect();
    this.ws.send({ type: 'join:board', payload: { boardId: this.boardId } });

    this.ws.on('card:create', (card) => this.onRemoteCardCreate(card));
    this.ws.on('card:update', (card) => this.onRemoteCardUpdate(card));
    this.ws.on('card:delete', ({ id }) => this.onRemoteCardDelete(id));
    this.ws.on('card:move', (card) => this.onRemoteCardMove(card));
    this.ws.on('column:create', (col) => this.onRemoteColumnCreate(col));
    this.ws.on('column:delete', ({ id }) => this.onRemoteColumnDelete(id));
  }

  setupEventListeners() {
    this.addEventListener('add-card', (e) => this.handleAddCard(e.detail));
    this.addEventListener('delete-card', (e) => this.handleDeleteCard(e.detail));
    this.addEventListener('edit-card', (e) => this.handleEditCard(e.detail));
    this.addEventListener('delete-column', (e) => this.handleDeleteColumn(e.detail));
    this.addEventListener('move-card', (e) => this.handleMoveCard(e.detail));
  }

  async handleAddCard({ columnId }) {
    const title = prompt('Card title:');
    if (!title) return;
    const { card } = await api.createCard(columnId, title);
    this.cardsByColumn[columnId] = this.cardsByColumn[columnId] || [];
    this.cardsByColumn[columnId].push(card);
    this.renderColumns();
  }

  async handleDeleteCard({ id }) {
    for (const colId of Object.keys(this.cardsByColumn)) {
      this.cardsByColumn[colId] = this.cardsByColumn[colId].filter((c) => c.id !== id);
    }
    this.renderColumns();
    await api.deleteCard(id);
  }

  async handleEditCard({ id, title, description }) {
    const newTitle = prompt('Edit title:', title);
    if (!newTitle) return;
    await api.updateCard(id, { title: newTitle });
    for (const cards of Object.values(this.cardsByColumn)) {
      const card = cards.find((c) => c.id === id);
      if (card) { card.title = newTitle; break; }
    }
    this.renderColumns();
  }

  async handleDeleteColumn({ columnId }) {
    this.columns = this.columns.filter((c) => c.id !== columnId);
    delete this.cardsByColumn[columnId];
    this.renderColumns();
    await api.deleteColumn(columnId);
  }

  async handleMoveCard({ cardId, columnId, position }) {
    // Optimistic: find and move card in local state
    let movedCard = null;
    for (const colId of Object.keys(this.cardsByColumn)) {
      const idx = this.cardsByColumn[colId].findIndex((c) => c.id === cardId);
      if (idx !== -1) {
        movedCard = this.cardsByColumn[colId].splice(idx, 1)[0];
        break;
      }
    }
    if (!movedCard) return;

    this.cardsByColumn[columnId] = this.cardsByColumn[columnId] || [];
    this.cardsByColumn[columnId].splice(position, 0, movedCard);
    movedCard.column_id = columnId;
    this.renderColumns();

    await api.moveCard(cardId, columnId, position);
  }

  onRemoteCardCreate(card) {
    this.cardsByColumn[card.column_id] = this.cardsByColumn[card.column_id] || [];
    this.cardsByColumn[card.column_id].push(card);
    this.renderColumns();
  }

  onRemoteCardUpdate(card) {
    const cards = this.cardsByColumn[card.column_id] || [];
    const idx = cards.findIndex((c) => c.id === card.id);
    if (idx !== -1) cards[idx] = card;
    this.renderColumns();
  }

  onRemoteCardDelete(id) {
    for (const colId of Object.keys(this.cardsByColumn)) {
      this.cardsByColumn[colId] = this.cardsByColumn[colId].filter((c) => c.id !== id);
    }
    this.renderColumns();
  }

  onRemoteCardMove(card) {
    // Remove from old position
    for (const colId of Object.keys(this.cardsByColumn)) {
      this.cardsByColumn[colId] = this.cardsByColumn[colId].filter((c) => c.id !== card.id);
    }
    // Add to new position
    this.cardsByColumn[card.column_id] = this.cardsByColumn[card.column_id] || [];
    this.cardsByColumn[card.column_id].push(card);
    this.cardsByColumn[card.column_id].sort((a, b) => a.position - b.position);
    this.renderColumns();
  }

  onRemoteColumnCreate(col) {
    this.columns.push(col);
    this.cardsByColumn[col.id] = [];
    this.renderColumns();
  }

  onRemoteColumnDelete(id) {
    this.columns = this.columns.filter((c) => c.id !== id);
    delete this.cardsByColumn[id];
    this.renderColumns();
  }

  render() {
    this.innerHTML = `<div class="board-container" id="columns-container"></div>`;
  }

  renderColumns() {
    const container = this.querySelector('#columns-container');
    container.innerHTML = '';

    for (const col of this.columns) {
      const el = document.createElement('task-column');
      el.setAttribute('column-id', col.id);
      el.setAttribute('title', col.title);
      container.appendChild(el);
      el.setCards(this.cardsByColumn[col.id] || []);
    }

    // Add column button
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-ghost';
    addBtn.style.cssText = 'min-width:280px;padding:16px;border:2px dashed var(--color-border);border-radius:var(--radius-lg);font-size:14px';
    addBtn.textContent = '+ Add Column';
    addBtn.addEventListener('click', () => this.handleAddColumn());
    container.appendChild(addBtn);
  }

  async handleAddColumn() {
    const title = prompt('Column title:');
    if (!title) return;
    const { column } = await api.createColumn(this.boardId, title);
    this.columns.push(column);
    this.cardsByColumn[column.id] = [];
    this.renderColumns();
  }
}

customElements.define('task-board', TaskBoard);
