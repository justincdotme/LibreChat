import { EModelEndpoint, ArtifactModes } from 'librechat-data-provider';
import { generateArtifactsPrompt } from './index';

const variants: Array<[string, string, ArtifactModes]> = [
  ['anthropic default', EModelEndpoint.anthropic, ArtifactModes.DEFAULT],
  ['anthropic shadcnui', EModelEndpoint.anthropic, ArtifactModes.SHADCNUI],
  ['openai-compatible default', 'llama.cpp', ArtifactModes.DEFAULT],
  ['openai-compatible shadcnui', 'llama.cpp', ArtifactModes.SHADCNUI],
];

describe('generateArtifactsPrompt', () => {
  it.each(variants)('%s names no network resource', (_label, endpoint, artifacts) => {
    const prompt = generateArtifactsPrompt({ endpoint, artifacts });
    expect(prompt).not.toBeNull();
    expect(prompt).not.toMatch(/https?:\/\//);
    expect(prompt).toContain('Never reference an external script, stylesheet, font, or image URL');
  });

  it.each(variants)(
    '%s lists only types the client renders offline',
    (_label, endpoint, artifacts) => {
      const prompt = generateArtifactsPrompt({ endpoint, artifacts }) ?? '';
      expect(prompt).toContain('"application/vnd.code"');
      expect(prompt).toContain('title="backup.sh"');
      expect(prompt).toContain('"application/vnd.mermaid"');
      expect(prompt).toContain('"text/markdown"');
      expect(prompt).not.toContain('application/vnd.react');
      expect(prompt).not.toContain('text/html');
      expect(prompt).not.toContain('image/svg+xml');
    },
  );

  it('returns null for the custom mode', () => {
    expect(
      generateArtifactsPrompt({ endpoint: 'llama.cpp', artifacts: ArtifactModes.CUSTOM }),
    ).toBeNull();
  });
});
