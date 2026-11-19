import { renderMarkdown } from './markdown.js';

const state = {
  conversationId: null,
  model: null,
  sending: false,
};

const el = {
  messages: document.getElementById('messages'),
  empty: document.getElementById('empty-state'),
  input: document.getElementById('input'),
  composer: document.getElementById('composer'),
  send: document.getElementById('send'),
  noteList: document.getElementById('note-list'),
  conversationList: document.getElementById('conversation-list'),
  fileInput: document.getElementById('file-input'),
  modelInput: document.getElementById('model-input'),
  modelOptions: document.getElementById('model-options'),
  keyStatus: document.getElementById('key-status'),
  title: document.getElementById('conversation-title'),
  newChat: document.getElementById('new-chat'),
  toast: document.getElementById('toast'),
  sidebar: document.getElementById('sidebar'),
  toggleSidebar: document.getElementById('toggle-sidebar'),
  noteDialog: document.getElementById('note-dialog'),
  noteTitle: document.getElementById('note-title'),
  noteContent: document.getElementById('note-content'),
  noteMeta: document.getElementById('note-meta'),
  noteSave: document.getElementById('note-save'),
  noteDelete: document.getElementById('note-delete'),
  notePages: document.getElementById('note-pages'),
  visionToggle: document.getElementById('vision-toggle'),
};

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  el.toast.textContent = message;
  el.toast.classList.toggle('error', isError);
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 4000);
}

/* ---------- notes ---------- */

async function loadNotes() {
  const { notes } = await api('/notes');
  el.noteList.innerHTML = '';
  if (!notes.length) {
    el.noteList.innerHTML = '<li class="hint">No notes yet.</li>';
    return;
  }
  for (const note of notes) {
    const li = document.createElement('li');
    li.className = 'note-item';
    li.innerHTML = `
      <div class="item-text">
        <span class="item-title"></span>
        <span class="item-meta">${formatBytes(note.sizeBytes)} · ${note.charCount.toLocaleString()} chars${visionLabel(note)}</span>
      </div>
      <button class="delete" title="Delete note">✕</button>`;
    li.querySelector('.item-title').textContent = note.title;
    if (note.visionStatus === 'failed') li.querySelector('.item-meta').classList.add('warn');
    li.addEventListener('click', () => openNote(note.id));
    li.querySelector('.delete').addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!confirm(`Delete "${note.title}"?`)) return;
      await api(`/notes/${note.id}`, { method: 'DELETE' });
      toast('Note deleted.');
      loadNotes();
    });
    el.noteList.append(li);
  }
}

async function openNote(id) {
  const { note } = await api(`/notes/${id}`);
  el.noteTitle.value = note.title;
  el.noteContent.value = note.content;
  el.noteMeta.textContent = [
    note.filename,
    formatBytes(note.sizeBytes),
    `${note.charCount.toLocaleString()} characters`,
    note.pageCount ? `${note.pageCount} page image${note.pageCount === 1 ? '' : 's'}` : null,
    visionText(note),
  ]
    .filter(Boolean)
    .join(' · ');
  renderPageStrip(note);
  el.noteDialog.dataset.id = id;
  el.noteDialog.showModal();
}

function renderPageStrip(note) {
  el.notePages.innerHTML = '';
  if (!note.pageCount) {
    el.notePages.hidden = true;
    return;
  }
  for (const page of note.pages ?? []) {
    const figure = document.createElement('figure');
    figure.className = 'page-thumb';
    const img = document.createElement('img');
    img.src = `/api/notes/${note.id}/pages/${page.idx}`;
    img.alt = `Page ${page.idx + 1}${page.description ? `: ${page.description.slice(0, 80)}` : ''}`;
    img.loading = 'lazy';
    img.addEventListener('click', () => window.open(img.src, '_blank', 'noopener'));
    figure.append(img);
    const caption = document.createElement('figcaption');
    caption.textContent = `Page ${page.idx + 1}`;
    figure.append(caption);
    el.notePages.append(figure);
  }
  el.notePages.hidden = false;
}

function visionText(note) {
  if (note.visionStatus === 'done') return 'diagrams described';
  if (note.visionStatus === 'partial') return 'some pages described';
  if (note.visionStatus === 'failed') return 'diagram reading failed';
  return null;
}

function visionLabel(note) {
  if (note.visionStatus === 'done') return ` · 👁 ${note.pageCount}`;
  if (note.visionStatus === 'partial') return ' · 👁 partial';
  if (note.visionStatus === 'failed') return ' · 👁 failed';
  return '';
}

