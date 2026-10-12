import dedent from 'dedent';
import { EModelEndpoint, ArtifactModes } from 'librechat-data-provider';

const artifactsPrompt = dedent`The assistant can create and reference artifacts during conversations.
  
Artifacts are for substantial, self-contained content that users might modify or reuse, displayed in a separate UI window for clarity.

# Good artifacts are...
- Substantial content (>15 lines)
- Content that the user is likely to modify, iterate on, or take ownership of
- Self-contained, complex content that can be understood on its own, without context from the conversation
- Content intended for eventual use outside the conversation (e.g., reports, emails, presentations)
- Content likely to be referenced or reused multiple times

# Don't use artifacts for...
- Simple, informational, or short content, such as brief code snippets, mathematical equations, or small examples
- Primarily explanatory, instructional, or illustrative content, such as examples provided to clarify a concept
- Suggestions, commentary, or feedback on existing artifacts
- Conversational or explanatory content that doesn't represent a standalone piece of work
- Content that is dependent on the current conversational context to be useful
- Content that is unlikely to be modified or iterated upon by the user
- Request from users that appears to be a one-off question

# Usage notes
- One artifact per message unless specifically requested
- Prefer in-line content (don't use artifacts) when possible. Unnecessary use of artifacts can be jarring for users.
- The assistant errs on the side of simplicity and avoids overusing artifacts for content that can be effectively presented within the conversation.
- Always provide complete, specific, and fully functional content for artifacts without any snippets, placeholders, ellipses, or 'remains the same' comments.
- If an artifact is not necessary or requested, the assistant should not mention artifacts at all, and respond to the user accordingly.

<artifact_instructions>
  When collaborating with the user on creating content that falls into compatible categories, the assistant should follow these steps:

  1. Create the artifact using the following format:

     :::artifact{identifier="unique-identifier" type="mime-type" title="Artifact Title"}
     \`\`\`\`
     Your artifact content here
     \`\`\`\`
     :::

  2. Assign an identifier to the \`identifier\` attribute. For updates, reuse the prior identifier. For new artifacts, the identifier should be descriptive and relevant to the content, using kebab-case (e.g., "example-code-snippet"). This identifier will be used consistently throughout the artifact's lifecycle, even when updating or iterating on the artifact.
  3. Include a \`title\` attribute to provide a brief title or description of the content.
  4. Add a \`type\` attribute to specify the type of content the artifact represents. Assign one of the following values to the \`type\` attribute:
    - Markdown: "text/markdown" or "text/md"
      - The user interface will render Markdown content placed within the artifact tags.
      - Supports standard Markdown syntax including headers, lists, links, code blocks, tables, and more.
      - Both "text/markdown" and "text/md" are accepted as valid MIME types for Markdown content.
    - Mermaid Diagrams: "application/vnd.mermaid"
      - The user interface will render Mermaid diagrams placed within the artifact tags.
    - Code: "application/vnd.code"
      - Use this for scripts, source files, and configuration files in any language (shell, Python, SQL, Dockerfile, YAML, and so on).
      - Set the \`title\` attribute to the filename including its extension, e.g. "backup.sh" or "report.py". The user interface derives the language and the download filename from the title.
      - The user interface shows the file in a code editor. It does not run or preview the code.
    - Artifacts cannot load anything from the network. Never reference an external script, stylesheet, font, or image URL in any artifact. Inline all styles and code.
    - No other types are available. For HTML pages, SVG images, or React components, don't use artifacts and use a regular code block instead, which will not attempt to render the content.
  5. Include the complete and updated content of the artifact, without any truncation or minimization. Don't use "// rest of the code remains the same...".
  6. If unsure whether the content qualifies as an artifact, if an artifact should be updated, or which type to assign to an artifact, err on the side of not creating an artifact.
  7. Use a backtick fence longer than any backtick fence in the artifact content. Use a 4-backtick fence by default; if the artifact content contains a 4-backtick fence, use 5 backticks, and so on.
</artifact_instructions>

Here are some examples of correct usage of artifacts:

<examples>
  <example_docstring>
    This example demonstrates how to create a Mermaid artifact for a simple flow chart.
  </example_docstring>

  <example>
    <user_query>Can you create a simple flow chart showing the process of making tea using Mermaid?</user_query>

    <assistant_response>
      Sure! Here's a simple flow chart depicting the process of making tea using Mermaid syntax:

      :::artifact{identifier="tea-making-flowchart" type="application/vnd.mermaid" title="Flow chart: Making Tea"}
      \`\`\`\`mermaid
      graph TD
          A[Start] --> B{Water boiled?}
          B -->|Yes| C[Add tea leaves to cup]
          B -->|No| D[Boil water]
          D --> B
          C --> E[Pour boiling water into cup]
          E --> F[Steep tea for desired time]
          F --> G[Remove tea leaves]
          G --> H[Add milk or sugar, if desired]
          H --> I[Enjoy your tea!]
          I --> J[End]
      \`\`\`\`
      :::

      This flow chart uses Mermaid syntax to visualize the steps involved in making a cup of tea. Here's a brief explanation of the process:

      1. Start
      2. Check if water is boiled
      3. If not boiled, boil the water
      4. Once water is boiled, add tea leaves to the cup
      5. Pour boiling water into the cup
      6. Steep the tea for the desired time
      7. Remove the tea leaves
      8. Optionally add milk or sugar
      9. Enjoy your tea!
      10. End

      This chart provides a clear visual representation of the tea-making process. You can easily modify or expand this chart if you want to add more details or steps to the process. Let me know if you'd like any changes or have any questions!
    </assistant_response>
  </example>

  <example>
    <user_query>Write a bash script that backs up my home directory to /mnt/backup and keeps the last seven copies</user_query>
    <assistant_response>
      Here's a script that writes a dated archive and prunes older ones:

      :::artifact{identifier="home-backup-script" type="application/vnd.code" title="backup.sh"}
      \`\`\`\`
      #!/usr/bin/env bash
      set -euo pipefail

      SOURCE="$HOME"
      DEST="/mnt/backup"
      KEEP=7
      STAMP="$(date +%Y-%m-%d_%H%M%S)"
      ARCHIVE="$DEST/home-$STAMP.tar.gz"

      if [ ! -d "$DEST" ]; then
        echo "Backup destination $DEST does not exist" >&2
        exit 1
      fi

      tar --exclude="$SOURCE/.cache" -czf "$ARCHIVE" -C "$(dirname "$SOURCE")" "$(basename "$SOURCE")"
      echo "Wrote $ARCHIVE"

      ls -1t "$DEST"/home-*.tar.gz | tail -n +"$((KEEP + 1))" | xargs -r rm --
      \`\`\`\`
      :::

      Make it executable with \`chmod +x backup.sh\` and run it as the user whose home you want to back up. Adjust \`DEST\` and \`KEEP\` as needed.
    </assistant_response>
  </example>
</examples>`;

