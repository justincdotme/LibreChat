import http from 'node:http';

/* Stand-in model for dry runs of egress.mjs when the real model server is
 * offline: it streams back the part of the last user message after its
 * instruction line, which is exactly the artifact block or image line the probe
 * asks for. Run `node docs/zero-wan/verify/mock.mjs` on the Docker host, add a
 * custom endpoint named "mock" with baseURL http://<host LAN IP>:8089/v1 and
 * model "mock-model" to config.yaml, restart the api, and run the probe with
 * ENDPOINT_LABEL=mock MODEL_ID=mock-model. PORT overrides 8089. */

function reply(messages) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const text =
    typeof last?.content === 'string'
      ? last.content
      : (last?.content ?? []).map((p) => p.text ?? '').join('');
  if (text.includes('\n\n')) return text.slice(text.indexOf('\n\n') + 2);
  if (text.includes(': ')) return text.slice(text.indexOf(': ') + 2);
  return text;
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(
      JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }),
    );
  }
  if (req.method !== 'POST' || !req.url.startsWith('/v1/chat/completions')) {
    res.writeHead(404);
    return res.end();
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const parsed = JSON.parse(body || '{}');
    const content = reply(parsed.messages ?? []);
    const id = 'chatcmpl-mock';
    if (parsed.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const chunk = (delta, finish = null) =>
        res.write(
          `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      chunk({ role: 'assistant', content: '' });
      for (const piece of content.match(/[\s\S]{1,40}/g) ?? []) chunk({ content: piece });
      chunk({}, 'stop');
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id,
        object: 'chat.completion',
        created: 1,
        model: 'mock-model',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
});
const port = Number(process.env.PORT ?? 8089);
server.listen(port, '0.0.0.0', () => console.log(`mock listening on ${port}`));
