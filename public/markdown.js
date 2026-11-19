/**
 * Small, dependency-free Markdown renderer for chat bubbles. Input is escaped
 * first, so model output cannot inject HTML.
 */
export function renderMarkdown(source) {
  const lines = escapeHtml(String(source ?? '')).split('\n');
  const out = [];
  let listType = null;
  let inCode = false;
  let codeLang = '';
  let codeLines = [];
  let paragraph = [];
  let tableRows = [];

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${paragraph.join(' ')}</p>`);
      paragraph = [];
    }
  };
  const flushTable = () => {
    if (tableRows.length >= 2) {
      const [head, , ...body] = tableRows;
      const cells = (row, tag) =>
        `<tr>${row.split('|').slice(1, -1).map((c) => `<${tag}>${inline(c.trim())}</${tag}>`).join('')}</tr>`;
      out.push(`<table><thead>${cells(head, 'th')}</thead><tbody>${body.map((r) => cells(r, 'td')).join('')}</tbody></table>`);
    } else if (tableRows.length) {
      out.push(`<p>${tableRows.map((r) => inline(r)).join('<br>')}</p>`);
    }
    tableRows = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code class="language-${codeLang}">${codeLines.join('\n')}</code></pre>`);
        inCode = false;
        codeLines = [];
        codeLang = '';
      } else {
        flushParagraph();
        closeList();
        flushTable();
        inCode = true;
        codeLang = line.trim().slice(3).trim().replace(/[^\w-]/g, '');
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushParagraph();
      closeList();
      tableRows.push(line.trim());
      continue;
    }
    if (tableRows.length) flushTable();

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(heading[1].length + 1, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const quote = line.match(/^(?:&gt;|>)\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ordered || bullet) {
      flushParagraph();
      const wanted = ordered ? 'ol' : 'ul';
      if (listType !== wanted) {
        closeList();
        out.push(`<${wanted}>`);
        listType = wanted;
      }
      out.push(`<li>${inline((ordered || bullet)[1])}</li>`);
      continue;
    }

    closeList();
    const hr = /^\s*(---|\*\*\*|___)\s*$/.test(line);
    if (hr) {
      flushParagraph();
      out.push('<hr>');
      continue;
    }
    paragraph.push(inline(line.trim()));
  }

  if (inCode && codeLines.length) {
    out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
  }
  flushTable();
  flushParagraph();
  closeList();
  return out.join('\n');
}

function inline(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
