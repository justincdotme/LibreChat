import { useRef } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import type { editor } from 'monaco-editor';
import type { Artifact } from '~/common';
import { useArtifactCode } from '~/Providers/EditorContext';
import { ArtifactCodeEditor } from './ArtifactCodeEditor';
import { ArtifactPreview } from './ArtifactPreview';

export default function SandboxArtifactTabs({
  artifact,
  isSharedConvo,
}: {
  artifact: Artifact;
  isSharedConvo?: boolean;
}) {
  const monacoRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  /* The buffer belongs to whichever artifact last wrote it, so a pane that
   * remounted for another host keeps this artifact's unsaved text; a copy
   * another artifact displaced is just as much this artifact's text. */
  const editedCode = useArtifactCode(artifact.id);

  /* An emptied editor is not an edit, so the preview falls back to the source. */
  const content = editedCode || artifact.content || '';

  return (
    <div className="flex h-full w-full flex-col">
      <Tabs.Content
        value="code"
        id="artifacts-code"
        className="h-full w-full grow overflow-auto"
        tabIndex={-1}
      >
        <ArtifactCodeEditor
          artifact={artifact}
          monacoRef={monacoRef}
          readOnly={isSharedConvo === true}
        />
      </Tabs.Content>

      <Tabs.Content value="preview" className="h-full w-full grow overflow-hidden" tabIndex={-1}>
        <ArtifactPreview type={artifact.type} content={content} />
      </Tabs.Content>
    </div>
  );
}
