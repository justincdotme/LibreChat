import { memo } from 'react';
import { defaultUrlTransform } from 'react-markdown';
import type { UrlTransform } from 'react-markdown';
import MarkdownLite from '~/components/Chat/Messages/Content/MarkdownLite';
import { useLocalize } from '~/hooks';

const MARKDOWN_TYPES = new Set(['text/markdown', 'text/md', 'text/plain']);

/* Following a link is the reader's choice, but an image is fetched on render,
 * so any image source with a scheme or host is dropped before it can leave. */
const localImagesOnly: UrlTransform = (url, key) => {
  if (key !== 'href' && (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//'))) {
    return '';
  }
  return defaultUrlTransform(url);
};

/* Every other type used to render in a Sandpack iframe served by CodeSandbox
 * with scripts from public CDNs, so this deployment refuses them outright. */
export const ArtifactPreview = memo(function ArtifactPreview({
  type,
  content,
}: {
  type?: string;
  content: string;
}) {
  const localize = useLocalize();

  if (!MARKDOWN_TYPES.has(type ?? '')) {
    return (
      <div
        className="bg-surface-primary text-text-secondary flex h-full w-full items-center justify-center p-4 text-sm"
        role="status"
      >
        {localize('com_ui_preview_unavailable')}
      </div>
    );
  }

  return (
    <div className="markdown prose light dark:prose-invert text-text-primary h-full w-full overflow-auto p-4 break-words">
      <MarkdownLite content={content} codeExecution={false} urlTransform={localImagesOnly} />
    </div>
  );
});