el.noteSave.addEventListener('click', async () => {
  const id = el.noteDialog.dataset.id;
  try {
    const { note } = await api(`/notes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: el.noteTitle.value, content: el.noteContent.value }),
    });
    toast(`Saved "${note.title}".`);
    el.noteDialog.close();
    loadNotes();
  } catch (error) {
    toast(error.message, true);
  }
});

el.noteDelete.addEventListener('click', async () => {
  const id = el.noteDialog.dataset.id;
  if (!confirm('Delete this note?')) return;
  await api(`/notes/${id}`, { method: 'DELETE' });
  el.noteDialog.close();
  toast('Note deleted.');
  loadNotes();
});

async function uploadFiles(files) {
  const useVision = el.visionToggle?.checked !== false;
  for (const file of files) {
    const body = new FormData();
    body.append('file', file);
    body.append('vision', useVision ? 'auto' : 'off');
    toast(useVision ? `Uploading ${file.name} and reading its pages…` : `Uploading ${file.name}…`);
    try {
      const { note, vision, truncated, totalPages } = await api('/notes', { method: 'POST', body });
      const longNote = truncated ? ` Only the first ${note.pageCount} of ${totalPages} pages were read.` : '';
      if (vision?.error) {
        toast(`Added "${note.title}", but diagram reading failed: ${vision.error}${longNote}`, true);
      } else if (note.visionStatus === 'done') {
        toast(`Added "${note.title}" — ${note.pageCount} page${note.pageCount === 1 ? '' : 's'} described.${longNote}`);
      } else {
        toast(`Added "${note.title}" (${note.charCount.toLocaleString()} characters).${longNote}`);
      }
    } catch (error) {
      toast(error.message, true);
    }
  }
  loadNotes();
}

el.fileInput.addEventListener('change', (event) => {
  const files = [...event.target.files];
  event.target.value = '';
  if (files.length) uploadFiles(files);
});

['dragover', 'drop'].forEach((type) => {
  el.messages.addEventListener(type, (event) => {
    event.preventDefault();
    if (type === 'drop' && event.dataTransfer.files.length) uploadFiles([...event.dataTransfer.files]);
  });
});

/* ---------- conversations ---------- */

async function loadConversations() {
  const { conversations } = await api('/conversations');
  el.conversationList.innerHTML = '';
  if (!conversations.length) {
    el.conversationList.innerHTML = '<li class="hint">No sessions yet.</li>';
    return;
  }
  for (const conversation of conversations) {
    const li = document.createElement('li');
    li.className = 'conversation-item';
    if (conversation.id === state.conversationId) li.classList.add('active');
    li.innerHTML = `
      <div class="item-text">
        <span class="item-title"></span>
        <span class="item-meta">${conversation.messageCount} messages · ${formatDate(conversation.updatedAt)}</span>
      </div>
      <button class="delete" title="Delete session">✕</button>`;
    li.querySelector('.item-title').textContent = conversation.title;
    li.addEventListener('click', () => openConversation(conversation.id));
    li.querySelector('.delete').addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!confirm(`Delete "${conversation.title}"?`)) return;
      await api(`/conversations/${conversation.id}`, { method: 'DELETE' });
      if (state.conversationId === conversation.id) newConversation();
      loadConversations();
    });
    el.conversationList.append(li);
  }
}

async function openConversation(id) {
  if (state.sending) return;
  const { conversation } = await api(`/conversations/${id}`);
  state.conversationId = conversation.id;
  if (conversation.model) {
    state.model = conversation.model;
    el.modelInput.value = conversation.model;
  }
  el.title.textContent = conversation.title;
  el.messages.innerHTML = '';
  for (const message of conversation.messages) {
    appendMessage(message.role, message.content);
  }
  el.messages.scrollTop = el.messages.scrollHeight;
  el.sidebar.classList.remove('open');
  loadConversations();
}

function newConversation() {
  if (state.sending) return;
  state.conversationId = null;
  el.messages.innerHTML = '';
  el.messages.append(el.empty);
  el.title.textContent = 'New study session';
  el.input.focus();
  loadConversations();
}

el.newChat.addEventListener('click', newConversation);

/* ---------- chat ---------- */

function appendMessage(role, content, { sources = [] } = {}) {
  el.empty?.remove();
  const wrapper = document.createElement('div');
  wrapper.className = `msg ${role}`;
  wrapper.innerHTML = `
    <div class="avatar">${role === 'user' ? '🧑' : '📚'}</div>
    <div class="bubble">
      <div class="body"></div>
      <div class="sources" hidden></div>
    </div>`;
  const bubble = wrapper.querySelector('.bubble');
  const body = wrapper.querySelector('.body');
  const chips = wrapper.querySelector('.sources');
  if (role === 'assistant') {
    body.innerHTML = renderMarkdown(content);
  } else {
    body.textContent = content;
  }
  for (const source of sources) chips.append(sourceChip(source));
  chips.hidden = sources.length === 0;
  el.messages.append(wrapper);
  el.messages.scrollTop = el.messages.scrollHeight;
  return { wrapper, body, chips };
}

function sourceChip(source) {
  const chip = document.createElement('span');
  chip.className = 'source-chip';
  chip.textContent = `📄 ${source.title}`;
  return chip;
}

async function sendMessage(text) {
  if (!text.trim() || state.sending) return;
  state.sending = true;
  el.send.disabled = true;
  el.input.value = '';
  resizeInput();
  appendMessage('user', text);
  const reply = appendMessage('assistant', '');
  reply.body.classList.add('cursor');

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: state.conversationId, message: text, model: state.model }),
    });

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    let answer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = /^event: (.+)$/m.exec(raw)?.[1];
        const payload = /^data: (.+)$/m.exec(raw)?.[1];
        if (!event || !payload) continue;
        const data = JSON.parse(payload);

        if (event === 'meta') {
          const isNew = state.conversationId !== data.conversationId;
          state.conversationId = data.conversationId;
          el.title.textContent = data.title;
          for (const source of data.sources ?? []) reply.chips.append(sourceChip(source));
          reply.chips.hidden = !reply.chips.childElementCount;
          if (isNew) loadConversations();
        } else if (event === 'delta') {
          answer += data.text;
          reply.body.innerHTML = renderMarkdown(answer);
          el.messages.scrollTop = el.messages.scrollHeight;
        } else if (event === 'done') {
          reply.body.innerHTML = renderMarkdown(answer);
          if (data.message?.content) loadConversations();
        } else if (event === 'error') {
          throw new Error(data.error);
        }
      }
    }
  } catch (error) {
    reply.body.innerHTML = `<p class="error-text">⚠️ ${escapeText(error.message)}</p>`;
    toast(error.message, true);
  } finally {
    reply.body.classList.remove('cursor');
    state.sending = false;
    el.send.disabled = false;
    el.input.focus();
  }
}

el.composer.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(el.input.value);
});

el.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage(el.input.value);
  }
});

el.input.addEventListener('input', resizeInput);

function resizeInput() {
  el.input.style.height = 'auto';
  el.input.style.height = `${Math.min(el.input.scrollHeight, 200)}px`;
}

document.querySelectorAll('.suggestions button').forEach((button) => {
  button.addEventListener('click', () => {
    el.input.value = button.dataset.prompt;
    sendMessage(button.dataset.prompt);
  });
});

/* ---------- settings ---------- */

async function loadSettings() {
  const settings = await api('/settings');
  state.model = settings.model;
  el.keyStatus.textContent = settings.apiKeyConfigured
    ? `Connected to ${new URL(settings.baseUrl).host}`
    : 'NAGA_API_KEY missing — set it in .env';
  el.modelInput.value = state.model;

  try {
    const { models } = await api('/settings/models');
    el.modelOptions.innerHTML = '';
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model.id;
      option.label = model.label;
      el.modelOptions.append(option);
    }
  } catch {
    /* keep the configured default when the catalog cannot be fetched */
  }
}

async function applyModel(value) {
  const model = value.trim();
  if (!model || model === state.model) {
    el.modelInput.value = state.model;
    return;
  }
  try {
    await api('/settings', { method: 'PUT', body: JSON.stringify({ model }) });
  } catch (error) {
    el.modelInput.value = state.model;
    toast(error.message, true);
    return;
  }
  state.model = model;
  el.modelInput.value = model;
  if (state.conversationId) {
    await api(`/conversations/${state.conversationId}`, { method: 'PATCH', body: JSON.stringify({ model }) });
  }
  toast(`Model set to ${model}`);
}

el.modelInput.addEventListener('change', () => applyModel(el.modelInput.value));
el.modelInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    applyModel(el.modelInput.value);
  }
});

el.toggleSidebar.addEventListener('click', () => el.sidebar.classList.toggle('open'));

/* ---------- helpers ---------- */

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso) {
  const date = new Date(iso);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString();
}

function escapeText(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------- boot ---------- */

Promise.all([loadNotes(), loadConversations(), loadSettings()]).catch((error) => toast(error.message, true));
el.input.focus();
