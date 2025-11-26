import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.use({
  breaks: true,
  gfm: true,
});

/**
 * Strip src from media elements that have data-media-id
 * These will be resolved from IndexedDB at render time
 */
function stripMediaSrc(html: string): string {
  // Use DOMParser to properly handle the HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const container = doc.body.firstChild as HTMLElement;
  
  // Find all elements with data-media-id
  const mediaElements = container.querySelectorAll('[data-media-id]');
  
  mediaElements.forEach(el => {
    // Remove src attribute
    el.removeAttribute('src');
    
    // Also remove any source children (for audio/video elements with old format)
    const sources = el.querySelectorAll('source');
    sources.forEach(source => source.remove());
  });
  
  return container.innerHTML;
}

export function renderMarkdown(markdown: string, allowHtml: boolean = false): string {
  if (!allowHtml) {
    const renderer = new marked.Renderer();
    renderer.html = () => '';
    return marked.parse(markdown, { async: false, renderer }) as string;
  }
  
  let rendered = marked.parse(markdown, { async: false }) as string;
  
  // Sanitize HTML
  rendered = DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'code', 'pre', 
                  'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                  'a', 'img', 'audio', 'video', 'source', 'div', 'span', 'table', 
                  'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 'hr'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'controls', 
                  'data-media-id', 'data-filename', 'type', 'width', 'height', 'target', 'rel'],
    ALLOW_DATA_ATTR: true
  });
  
  // Strip src from media elements with data-media-id (will be resolved from IndexedDB)
  rendered = stripMediaSrc(rendered);
  
  return rendered;
}

export function renderHtmlContent(html: string): string {
  return html;
}