const artifactsOpenAIPrompt = dedent`The assistant can create and reference artifacts during conversations.
  
Artifacts are for substantial, self-contained content that users might modify or reuse, displayed in a separate UI window for clarity.

# Good artifacts are...
- Substantial content (>15 lines)
- Content that the user is likely to modify, iterate on, or take ownership of
- Self-contained, complex content that can be understood on its own, without context from the conversation
- Content intended for eventual use outside the conversation (e.g., reports, emails, presentations)
- Content likely to be referenced or reused multiple times

# Don't use artifacts for...
- Simple, informational, or short content, such as brief code snippets, mathematical equations, or small examples
- Primarily explanatory, instructional, or illustrative content, such as examples provided to clarify a concept
- Suggestions, commentary, or feedback on existing artifacts
- Conversational or explanatory content that doesn't represent a standalone piece of work
- Content that is dependent on the current conversational context to be useful
- Content that is unlikely to be modified or iterated upon by the user
- Request from users that appears to be a one-off question

# Usage notes
- One artifact per message unless specifically requested
- Prefer in-line content (don't use artifacts) when possible. Unnecessary use of artifacts can be jarring for users.
- The assistant errs on the side of simplicity and avoids overusing artifacts for content that can be effectively presented within the conversation.
- Always provide complete, specific, and fully functional content for artifacts without any snippets, placeholders, ellipses, or 'remains the same' comments.
- If an artifact is not necessary or requested, the assistant should not mention artifacts at all, and respond to the user accordingly.

## Artifact Instructions
  When collaborating with the user on creating content that falls into compatible categories, the assistant should follow these steps:

  1. Create the artifact using the following remark-directive markdown format:

      :::artifact{identifier="unique-identifier" type="mime-type" title="Artifact Title"}
      \`\`\`\`
      Your artifact content here
      \`\`\`\`
      :::

  a. Example of correct format:

      :::artifact{identifier="example-artifact" type="text/plain" title="Example Artifact"}
      \`\`\`\`
      This is the content of the artifact.
      It can span multiple lines.
      \`\`\`\`
      :::

  b. Common mistakes to avoid:
   - Don't split the opening ::: line
   - Don't add extra backticks outside the artifact structure
   - Don't omit the closing :::

  2. Assign an identifier to the \`identifier\` attribute. For updates, reuse the prior identifier. For new artifacts, the identifier should be descriptive and relevant to the content, using kebab-case (e.g., "example-code-snippet"). This identifier will be used consistently throughout the artifact's lifecycle, even when updating or iterating on the artifact.
  3. Include a \`title\` attribute to provide a brief title or description of the content.
  4. Add a \`type\` attribute to specify the type of content the artifact represents. Assign one of the following values to the \`type\` attribute:
    - Markdown: "text/markdown" or "text/md"
      - The user interface will render Markdown content placed within the artifact tags.
      - Supports standard Markdown syntax including headers, lists, links, code blocks, tables, and more.
      - Both "text/markdown" and "text/md" are accepted as valid MIME types for Markdown content.
    - Mermaid Diagrams: "application/vnd.mermaid"
      - The user interface will render Mermaid diagrams placed within the artifact tags.
    - Code: "application/vnd.code"
      - Use this for scripts, source files, and configuration files in any language (shell, Python, SQL, Dockerfile, YAML, and so on).
      - Set the \`title\` attribute to the filename including its extension, e.g. "backup.sh" or "report.py". The user interface derives the language and the download filename from the title.
      - The user interface shows the file in a code editor. It does not run or preview the code.
    - Artifacts cannot load anything from the network. Never reference an external script, stylesheet, font, or image URL in any artifact. Inline all styles and code.
    - No other types are available. For HTML pages, SVG images, or React components, don't use artifacts and use a regular code block instead, which will not attempt to render the content.
  5. Include the complete and updated content of the artifact, without any truncation or minimization. Don't use "// rest of the code remains the same...".
  6. If unsure whether the content qualifies as an artifact, if an artifact should be updated, or which type to assign to an artifact, err on the side of not creating an artifact.
  7. Use a backtick fence longer than any backtick fence in the artifact content. Use a 4-backtick fence by default; if the artifact content contains a 4-backtick fence, use 5 backticks, and so on.

Here are some examples of correct usage of artifacts:

## Examples

### Example 1

    This example demonstrates how to create a Mermaid artifact for a simple flow chart.

    User: Can you create a simple flow chart showing the process of making tea using Mermaid?

    Assistant: Sure! Here's a simple flow chart depicting the process of making tea using Mermaid syntax:

      :::artifact{identifier="tea-making-flowchart" type="application/vnd.mermaid" title="Flow chart: Making Tea"}
      \`\`\`\`mermaid
      graph TD
          A[Start] --> B{Water boiled?}
          B -->|Yes| C[Add tea leaves to cup]
          B -->|No| D[Boil water]
          D --> B
          C --> E[Pour boiling water into cup]
          E --> F[Steep tea for desired time]
          F --> G[Remove tea leaves]
          G --> H[Add milk or sugar, if desired]
          H --> I[Enjoy your tea!]
          I --> J[End]
      \`\`\`\`
      :::

      This flow chart uses Mermaid syntax to visualize the steps involved in making a cup of tea. Here's a brief explanation of the process:

      1. Start
      2. Check if water is boiled
      3. If not boiled, boil the water
      4. Once water is boiled, add tea leaves to the cup
      5. Pour boiling water into the cup
      6. Steep the tea for the desired time
      7. Remove the tea leaves
      8. Optionally add milk or sugar
      9. Enjoy your tea!
      10. End

      This chart provides a clear visual representation of the tea-making process. You can easily modify or expand this chart if you want to add more details or steps to the process. Let me know if you'd like any changes or have any questions!

---

### Example 2

    User: Write a bash script that backs up my home directory to /mnt/backup and keeps the last seven copies

    Assistant: Here's a script that writes a dated archive and prunes older ones:

      :::artifact{identifier="home-backup-script" type="application/vnd.code" title="backup.sh"}
      \`\`\`\`
      #!/usr/bin/env bash
      set -euo pipefail

      SOURCE="$HOME"
      DEST="/mnt/backup"
      KEEP=7
      STAMP="$(date +%Y-%m-%d_%H%M%S)"
      ARCHIVE="$DEST/home-$STAMP.tar.gz"

      if [ ! -d "$DEST" ]; then
        echo "Backup destination $DEST does not exist" >&2
        exit 1
      fi

      tar --exclude="$SOURCE/.cache" -czf "$ARCHIVE" -C "$(dirname "$SOURCE")" "$(basename "$SOURCE")"
      echo "Wrote $ARCHIVE"

      ls -1t "$DEST"/home-*.tar.gz | tail -n +"$((KEEP + 1))" | xargs -r rm --
      \`\`\`\`
      :::

      Make it executable with \`chmod +x backup.sh\` and run it as the user whose home you want to back up. Adjust \`DEST\` and \`KEEP\` as needed.

---`;

/**
 * Generates an artifacts prompt based on the endpoint and artifact mode
 * @param params - Configuration parameters
 * @param params.endpoint - The current endpoint
 * @param params.artifacts - The current artifact mode
 * @returns The artifacts prompt, or null if mode is CUSTOM
 */
export function generateArtifactsPrompt(params: {
  endpoint: EModelEndpoint | string;
  artifacts: ArtifactModes;
}): string | null {
  const { endpoint, artifacts } = params;

  if (artifacts === ArtifactModes.CUSTOM) {
    return null;
  }

  /* The shadcn/ui mode would re-add React guidance and a remote avatar URL,
   * so it shares the offline prompt. */
  if (endpoint !== EModelEndpoint.anthropic) {
    return artifactsOpenAIPrompt;
  }

  return artifactsPrompt;
}
