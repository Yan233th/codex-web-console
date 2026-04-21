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

export function renderMarkdown(input: string | null | undefined): string {
	if (!input?.trim()) {
		return '';
	}

	const parsed = marked.parse(input);
	const html = typeof parsed === 'string' ? parsed : '';

	return sanitizeHtml(html, {
		allowedTags,
		allowedAttributes,
		transformTags: {
			a: sanitizeHtml.simpleTransform('a', {
				target: '_blank',
				rel: 'noreferrer'
			})
		}
	});
}
