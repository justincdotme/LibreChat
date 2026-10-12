import React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { render } from '@testing-library/react';
import type { Artifact } from '~/common';
import SandboxArtifactTabs from './SandboxArtifactTabs';

interface PreviewProps {
  type?: string;
  content: string;
}

const mockPreview = jest.fn((_props: PreviewProps) => null);
let mockCurrentCode: string | undefined;
let mockCodeArtifactId: string | undefined;

jest.mock('./ArtifactCodeEditor', () => ({
  ArtifactCodeEditor: () => null,
}));

jest.mock('./ArtifactPreview', () => ({
  ArtifactPreview: (props: PreviewProps) => mockPreview(props),
}));

jest.mock('~/Providers/EditorContext', () => ({
  useArtifactCode: (artifactId: string) =>
    mockCodeArtifactId === artifactId ? mockCurrentCode : undefined,
}));

const markdownArtifact: Artifact = {
  id: 'markdown-artifact-1',
  type: 'text/markdown',
  title: 'Notes',
  content: '# Original',
  lastUpdateTime: 1,
};

function renderTabs(artifact: Artifact = markdownArtifact) {
  return render(
    <Tabs.Root value="preview">
      <SandboxArtifactTabs artifact={artifact} />
    </Tabs.Root>,
  );
}

function lastPreview(): PreviewProps | undefined {
  return mockPreview.mock.calls.at(-1)?.[0];
}

describe('SandboxArtifactTabs preview', () => {
  beforeEach(() => {
    mockCurrentCode = undefined;
    mockCodeArtifactId = undefined;
    mockPreview.mockClear();
  });

  it('hands the artifact type and markdown source to the preview', () => {
    renderTabs();

    expect(lastPreview()).toEqual({ type: 'text/markdown', content: '# Original' });
  });

  it('previews the edited text once the editor owns this artifact', () => {
    const { rerender } = renderTabs();

    /* Editor text belongs to the preview only once it was typed against the
     * artifact on screen, so it lands on a later render, not on mount. */
    mockCurrentCode = '# Edited';
    mockCodeArtifactId = markdownArtifact.id;
    rerender(
      <Tabs.Root value="preview">
        <SandboxArtifactTabs artifact={markdownArtifact} />
      </Tabs.Root>,
    );

    expect(lastPreview()?.content).toBe('# Edited');
  });

  it('keeps the artifact source when the editor is emptied', () => {
    const { rerender } = renderTabs();

    mockCurrentCode = '';
    mockCodeArtifactId = markdownArtifact.id;
    rerender(
      <Tabs.Root value="preview">
        <SandboxArtifactTabs artifact={markdownArtifact} />
      </Tabs.Root>,
    );

    expect(lastPreview()?.content).toBe('# Original');
  });

  it('passes other types through unchanged so the preview can refuse them', () => {
    renderTabs({
      id: 'html-artifact-1',
      type: 'text/html',
      title: 'Page',
      content: '<p>original</p>',
      lastUpdateTime: 1,
    });

    expect(lastPreview()).toEqual({ type: 'text/html', content: '<p>original</p>' });
  });
});
