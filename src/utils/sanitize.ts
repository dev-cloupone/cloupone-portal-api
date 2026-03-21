import { FilterXSS } from 'xss';

const sanitizer = new FilterXSS({
  whiteList: {},
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style'],
});

export function sanitizeContent(content: string): string {
  return sanitizer.process(content);
}
