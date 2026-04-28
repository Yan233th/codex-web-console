import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

marked.setOptions({
	gfm: true,
	breaks: true
});

const allowedTags = [
	'p',
	'br',
	'strong',
	'em',
	'del',
	'code',
	'pre',
	'blockquote',
	'ul',
	'ol',
	'li',
	'a',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr'
];

const allowedAttributes = {
	a: ['href', 'target', 'rel']
};

const cache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 200;

export function renderMarkdown(input: string | null | undefined): string {
	if (!input?.trim()) {
		return '';
	}

	const cached = cache.get(input);
	if (cached !== undefined) {
		cache.delete(input);
		cache.set(input, cached);
		return cached;
	}

	const parsed = marked.parse(input);
	const html = typeof parsed === 'string' ? parsed : '';

	const sanitized = sanitizeHtml(html, {
		allowedTags,
		allowedAttributes,
		transformTags: {
			a: sanitizeHtml.simpleTransform('a', {
				target: '_blank',
				rel: 'noreferrer'
			})
		}
	});

	cache.set(input, sanitized);
	if (cache.size > MAX_CACHE_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}

	return sanitized;
}
