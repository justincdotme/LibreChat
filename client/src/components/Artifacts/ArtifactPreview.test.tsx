import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArtifactPreview } from './ArtifactPreview';

/* A throwing factory only runs if something requires the module, so a green
 * run proves the preview never pulls Sandpack (and its CodeSandbox bundler). */
jest.mock('@codesandbox/sandpack-react/unstyled', () => {
  throw new Error('Sandpack must never load for artifact previews');
});

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) => key,
}));

/* The chat link component reads Recoil state and a query client, so the
 * preview needs both providers even though it renders a static document. */
function renderPreview(type: string | undefined, content: string) {
  return render(
    <RecoilRoot>
      <QueryClientProvider client={new QueryClient()}>
        <ArtifactPreview type={type} content={content} />
      </QueryClientProvider>
    </RecoilRoot>,
  );
}

describe('ArtifactPreview', () => {
  it.each(['text/markdown', 'text/md', 'text/plain'])(
    'renders %s with the chat renderer',
    (type) => {
      renderPreview(type, '# Hello\n\nBody text');

      expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument();
      expect(screen.queryByRole('status')).toBeNull();
    },
  );

  it('drops remote image sources but keeps links', () => {
    const { container } = renderPreview(
      'text/markdown',
      '![remote](https://evil.example/x.png)\n\n![scheme-relative](//evil.example/y.png)\n\n![local](/images/z.png)\n\n[site](https://example.com/)',
    );

    const sources = Array.from(container.querySelectorAll('img')).map((img) =>
      img.getAttribute('src'),
    );
    expect(sources.some((src) => src?.includes('evil.example'))).toBe(false);
    expect(sources.some((src) => src?.endsWith('/images/z.png'))).toBe(true);
    expect(screen.getByRole('link', { name: 'site' })).toHaveAttribute(
      'href',
      'https://example.com/',
    );
  });

  it.each(['text/html', 'application/vnd.react', 'image/svg+xml', undefined])(
    'refuses to preview %s',
    (type) => {
      renderPreview(type, '<h1>Hello</h1>');

      expect(screen.getByRole('status')).toHaveTextContent('com_ui_preview_unavailable');
      expect(screen.queryByRole('heading')).toBeNull();
    },
  );
});
